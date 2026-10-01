// Closure-free BriefScreen logic: derivations extracted from the screen/hooks
// so they are unit-testable directly, without rendering.
import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import type { Result, ValueOf } from "types/utils";
import {
  type CommentSide,
  CommentSides,
  type LineLinkTarget,
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
import { CHUNK_LANDING_GAP_PX } from "./consts";
import {
  type LinkParamError,
  LinkParamErrors,
  type LinkTarget,
  LinkTargetKinds,
} from "./types";

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

/** Air between a corrected head and the pinned stack. */
const ROW_LANDING_GAP_PX = 16;
/** Where a corrected row's top lands, as a share of the band below the stack. */
const ROW_LANDING_BAND_SHARE = 1 / 3;

/**
 * How far to scroll so a landed row reads, 0 when it already does. The band
 * runs from the pinned stack to the viewport bottom; a row is readable when
 * it is whole in the band with its top in the upper half. Any other row
 * moves so its top sits a third of the way down the band, so a landing never
 * leaves the row at the viewport's edge. A row taller than the band can
 * never fit: its head goes under the stack, and counts as readable anywhere
 * in the band's upper half.
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
    return deriveHeadLandingCorrection(
      extent,
      stickyStackHeight,
      bandMiddle,
      stickyStackHeight + ROW_LANDING_GAP_PX,
    );
  }
  const readable =
    extent.top >= stickyStackHeight &&
    extent.top <= bandMiddle &&
    extent.bottom <= viewportHeight;
  if (readable) {
    return 0;
  }

  return extent.top - (stickyStackHeight + bandHeight * ROW_LANDING_BAND_SHARE);
}

/**
 * How far to scroll so a landed card's head sits under the stack where the
 * chunk scroller puts it, 0 while the head is anywhere in the band's upper
 * half. A windowed list's late measurements can push a landed card out.
 */
export function deriveCardLandingCorrection(
  extent: VerticalExtent,
  stickyStackHeight: number,
  viewportHeight: number,
): number {
  const bandMiddle =
    stickyStackHeight + (viewportHeight - stickyStackHeight) / 2;

  return deriveHeadLandingCorrection(
    extent,
    stickyStackHeight,
    bandMiddle,
    stickyStackHeight + CHUNK_LANDING_GAP_PX,
  );
}

function deriveHeadLandingCorrection(
  extent: VerticalExtent,
  stickyStackHeight: number,
  bandMiddle: number,
  restingTop: number,
): number {
  const headReadable =
    extent.top >= stickyStackHeight && extent.top <= bandMiddle;
  if (headReadable) {
    return 0;
  }

  return extent.top - restingTop;
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

/** The search param that names a chunk, or lines inside one, to land on. */
export const LINK_PARAM = "l";
const CHUNK_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
/** Between the chunk id and the lines; both encoders leave it as it is. */
const LINK_LINES_SEPARATOR = ".";

/** The search param that names a thread to open; its landing owns the arrival. */
const THREAD_PARAM = "thread";

/** The page's address with the link param set to `link`, ready to share. */
export function deriveShareUrl(
  location: Pick<Location, "href">,
  link: string,
): string {
  const url = new URL(location.href);
  url.searchParams.set(LINK_PARAM, link);
  url.searchParams.delete(THREAD_PARAM);
  url.hash = "";

  return url.href;
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

/** `<chunk>.<S><n>` or `<chunk>.<S><a>-<S><b>`, `S` being `L` (old) or `R` (new). */
export function deriveLineLink(target: LineLinkTarget): string {
  const endLetter = LINE_SIDE_LETTERS[target.side];
  const startLetter = LINE_SIDE_LETTERS[target.startSide ?? target.side];
  const start = `${startLetter}${String(target.startLine)}`;
  const end = `${endLetter}${String(target.endLine)}`;
  const single =
    target.startSide === undefined && target.startLine === target.endLine;
  const lines = single ? start : `${start}-${end}`;

  return `${target.chunkId}${LINK_LINES_SEPARATOR}${lines}`;
}

function parseLinePart(
  part: string,
): Omit<LineLinkTarget, "chunkId"> | undefined {
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

/** A chunk id alone, or a chunk id and the lines after the last separator. */
export function parseLinkParam(
  link: string,
): Result<LinkTarget, LinkParamError> {
  const split = link.lastIndexOf(LINK_LINES_SEPARATOR);
  const chunkId = split === -1 ? link : link.slice(0, split);
  const lines = split === -1 ? undefined : parseLinePart(link.slice(split + 1));
  if (lines !== undefined && CHUNK_ID_PATTERN.test(chunkId)) {
    return {
      ok: true,
      value: { kind: LinkTargetKinds.LINES, lines: { chunkId, ...lines } },
    };
  }
  if (CHUNK_ID_PATTERN.test(link)) {
    return { ok: true, value: { kind: LinkTargetKinds.CHUNK, chunkId: link } };
  }

  return { ok: false, error: LinkParamErrors.MALFORMED };
}

/** The chunk a link names, alone or around its lines; absent when it names none. */
export function resolveLinkChunkId(
  link: string | undefined,
): string | undefined {
  if (link === undefined) {
    return undefined;
  }
  const parsed = parseLinkParam(link);
  if (!parsed.ok) {
    return undefined;
  }

  return parsed.value.kind === LinkTargetKinds.CHUNK
    ? parsed.value.chunkId
    : parsed.value.lines.chunkId;
}

/** Whether a written link names lines rather than a chunk; absent is neither. */
export function isLineLink(link: string | undefined): boolean {
  if (link === undefined) {
    return false;
  }
  const parsed = parseLinkParam(link);

  return parsed.ok && parsed.value.kind === LinkTargetKinds.LINES;
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

/** Whether any narrative chunk names a line the revision removed. */
export function hasRemovedLines(narrative: RevisionNarrative | null): boolean {
  return (
    narrative !== null &&
    narrative.chunks.some((chunk) => chunk.removedRanges.length > 0)
  );
}
