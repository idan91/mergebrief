// Closure-free BriefScreen logic: derivations extracted from the screen/hooks
// so they are unit-testable directly, without rendering.
import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import type { Result, ValueOf } from "types/utils";
import {
  type CommentSide,
  CommentSides,
  type LineHashTarget,
  type RiskEvidence,
  type RiskEvidenceKind,
} from "@web/features/review/utils";
import {
  ViewportBands,
  type ViewportBand,
} from "@web/hooks/useViewportBoundary";
import type { CompareParam } from "../../comparison/compareState";
import type { ComparisonQuery } from "../../comparison/comparisonQuery";
import {
  buildChunkComparisonView,
  type ComparisonMarkFiles,
} from "../../comparison/runs";
import type { ConversationPlan } from "@web/features/conversation";
import type { BriefChunkSize } from "@web/utils/diffTokens/types";
import type { ProgressTotals } from "../../utils/progress";
import type {
  BriefChunk,
  ComparisonAvailability,
  IntentCheck,
  RevisionNarrative,
  RevisionNarrativeArtifact,
  RevisionNarrativeSkipReason,
} from "../../types";
import type { PostDraftOutcome } from "./useOwnDraftFlow";
import { type LineHashError, LineHashErrors } from "./types";

/** Typed placeholder for a plan slot that is absent, always `enabled: false`. */
export function disabledComparisonQuery<T>(slot: string): ComparisonQuery<T> {
  return {
    queryKey: ["comparison-plan-disabled", slot],
    queryFn: () => Promise.reject(new Error("comparison query disabled")),
  };
}

/**
 * Total contiguous marked runs across the brief's chunks, the comparison
 * overlay's jump-nav count. 0 without marks (overlay off or unavailable).
 */
export function countComparisonRuns(
  chunks: BriefChunk[],
  marks: ComparisonMarkFiles | null,
): number {
  if (marks === null) return 0;
  return chunks.reduce(
    (total, chunk) =>
      total + buildChunkComparisonView(chunk, marks).runs.length,
    0,
  );
}

/**
 * Per-group changed-since counts: DISTINCT member files with a nonempty entry
 * in the last-review marks. `undefined` without marks, no checkpoint means no
 * marker, distinct from a checkpoint with zero changes. Mechanical marks only:
 * narrative/Delta text never decides the count.
 */
export function groupSinceMarkers(
  groups: { id: string; chunks: { file: string }[] }[],
  marks: ComparisonMarkFiles | null,
): Map<string, number> | undefined {
  if (marks === null) return undefined;
  const changedFiles = new Set(
    marks.files
      .filter(
        (entry) => entry.addedRanges.length + entry.removedRanges.length > 0,
      )
      .map((entry) => entry.file),
  );
  return new Map(
    groups.map((group) => [
      group.id,
      new Set(
        group.chunks
          .map((chunk) => chunk.file)
          .filter((file) => changedFiles.has(file)),
      ).size,
    ]),
  );
}

/**
 * Soft-gate line: count of precise stated-but-missing asks. Zero on
 * broad/none or a pre-feature Brief. Never feeds the gate's OPEN condition.
 */
export function countIntentGaps(intentCheck: IntentCheck | undefined): number {
  return intentCheck?.specificity === "precise"
    ? intentCheck.statedButMissing.length
    : 0;
}

/**
 * Soft-gate line 2: count of precise intent TENSIONS, unacknowledged
 * deviations plus claimed-but-unachieved. Acknowledged deviations are excluded:
 * the description already owns that reversal. Never part of the gate's OPEN
 * condition.
 */
export function countIntentTensions(
  intentCheck: IntentCheck | undefined,
): number {
  return intentCheck?.specificity === "precise"
    ? intentCheck.deviations.filter((item) => !item.acknowledged).length +
        intentCheck.claimedButUnachieved.length
    : 0;
}

/**
 * Which groups carry conversation threads, the TocBar's markers. Undefined
 * when there is no conversation (or none of it landed on a chunk).
 */
export function conversationGroupIds(
  conversationByChunk: ReadonlyMap<string, unknown> | undefined,
  groups: readonly { id: string; chunks: readonly { id: string }[] }[],
): Set<string> | undefined {
  if (conversationByChunk === undefined || conversationByChunk.size === 0)
    return undefined;
  const ids = new Set<string>();
  for (const group of groups) {
    if (group.chunks.some((chunk) => conversationByChunk.has(chunk.id))) {
      ids.add(group.id);
    }
  }
  return ids;
}

/** Index where each group's first chunk lands in the flat reading order. */
export function groupStartIndexes(
  groups: readonly { chunks: readonly unknown[] }[],
): number[] {
  let offset = 0;
  const boundaries: number[] = [];
  for (const group of groups) {
    boundaries.push(offset);
    offset += group.chunks.length;
  }
  return boundaries;
}

export interface DeriveBriefProgressInput {
  /** Own-draft state: flag dispositions are unreachable (read-only mirror), so progress is chunk read-through only. */
  ownDraftActive: boolean;
  totals: ProgressTotals;
  flagCount: number;
}

/** Overall review progress in percent (0–100); 0 when there is no work. */
export function deriveBriefProgress(input: DeriveBriefProgressInput): number {
  const { ownDraftActive, totals, flagCount } = input;
  const totalWork = ownDraftActive
    ? totals.chunkTotal
    : flagCount + totals.chunkTotal;
  const done = ownDraftActive
    ? totals.reviewed
    : totals.reviewed + totals.flagsResolved;
  return totalWork === 0 ? 0 : (done / totalWork) * 100;
}

export interface LocalComparisonIds {
  marksId: string | undefined;
  narrativeId: string | undefined;
  deltaId: string | undefined;
}

/**
 * The active baseline's local sidecar ids: marks follow the baseline;
 * narrative is previous-brief-only, delta last-review-only.
 */
export function resolveLocalComparisonIds(
  compare: CompareParam,
  comparisons: ComparisonAvailability | undefined,
): LocalComparisonIds {
  const marksIdByCompare: Record<CompareParam, string | undefined> = {
    "previous-brief": comparisons?.previousBrief?.marksId,
    "last-review": comparisons?.lastReview?.marksId,
    off: undefined,
  };

  return {
    marksId: marksIdByCompare[compare],
    narrativeId:
      compare === "previous-brief"
        ? comparisons?.previousBrief?.narrativeId
        : undefined,
    deltaId:
      compare === "last-review" ? comparisons?.lastReview?.deltaId : undefined,
  };
}

export interface DiscriminatedNarrative {
  narrative: RevisionNarrative | null;
  skipReason: RevisionNarrativeSkipReason | null;
}

/**
 * An artifact's presence only means "something was fetched"; a skip stub is
 * narrative-unavailable with a knowable reason, discriminate on the kind.
 */
export function discriminateNarrativeArtifact(
  artifact: RevisionNarrativeArtifact | null,
): DiscriminatedNarrative {
  if (artifact === null) return { narrative: null, skipReason: null };
  return artifact.artifactKind === "revisionNarrative"
    ? { narrative: artifact, skipReason: null }
    : { narrative: null, skipReason: artifact.skipped };
}

/**
 * Batch "post my drafts, then mark ready" failure toast: honest counts prefix
 * and the explicit NOT-marked-ready suffix on every variant; guidance branches
 * on the stop-cause. Only `indeterminate` reads as may-have-posted, a
 * confident "not posted" there would invite a double-posting retry.
 */
const BATCH_CAUSE_KEYS = {
  rejected: "brief.markReadyBatch.causeRejected",
  unauthorized: "brief.markReadyBatch.causeUnauthorized",
  stale: "brief.markReadyBatch.causeStale",
  "not-found": "brief.markReadyBatch.causeNotFound",
  indeterminate: "brief.markReadyBatch.causeIndeterminate",
} as const satisfies Record<
  Exclude<PostDraftOutcome, "posted">,
  TranslationKey
>;

export function markReadyBatchFailureCopy(
  t: TFunction,
  posted: number,
  total: number,
  cause: Exclude<PostDraftOutcome, "posted">,
): string {
  return [
    t("brief.markReadyBatch.counts", { posted, total }),
    t(BATCH_CAUSE_KEYS[cause]),
    t("brief.markReadyBatch.suffix"),
  ].join(" ");
}

/** The running batch's confirm-button pending label, if a batch runs. */
export function markReadyBatchBusyLabel(
  t: TFunction,
  batch: { current: number; total: number } | null,
): string | undefined {
  return batch !== null
    ? t("brief.markReadyBatch.busyLabel", {
        current: batch.current,
        total: batch.total,
      })
    : undefined;
}

/** A copy of `current` with `member` toggled in or out. */
export function toggleSetMember(
  current: ReadonlySet<string>,
  member: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(member)) next.delete(member);
  else next.add(member);
  return next;
}

/**
 * Address-with-evidence resolution: linked-comment without a chosen comment
 * falls back to chunk-reviewed on the flag's chunk.
 */
export function resolveRiskEvidence(
  kind: RiskEvidenceKind,
  commentId: string | undefined,
  note: string | undefined,
  chunkId: string,
): RiskEvidence {
  if (kind === "linked-comment")
    return commentId
      ? { kind, commentId }
      : { kind: "chunk-reviewed", chunkId };
  if (kind === "chunk-reviewed") return { kind, chunkId };
  return note ? { kind, note } : { kind };
}

/** User inputs that abort an in-flight programmatic landing. */
export const SCROLL_ABORT_EVENTS = ["wheel", "touchstart", "keydown"] as const;

/** The whole pinned stack as one registered length; the header writes it. */
export const STICKY_STACK_HEIGHT_VAR = "--sticky-stack-h";

export function readNumericCssVar(name: string): number {
  if (typeof window === "undefined") return 0;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name);
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface VerticalExtent {
  top: number;
  bottom: number;
}

/** Air between a corrected row and the edge of the band it was past. */
const ROW_LANDING_GAP_PX = 16;

/**
 * How far to scroll so a landed row is readable, 0 when it already is. The
 * band runs from the pinned stack to the viewport bottom. The move is the
 * smallest that clears the edge the row is past, so a few clipped pixels never
 * cost a jump. A row taller than the band can never fit: its head goes under
 * the stack, and counts as readable anywhere in the band's upper half.
 */
export function deriveRowLandingCorrection(
  extent: VerticalExtent,
  stickyStackHeight: number,
  viewportHeight: number,
): number {
  const bandHeight = viewportHeight - stickyStackHeight;
  const bandMiddle = stickyStackHeight + bandHeight / 2;
  const rowHeight = extent.bottom - extent.top;

  if (rowHeight > bandHeight) {
    const headReadable =
      extent.top >= stickyStackHeight && extent.top <= bandMiddle;
    if (headReadable) return 0;
    return extent.top - (stickyStackHeight + ROW_LANDING_GAP_PX);
  }

  if (extent.top < stickyStackHeight)
    return extent.top - (stickyStackHeight + ROW_LANDING_GAP_PX);
  if (extent.bottom > viewportHeight)
    return extent.bottom - (viewportHeight - ROW_LANDING_GAP_PX);
  return 0;
}

/**
 * The header queries this boundary to collapse its title as content reaches it.
 * Keep this behavioral marker outside both views so switching cannot unmount it.
 * It is not a styling or test hook.
 */
export const CONTENT_START_ATTR = "data-content-start";

/** The focus target of a sidebar-originated jump: the group card's heading. */
export function deriveGroupHeadingId(groupId: string): string {
  return `${groupId}-heading`;
}

/** The in-flow anchor of a group: its section, which heads the card at every width. */
export function deriveGroupSectionId(groupId: string): string {
  return `${groupId}-section`;
}

const CHUNK_HASH_PREFIX = "#chunk-";
/** The charset chunk ids are generated from; anything else is not a deep link. */
const CHUNK_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** The page's address with a hash of the caller's choosing, ready to share. */
export function deriveShareUrl(
  location: Pick<Location, "origin" | "pathname" | "search">,
  hash: string,
): string {
  return `${location.origin}${location.pathname}${location.search}${hash}`;
}

/** The URL hash that deep-links a chunk; the app lands it, never the browser. */
export function deriveChunkHash(chunkId: string): string {
  return `${CHUNK_HASH_PREFIX}${chunkId}`;
}

export function resolveChunkIdFromHash(hash: string): string | undefined {
  if (!hash.startsWith(CHUNK_HASH_PREFIX)) return undefined;
  const chunkId = hash.slice(CHUNK_HASH_PREFIX.length);

  return CHUNK_ID_PATTERN.test(chunkId) ? chunkId : undefined;
}

const LINE_SIDE_LETTERS: Record<CommentSide, string> = {
  [CommentSides.OLD]: "L",
  [CommentSides.NEW]: "R",
};
const SIDE_BY_LETTER: Record<string, CommentSide> = {
  L: CommentSides.OLD,
  R: CommentSides.NEW,
};
const LINE_PART_PATTERN = /^([LR])(\d+)(?:-([LR])(\d+))?$/;
/** The path characters a hash cannot carry as they are. */
const PATH_ESCAPE_PATTERN = /[%#?\s]/g;

function encodeHashPath(file: string): string {
  return file.replace(PATH_ESCAPE_PATTERN, (char) => encodeURIComponent(char));
}

/** `#<path>:<S><n>` or `#<path>:<S><a>-<S><b>`, `S` being `L` (old) or `R` (new). */
export function deriveLineHash(target: LineHashTarget): string {
  const endLetter = LINE_SIDE_LETTERS[target.side];
  const startLetter = LINE_SIDE_LETTERS[target.startSide ?? target.side];
  const start = `${startLetter}${String(target.startLine)}`;
  const end = `${endLetter}${String(target.endLine)}`;
  const single =
    target.startSide === undefined && target.startLine === target.endLine;
  const lines = single ? start : `${start}-${end}`;

  return `#${encodeHashPath(target.file)}:${lines}`;
}

function parseLinePart(part: string): Omit<LineHashTarget, "file"> | undefined {
  const match = LINE_PART_PATTERN.exec(part);
  if (match === null) return undefined;
  const [, startLetter = "", startDigits = "", endLetter, endDigits] = match;
  const startSide = SIDE_BY_LETTER[startLetter];
  const startLine = Number(startDigits);
  if (startSide === undefined || startLine < 1) return undefined;
  if (endLetter === undefined || endDigits === undefined) {
    return { side: startSide, startLine, endLine: startLine };
  }
  const side = SIDE_BY_LETTER[endLetter];
  const endLine = Number(endDigits);
  if (side === undefined || endLine < 1) return undefined;
  if (side === startSide) {
    return endLine < startLine ? undefined : { side, startLine, endLine };
  }

  return { side, startSide, startLine, endLine };
}

/** The fragment the router takes: the address bar's hash without its mark. */
export function stripHashMark(hash: string): string {
  return hash.startsWith("#") ? hash.slice(1) : hash;
}

/** The line shape only; a chunk hash is the chunk parser's. */
export function parseLineHash(
  hash: string,
): Result<LineHashTarget, LineHashError> {
  if (!hash.startsWith("#") || resolveChunkIdFromHash(hash) !== undefined) {
    return { ok: false, error: LineHashErrors.NOT_LINE_HASH };
  }
  const body = hash.slice(1);
  const split = body.lastIndexOf(":");
  if (split === -1) return { ok: false, error: LineHashErrors.NOT_LINE_HASH };
  const lines = parseLinePart(body.slice(split + 1));
  const encodedFile = body.slice(0, split);
  if (lines === undefined || encodedFile.length === 0) {
    return { ok: false, error: LineHashErrors.MALFORMED };
  }
  try {
    return {
      ok: true,
      value: { file: decodeURIComponent(encodedFile), ...lines },
    };
  } catch {
    return { ok: false, error: LineHashErrors.MALFORMED };
  }
}

/** What the reading column reserves for the Sidebar. */
export const SidebarLayouts = {
  COLLAPSED: "collapsed",
  EXPANDED: "expanded",
  BAR: "bar",
} as const;

export type SidebarLayout = ValueOf<typeof SidebarLayouts>;

/** The bar's height below the breakpoint, else the column's width. */
export function resolveSidebarLayout(
  band: ViewportBand,
  expanded: boolean,
): SidebarLayout {
  if (band === ViewportBands.NARROW) return SidebarLayouts.BAR;
  return expanded ? SidebarLayouts.EXPANDED : SidebarLayouts.COLLAPSED;
}

/** The file and row count the grammar budget reads, per chunk that has a diff. */
export function deriveChunkSizes(chunks: BriefChunk[]): BriefChunkSize[] {
  const sizes: BriefChunkSize[] = [];

  for (const chunk of chunks) {
    const rowCount = chunk.diff?.length ?? 0;
    if (rowCount === 0) continue;

    sizes.push({ file: chunk.file, rowCount });
  }

  return sizes;
}

/**
 * The plan with each posted reply reporting its wrapping review id, so the
 * reply reads as the reviewer's own before the next session read confirms it.
 */
export function buildReplyRecordingPlan(
  plan: ConversationPlan,
  recordSubmittedReview: (reviewId: number) => void,
): ConversationPlan {
  return {
    ...plan,
    postReply: async (rootCommentId, body) => {
      const result = await plan.postReply(rootCommentId, body);
      if (result.kind === "posted" && result.reviewId !== undefined) {
        recordSubmittedReview(result.reviewId);
      }
      return result;
    },
  };
}
