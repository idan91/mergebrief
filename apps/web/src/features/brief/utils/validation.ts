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
import type { LogFields } from "logging";
import type { Result as SharedResult, ValueOf } from "types";
import type {
  AddressedReviewComment,
  Brief,
  ComparisonMarks,
  ComparisonMarksSummary,
  RevisionChangeFile,
  RevisionChanges,
} from "../types";

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

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isOneOf<T extends Record<string, string>>(
  values: T,
  value: unknown,
): value is ValueOf<T> {
  return isString(value) && Object.values(values).includes(value);
}

export function parseAddressedReviewComment(
  value: unknown,
): Result<AddressedReviewComment> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected review comment to be an object" };
  }
  const id = value["id"];
  const file = value["file"];
  const startLine = value["startLine"] ?? null;
  const line = value["line"];
  const originalStartLine = value["originalStartLine"] ?? null;
  const originalLine = value["originalLine"] ?? null;
  const author = value["author"];
  const body = value["body"];
  const inReplyToId = value["inReplyToId"];
  const outdated = value["outdated"] ?? line === null;
  if (
    !isString(id) ||
    !isString(file) ||
    !isNullableInteger(startLine) ||
    !isNullableInteger(line) ||
    !isNullableInteger(originalStartLine) ||
    !isNullableInteger(originalLine) ||
    !isString(author) ||
    !isString(body) ||
    !isNullableString(inReplyToId) ||
    typeof outdated !== "boolean"
  ) {
    return {
      ok: false,
      error:
        "Expected review comment id, file, startLine, line, originalStartLine, originalLine, author, body, inReplyToId, and outdated",
    };
  }
  return {
    ok: true,
    value: {
      id,
      file,
      startLine,
      line,
      originalStartLine,
      originalLine,
      author,
      body,
      inReplyToId,
      outdated,
    },
  };
}

export function parseAddressedReviewComments(
  value: unknown,
): Result<AddressedReviewComment[]> {
  return parseArray(value, parseAddressedReviewComment, "reviewComments");
}

function parseLineRange(value: unknown): Result<LineRange> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected line range start/end integers" };
  }
  const start = value["start"];
  const end = value["end"];
  if (!isInteger(start) || !isInteger(end)) {
    return { ok: false, error: "Expected line range start/end integers" };
  }
  return { ok: true, value: { start, end } };
}

function parseRevisionChangeFile(value: unknown): Result<RevisionChangeFile> {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: "Expected revision-change file to be an object",
    };
  }
  const file = value["file"];
  if (!isString(file)) {
    return { ok: false, error: "Expected revision-change file path" };
  }
  const addedRanges = parseArray(
    value["addedRanges"],
    parseLineRange,
    "addedRanges",
  );
  if (!addedRanges.ok) {
    return addedRanges;
  }
  const removedRanges = parseArray(
    value["removedRanges"],
    parseLineRange,
    "removedRanges",
  );
  if (!removedRanges.ok) {
    return removedRanges;
  }
  return {
    ok: true,
    value: {
      file,
      addedRanges: addedRanges.value,
      removedRanges: removedRanges.value,
    },
  };
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

export function parseRevisionChanges(value: unknown): Result<RevisionChanges> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected revision changes to be an object" };
  }
  const headSha = value["headSha"];
  const prevHeadSha = value["prevHeadSha"];
  const prevIndex = value["prevIndex"];
  if (!isString(headSha) || !isString(prevHeadSha) || !isInteger(prevIndex)) {
    return {
      ok: false,
      error: "Expected revision changes headSha, prevHeadSha, and prevIndex",
    };
  }
  const files = parseArray(value["files"], parseRevisionChangeFile, "files");
  if (!files.ok) {
    return files;
  }
  return {
    ok: true,
    value: { headSha, prevHeadSha, prevIndex, files: files.value },
  };
}

const ComparisonBaselineLabels = {
  PREVIOUS_BRIEF: "previous-brief",
  CHECKPOINT: "checkpoint",
} as const;

/**
 * Parse the header fields of a `.comparison.json` marks sidecar
 * needed for comparison availability, deliberately ignores `files`, which
 * availability scanning never needs.
 */
export function parseComparisonMarksSummary(
  value: unknown,
): Result<ComparisonMarksSummary> {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected comparison marks to be an object" };
  }
  const baselineSha = value["baselineSha"];
  const headSha = value["headSha"];
  const baselineLabel = value["baselineLabel"];
  const baselineIndex = value["baselineIndex"] ?? null;
  if (
    !isString(baselineSha) ||
    !isString(headSha) ||
    !isOneOf(ComparisonBaselineLabels, baselineLabel) ||
    !isNullableInteger(baselineIndex)
  ) {
    return {
      ok: false,
      error:
        "Expected comparison marks baselineSha, headSha, baselineLabel, and baselineIndex",
    };
  }
  return {
    ok: true,
    value: {
      baselineSha,
      headSha,
      baselineLabel,
      baselineIndex,
    },
  };
}

/**
 * Parse a full `.comparison.json` marks sidecar: the header fields
 * (via `parseComparisonMarksSummary`) plus the per-file changed-line ranges
 * (reusing the revision-change file parser, identical `files` shape).
 */
export function parseComparisonMarks(value: unknown): Result<ComparisonMarks> {
  const summary = parseComparisonMarksSummary(value);
  if (!summary.ok) {
    return summary;
  }
  if (!isRecord(value)) {
    return { ok: false, error: "Expected comparison marks to be an object" };
  }
  const files = parseArray(value["files"], parseRevisionChangeFile, "files");
  if (!files.ok) {
    return files;
  }
  return { ok: true, value: { ...summary.value, files: files.value } };
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
