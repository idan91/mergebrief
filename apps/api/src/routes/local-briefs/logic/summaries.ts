import {
  readStoredBrief,
  readStoredDeltaBrief,
  type ArtifactIssue,
} from "brief-core/artifact";
import { LocalBriefKinds, type LocalBriefSummary } from "contract";
import type { Logger } from "logging";
import type { Mutable, Result } from "types/utils";
import {
  BRIEF_ID_PATTERN,
  BRIEF_SUFFIX,
  DELTA_SUFFIX,
  REVISION_NARRATIVE_SUFFIX,
} from "../consts";
import {
  LocalBriefsFailureKinds,
  type ComparisonSources,
  type LocalBriefsFailure,
} from "../types";
import { stripSuffix } from "../utils";
import { listArtifactNames, readArtifactFile } from "./artifact-files";
import { attachComparisons } from "./comparisons";
import {
  readComparisonMarksEntries,
  readRevisionChangesEntries,
} from "./sidecar-headers";

/** Codes and paths only: an issue's message may name keys from the body. */
function describeIssues(issues: readonly ArtifactIssue[]): string {
  return issues.map(({ code, path }) => `${code}:${path}`).join(", ");
}

export function collectBriefIds(names: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const name of names) {
    const id =
      stripSuffix(name, BRIEF_SUFFIX) ?? stripSuffix(name, DELTA_SUFFIX);
    const isBriefId = id !== undefined && BRIEF_ID_PATTERN.test(id);
    if (isBriefId) {
      ids.add(id);
    }
  }
  return [...ids].toSorted();
}

function collectNarrativeIds(names: readonly string[]): ReadonlySet<string> {
  const ids = names.flatMap((name) => {
    const id = stripSuffix(name, REVISION_NARRATIVE_SUFFIX);
    return id === undefined ? [] : [id];
  });
  return new Set(ids);
}

function summarizeStoredBrief(
  briefId: string,
  text: string,
  log: Logger,
): LocalBriefSummary | undefined {
  const read = readStoredBrief(text);
  if (!read.ok) {
    log.warn("local brief skipped: invalid artifact", {
      briefId,
      issues: describeIssues(read.error),
    });
    return undefined;
  }

  const { pr, index } = read.value.brief;
  const summary: Mutable<LocalBriefSummary> = {
    id: briefId,
    artifactKind: LocalBriefKinds.BRIEF,
    repo: pr.repo,
    number: pr.number,
    title: pr.title,
    sha: pr.sha,
  };
  if (index !== undefined) {
    summary.index = index;
  }
  return summary;
}

function summarizeStoredDelta(
  briefId: string,
  text: string,
  log: Logger,
): LocalBriefSummary | undefined {
  const read = readStoredDeltaBrief(text);
  if (!read.ok) {
    log.warn("local brief skipped: invalid artifact", {
      briefId,
      issues: describeIssues(read.error),
    });
    return undefined;
  }

  const { pr, baselineSha, headSha, baselineIndex, headIndex } = read.value;
  const summary: Mutable<LocalBriefSummary> = {
    id: briefId,
    artifactKind: LocalBriefKinds.DELTA,
    repo: pr.repo,
    number: pr.number,
    title: pr.title,
    sha: pr.sha,
    baselineSha,
    headSha,
  };
  if (baselineIndex !== null) {
    summary.baselineIndex = baselineIndex;
  }
  if (headIndex !== null) {
    summary.headIndex = headIndex;
  }
  return summary;
}

/** One unreadable or invalid artifact drops its row, never the listing. */
async function readSummary(
  dir: string,
  briefId: string,
  log: Logger,
): Promise<LocalBriefSummary | undefined> {
  const brief = await readArtifactFile(dir, `${briefId}${BRIEF_SUFFIX}`, log);
  if (brief.ok) {
    return summarizeStoredBrief(briefId, brief.value, log);
  }
  if (brief.error.kind !== LocalBriefsFailureKinds.NOT_FOUND) {
    return undefined;
  }

  const delta = await readArtifactFile(dir, `${briefId}${DELTA_SUFFIX}`, log);
  if (!delta.ok) {
    return undefined;
  }
  return summarizeStoredDelta(briefId, delta.value, log);
}

export async function listLocalBriefSummaries(
  dir: string,
  log: Logger,
): Promise<Result<LocalBriefSummary[], LocalBriefsFailure>> {
  const names = await listArtifactNames(dir, log);
  if (!names.ok) {
    return names;
  }

  const reads = collectBriefIds(names.value).map((briefId) =>
    readSummary(dir, briefId, log),
  );
  const summaries = (await Promise.all(reads)).filter(
    (summary) => summary !== undefined,
  );
  const sources: ComparisonSources = {
    summaries,
    marks: await readComparisonMarksEntries(dir, names.value, log),
    legacy: await readRevisionChangesEntries(dir, names.value, log),
    narrativeIds: collectNarrativeIds(names.value),
  };

  const listed = summaries.map((summary) =>
    attachComparisons(summary, sources),
  );
  return { ok: true, value: listed };
}
