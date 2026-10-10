import {
  LocalBriefKinds,
  type LocalBriefKind,
  type LocalBriefView,
} from "contract";
import type { Logger } from "logging";
import type { Mutable, Result } from "types/utils";
import {
  BRIEF_DIFFS_SUFFIX,
  BRIEF_SUFFIX,
  COMMENTS_SUFFIX_BY_KIND,
  COMPARISON_MARKS_SUFFIX,
  DELTA_DIFFS_SUFFIX,
  DELTA_SUFFIX,
  REVISION_CHANGES_SUFFIX,
  REVISION_NARRATIVE_SUFFIX,
} from "../consts";
import {
  ComparisonBaselineLabels,
  type BriefArtifactFile,
  type LocalBriefsFailure,
} from "../types";
import {
  isNotFound,
  parseArtifactJson,
  readArtifactFile,
  readFirstArtifactFile,
} from "./artifact-files";
import { parseRevisionChangesHeader } from "./sidecar-headers";

type ArtifactRead = Result<string, LocalBriefsFailure>;

/** A full Brief wins over a Delta of the same id. */
async function readBriefArtifact(
  dir: string,
  briefId: string,
  log: Logger,
): Promise<Result<BriefArtifactFile, LocalBriefsFailure>> {
  const briefName = `${briefId}${BRIEF_SUFFIX}`;
  const brief = await readArtifactFile(dir, briefName, log);
  if (brief.ok) {
    const file = {
      kind: LocalBriefKinds.BRIEF,
      name: briefName,
      text: brief.value,
    };
    return { ok: true, value: file };
  }
  if (!isNotFound(brief)) {
    return brief;
  }

  const deltaName = `${briefId}${DELTA_SUFFIX}`;
  const delta = await readArtifactFile(dir, deltaName, log);
  if (!delta.ok) {
    return delta;
  }
  const file = {
    kind: LocalBriefKinds.DELTA,
    name: deltaName,
    text: delta.value,
  };
  return { ok: true, value: file };
}

/** `undefined` when the artifact has no comments sidecar. */
async function readReviewComments(
  dir: string,
  briefId: string,
  kind: LocalBriefKind,
  log: Logger,
): Promise<Result<unknown, LocalBriefsFailure>> {
  const name = `${briefId}${COMMENTS_SUFFIX_BY_KIND[kind]}`;
  const text = await readArtifactFile(dir, name, log);
  if (isNotFound(text)) {
    return { ok: true, value: undefined };
  }
  if (!text.ok) {
    return text;
  }
  return parseArtifactJson(text.value, name, log);
}

export async function readBriefView(
  dir: string,
  briefId: string,
  log: Logger,
): Promise<Result<LocalBriefView, LocalBriefsFailure>> {
  const artifact = await readBriefArtifact(dir, briefId, log);
  if (!artifact.ok) {
    return artifact;
  }
  const { kind, name, text } = artifact.value;
  const body = parseArtifactJson(text, name, log);
  if (!body.ok) {
    return body;
  }

  const comments = await readReviewComments(dir, briefId, kind, log);
  if (!comments.ok) {
    return comments;
  }
  const view: Mutable<LocalBriefView> = {
    artifactKind: kind,
    body: body.value,
  };
  if (comments.value !== undefined) {
    view.reviewComments = comments.value;
  }
  return { ok: true, value: view };
}

export function readDiffsSidecar(
  dir: string,
  briefId: string,
  log: Logger,
): Promise<ArtifactRead> {
  const names = [
    `${briefId}${BRIEF_DIFFS_SUFFIX}`,
    `${briefId}${DELTA_DIFFS_SUFFIX}`,
  ];
  return readFirstArtifactFile(dir, names, log);
}

export function readRevisionNarrativeSidecar(
  dir: string,
  narrativeId: string,
  log: Logger,
): Promise<ArtifactRead> {
  return readArtifactFile(
    dir,
    `${narrativeId}${REVISION_NARRATIVE_SUFFIX}`,
    log,
  );
}

/**
 * The listing names a legacy sidecar as Previous Brief marks under the
 * brief's own id. Its `files` shape is the marks', so only the header maps.
 */
async function readLegacyRevisionChangesAsMarks(
  dir: string,
  marksId: string,
  log: Logger,
): Promise<ArtifactRead> {
  const name = `${marksId}${REVISION_CHANGES_SUFFIX}`;
  const text = await readArtifactFile(dir, name, log);
  if (!text.ok) {
    return text;
  }
  const header = parseRevisionChangesHeader(text.value, name, log);
  if (!header.ok) {
    return header;
  }

  const marks = {
    baselineSha: header.value.prevHeadSha,
    headSha: header.value.headSha,
    baselineLabel: ComparisonBaselineLabels.PREVIOUS_BRIEF,
    baselineIndex: header.value.prevIndex,
    files: header.value.files,
  };
  return { ok: true, value: JSON.stringify(marks) };
}

export async function readComparisonMarksSidecar(
  dir: string,
  marksId: string,
  log: Logger,
): Promise<ArtifactRead> {
  const marks = await readArtifactFile(
    dir,
    `${marksId}${COMPARISON_MARKS_SUFFIX}`,
    log,
  );
  if (!isNotFound(marks)) {
    return marks;
  }
  return readLegacyRevisionChangesAsMarks(dir, marksId, log);
}
