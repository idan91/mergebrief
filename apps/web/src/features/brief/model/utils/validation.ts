import {
  ArtifactIssueCodes,
  readStoredBrief,
  readStoredDeltaBrief,
  readStoredRevisionNarrative,
  type ArtifactIssue,
  type StoredBrief,
  type StoredRevisionNarrative,
} from "brief-core/artifact";
import {
  Concerns,
  type Concern,
  type ConcernRollup,
  type DeltaBrief,
  type DeltaChunk,
  type IntentCheck,
  type IntentItem,
  type LineRange,
} from "brief-core/types";
import {
  LocalBriefKinds,
  type LocalBriefSummary,
  type LocalComparisonAvailability,
  type LocalLastReviewAvailability,
  type LocalPreviousBriefAvailability,
} from "contract";
import type { LogFields } from "logging";
import type { Mutable, Result as SharedResult, ValueOf } from "types";
import type { Brief, FileDiffPatch } from "../types";

/** Shared `Result` with this module's fixed error type (a message string). */
export type Result<T> = SharedResult<T, string>;

/**
 * Where a stored-body repair is reported. INJECTED because this module is
 * shared client/server: the server caller passes the process logger, the
 * client passes nothing and the repairs stay silent.
 */
export interface ParseWarnings {
  warn(msg: string, fields?: LogFields): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || isInteger(value);
}

function isOptional<Value>(
  value: unknown,
  guard: (candidate: unknown) => candidate is Value,
): value is Value | undefined {
  const absentOrValid = value === undefined || guard(value);
  return absentOrValid;
}

function isOneOf<T extends Record<string, string>>(
  values: T,
  value: unknown,
): value is ValueOf<T> {
  return isString(value) && Object.values(values).includes(value);
}

/** 1-based, ordered, non-overlapping (ascending, gap-free of inversions). */
function isCanonicalRanges(ranges: LineRange[]): boolean {
  let previousEnd = 0;
  for (const range of ranges) {
    if (range.start < 1 || range.end < range.start) {
      return false;
    }
    if (range.start <= previousEnd) {
      return false;
    }
    previousEnd = range.end;
  }
  return true;
}

function parseArray<T>(
  value: unknown,
  parser: (item: unknown) => Result<T>,
  label: string,
): Result<T[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: `Expected ${label} to be an array` };
  }
  const parsed: T[] = [];
  for (const item of value) {
    const result = parser(item);
    if (!result.ok) {
      return result;
    }
    parsed.push(result.value);
  }
  return { ok: true, value: parsed };
}

/** Codes and paths only: an issue's message may name keys from the body. */
function describeIssues(
  issues: readonly Pick<ArtifactIssue, "code" | "path">[],
): string {
  return issues.map(({ code, path }) => `${code}:${path}`).join(", ");
}

/** Vocabulary-order rollup, matches the pipeline's derived concernView. */
function buildConcernView(chunks: readonly DeltaChunk[]): ConcernRollup[] {
  const byConcern = new Map<Concern, { added: number; deleted: number }>();
  for (const chunk of chunks) {
    const current = byConcern.get(chunk.concern) ?? { added: 0, deleted: 0 };
    current.added += chunk.loc.added;
    current.deleted += chunk.loc.deleted;
    byConcern.set(chunk.concern, current);
  }
  return Object.values(Concerns).flatMap((concern): ConcernRollup[] => {
    const loc = byConcern.get(concern);
    if (loc === undefined) {
      return [];
    }
    return [{ concern, added: loc.added, deleted: loc.deleted }];
  });
}

/** `acknowledged` is meaningful only in `deviations`. */
function clearAcknowledged(items: IntentItem[]): IntentItem[] {
  return items.map((item) =>
    item.acknowledged ? { ...item, acknowledged: false } : item,
  );
}

/**
 * One title per ticket URL, `""` filling the gaps, so the renderer indexes the
 * pair without bounds checks.
 */
function alignIntentCheck(check: IntentCheck): IntentCheck {
  const ticketTitles = check.ticketUrls.map(
    (_url, index) => check.ticketTitles[index] ?? "",
  );
  return {
    ...check,
    ticketTitles,
    accomplished: clearAcknowledged(check.accomplished),
    statedButMissing: clearAcknowledged(check.statedButMissing),
    doneButUnstated: clearAcknowledged(check.doneButUnstated),
    claimedButUnachieved: clearAcknowledged(check.claimedButUnachieved),
  };
}

/** The view model counts the remainder with a plain sum. */
function isCanonicalRemainder(
  unattributed: NonNullable<StoredBrief["unattributed"]>,
): boolean {
  return unattributed.every(
    (entry) =>
      isCanonicalRanges(entry.addedRanges) &&
      isCanonicalRanges(entry.removedRanges),
  );
}

function shapeBriefView(stored: StoredBrief, warnings?: ParseWarnings): Brief {
  const { anchoring: _anchoring, intentCheck, unattributed, ...kept } = stored;
  const brief: Brief = { ...kept, artifactKind: "brief" };

  if (intentCheck !== undefined) {
    brief.intentCheck = alignIntentCheck(intentCheck);
  }
  if (unattributed === undefined) {
    return brief;
  }
  if (!isCanonicalRemainder(unattributed)) {
    warnings?.warn("stored brief remainder dropped: non-canonical ranges", {
      path: "unattributed",
    });
    return brief;
  }

  brief.unattributed = unattributed;
  return brief;
}

export function parseBrief(
  json: string,
  warnings?: ParseWarnings,
): Result<Brief> {
  const read = readStoredBrief(json);
  if (!read.ok) {
    return { ok: false, error: describeIssues(read.error) };
  }

  for (const { code, path } of read.value.issues) {
    warnings?.warn("stored brief repaired on read", { code, path });
  }
  return { ok: true, value: shapeBriefView(read.value.brief, warnings) };
}

/** A chunk naming no changed group would render nowhere. */
function findStrayChunkPath(delta: DeltaBrief): string | undefined {
  const groupIds = new Set(delta.changedGroups.map((group) => group.id));
  const position = delta.chunks.findIndex(
    (chunk) => !groupIds.has(chunk.changeGroupId),
  );
  if (position === -1) {
    return undefined;
  }
  return `chunks.${position}.changeGroupId`;
}

export function parseDeltaBrief(json: string): Result<Brief> {
  const read = readStoredDeltaBrief(json);
  if (!read.ok) {
    return { ok: false, error: describeIssues(read.error) };
  }

  const strayPath = findStrayChunkPath(read.value);
  if (strayPath !== undefined) {
    const code = ArtifactIssueCodes.UNKNOWN_CHANGE_GROUP;
    return { ok: false, error: describeIssues([{ code, path: strayPath }]) };
  }

  const { changedGroups, chunks, ...kept } = read.value;
  const delta: Brief = {
    ...kept,
    artifactKind: "delta",
    changeGroups: changedGroups,
    chunks,
    concernView: buildConcernView(chunks),
  };
  return { ok: true, value: delta };
}

export function parseRevisionNarrativeArtifact(
  json: string,
  warnings?: ParseWarnings,
): Result<StoredRevisionNarrative> {
  const read = readStoredRevisionNarrative(json);
  if (!read.ok) {
    return { ok: false, error: describeIssues(read.error) };
  }

  for (const { code, path } of read.value.issues) {
    warnings?.warn("stored revision narrative repaired on read", {
      code,
      path,
    });
  }
  return { ok: true, value: read.value.narrative };
}

function parseFileDiffPatch(value: unknown): Result<FileDiffPatch> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected a diffs entry to be an object" };
  }
  const file = value["file"];
  const patch = value["patch"];
  const malformed = !isString(file) || !isString(patch);
  if (malformed) {
    return { ok: false, error: "Expected diffs entry file and patch strings" };
  }
  return { ok: true, value: { file, patch } };
}

/** The diffs sidecar as per-file patches; the rows are sliced client-side. */
export function parseFileDiffPatches(value: unknown): Result<FileDiffPatch[]> {
  return parseArray(value, parseFileDiffPatch, "diffs");
}

function parsePreviousBriefAvailability(
  value: unknown,
): Result<LocalPreviousBriefAvailability> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected previousBrief to be an object" };
  }
  const marksId = value["marksId"];
  const narrativeId = value["narrativeId"];
  const baselineSha = value["baselineSha"];
  const baselineIndex = value["baselineIndex"];
  const malformed =
    !isString(marksId) ||
    !isOptional(narrativeId, isString) ||
    !isString(baselineSha) ||
    !isInteger(baselineIndex);
  if (malformed) {
    return {
      ok: false,
      error:
        "Expected previousBrief marksId, narrativeId, baselineSha, and baselineIndex",
    };
  }

  const availability: Mutable<LocalPreviousBriefAvailability> = {
    marksId,
    baselineSha,
    baselineIndex,
  };
  if (narrativeId !== undefined) {
    availability.narrativeId = narrativeId;
  }
  return { ok: true, value: availability };
}

function parseLastReviewAvailability(
  value: unknown,
): Result<LocalLastReviewAvailability> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected lastReview to be an object" };
  }
  const marksId = value["marksId"];
  const deltaId = value["deltaId"];
  const baselineSha = value["baselineSha"];
  const baselineIndex = value["baselineIndex"];
  const malformed =
    !isString(marksId) ||
    !isOptional(deltaId, isString) ||
    !isString(baselineSha) ||
    !isNullableInteger(baselineIndex);
  if (malformed) {
    return {
      ok: false,
      error:
        "Expected lastReview marksId, deltaId, baselineSha, and baselineIndex",
    };
  }

  const availability: Mutable<LocalLastReviewAvailability> = {
    marksId,
    baselineSha,
    baselineIndex,
  };
  if (deltaId !== undefined) {
    availability.deltaId = deltaId;
  }
  return { ok: true, value: availability };
}

function parseComparisonAvailability(
  value: unknown,
): Result<LocalComparisonAvailability> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected comparisons to be an object" };
  }
  const comparisons: Mutable<LocalComparisonAvailability> = {};

  if (value["previousBrief"] !== undefined) {
    const previous = parsePreviousBriefAvailability(value["previousBrief"]);
    if (!previous.ok) {
      return previous;
    }
    comparisons.previousBrief = previous.value;
  }
  if (value["lastReview"] !== undefined) {
    const lastReview = parseLastReviewAvailability(value["lastReview"]);
    if (!lastReview.ok) {
      return lastReview;
    }
    comparisons.lastReview = lastReview.value;
  }
  return { ok: true, value: comparisons };
}

/** The optional revision fields of a listing row, checked and copied onto it. */
function assignSummaryRevision(
  summary: Mutable<LocalBriefSummary>,
  value: Record<string, unknown>,
): Result<LocalBriefSummary> {
  const index = value["index"];
  const baselineSha = value["baselineSha"];
  const headSha = value["headSha"];
  const baselineIndex = value["baselineIndex"];
  const headIndex = value["headIndex"];
  const malformed =
    !isOptional(index, isInteger) ||
    !isOptional(baselineSha, isString) ||
    !isOptional(headSha, isString) ||
    !isOptional(baselineIndex, isNullableInteger) ||
    !isOptional(headIndex, isNullableInteger);
  if (malformed) {
    return {
      ok: false,
      error:
        "Expected local brief index, baselineSha, headSha, baselineIndex, and headIndex",
    };
  }

  if (index !== undefined) {
    summary.index = index;
  }
  if (baselineSha !== undefined) {
    summary.baselineSha = baselineSha;
  }
  if (headSha !== undefined) {
    summary.headSha = headSha;
  }
  if (baselineIndex !== undefined) {
    summary.baselineIndex = baselineIndex;
  }
  if (headIndex !== undefined) {
    summary.headIndex = headIndex;
  }
  return { ok: true, value: summary };
}

function parseLocalBriefSummary(value: unknown): Result<LocalBriefSummary> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected a local brief to be an object" };
  }
  const id = value["id"];
  const artifactKind = value["artifactKind"];
  const repo = value["repo"];
  const number = value["number"];
  const title = value["title"];
  const sha = value["sha"];
  const malformed =
    !isString(id) ||
    !isOneOf(LocalBriefKinds, artifactKind) ||
    !isString(repo) ||
    !isInteger(number) ||
    !isString(title) ||
    !isString(sha);
  if (malformed) {
    return {
      ok: false,
      error:
        "Expected local brief id, artifactKind, repo, number, title, and sha",
    };
  }

  const summary: Mutable<LocalBriefSummary> = {
    id,
    artifactKind,
    repo,
    number,
    title,
    sha,
  };
  if (value["comparisons"] !== undefined) {
    const comparisons = parseComparisonAvailability(value["comparisons"]);
    if (!comparisons.ok) {
      return comparisons;
    }
    summary.comparisons = comparisons.value;
  }
  return assignSummaryRevision(summary, value);
}

/** `GET /api/local-briefs`: the dev file surface's listing rows. */
export function parseLocalBriefSummaries(
  value: unknown,
): Result<LocalBriefSummary[]> {
  return parseArray(value, parseLocalBriefSummary, "summaries");
}
