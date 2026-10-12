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
import type { Result as SharedResult } from "types";
import type { Brief } from "../types";

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
