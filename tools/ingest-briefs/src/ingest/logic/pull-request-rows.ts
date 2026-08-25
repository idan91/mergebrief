// Phase 2: one `pull_request` row per (repo, number). PR-base = the LATEST
// brief's span base — a retarget moves it, and the newest brief is what the
// route renders.
import type { PullRequestRow } from "persistence";
import type {
  IngestRun,
  ParsedBriefFile,
  ResolvedPullRequests,
  ResolveRepo,
} from "../types";
import { buildPrKey } from "../utils";

/** The highest-index brief for the same PR as `brief`. */
function findNewestBrief(
  briefFiles: readonly ParsedBriefFile[],
  brief: ParsedBriefFile,
): ParsedBriefFile | undefined {
  return briefFiles
    .filter(
      (candidate) =>
        candidate.meta.pr.repo === brief.meta.pr.repo &&
        candidate.meta.pr.number === brief.meta.pr.number,
    )
    .toSorted((a, b) => a.meta.index - b.meta.index)
    .at(-1);
}

export async function writePullRequestRows(
  run: IngestRun,
  briefFiles: readonly ParsedBriefFile[],
  resolveRepo: ResolveRepo,
): Promise<ResolvedPullRequests> {
  const prRows = new Map<string, PullRequestRow>();
  const legacyBaseShas = new Map<string, string>();
  // `resolveRepo` shells out to `gh`, so a second brief on the same PR must
  // not re-run it.
  const decidedKeys = new Set<string>();

  for (const brief of briefFiles) {
    const key = buildPrKey(brief.meta.pr.repo, brief.meta.pr.number);
    if (decidedKeys.has(key)) {
      continue;
    }
    decidedKeys.add(key);

    const newest = findNewestBrief(briefFiles, brief);
    if (newest === undefined) {
      continue;
    }

    const resolution = await resolveRepo(
      brief.meta.pr.repo,
      brief.meta.pr.number,
    );
    // A pre-index brief carries no base SHA; the resolution is the only
    // source. Without one the PR is left alone entirely — a half-ingested row
    // would be worse than a loud miss.
    const baseSha =
      newest.legacy === true
        ? resolution.baseSha
        : newest.meta.commitRange.base;
    if (baseSha === undefined) {
      for (const file of briefFiles) {
        if (buildPrKey(file.meta.pr.repo, file.meta.pr.number) === key) {
          run.unmapped.push(file.name);
        }
      }
      continue;
    }

    // A legacy brief always writes with the RESOLUTION's base, never the
    // newest brief's: a PR holding both formats would otherwise stamp the
    // modern brief's base onto the pre-index row.
    if (resolution.baseSha !== undefined) {
      legacyBaseShas.set(key, resolution.baseSha);
    }

    const upsertBase = {
      repoId: resolution.repoId,
      prNumber: brief.meta.pr.number,
      repoSlug: brief.meta.pr.repo,
      baseSha,
    };
    const title = newest.meta.pr.title;
    const row = await run.repo.pullRequests.upsert(
      title === undefined
        ? { ...upsertBase, ...resolution.lifecycle }
        : { ...upsertBase, title, ...resolution.lifecycle },
    );
    prRows.set(key, row);
    run.log(
      `pull_request ${brief.meta.pr.repo}#${String(brief.meta.pr.number)}`,
    );
  }

  return { prRows, legacyBaseShas };
}
