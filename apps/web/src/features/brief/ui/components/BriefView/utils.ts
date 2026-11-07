// Closure-free BriefView logic: derivations extracted from the view hooks
// so they are unit-testable directly, without rendering.
import type { AttributeDisplayMeta } from "../../../model/utils/repo-config";
import {
  DiffLineKinds,
  type DiffSide,
  DiffSides,
  type DispositionEvidenceKind,
  DispositionEvidenceKinds,
  type Result,
  type ValueOf,
} from "types";
import type { StoredRevisionNarrative } from "brief-core/artifact";
import { formatDisplayPath } from "brief-core/hidden-chars";
import { FileStatuses, resolveFileStatus } from "brief-core/chunk-layout";
import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import {
  type RevisionNarrativeSkipReason,
  Specificities,
  type IntentCheck,
  type RevisionNarrative,
} from "brief-core/types";
import {
  type LineLinkTarget,
  type RiskEvidence,
} from "@web/features/review/utils";
import {
  ViewportBands,
  type ViewportBand,
} from "@web/hooks/useViewportBoundary";
import { splitPathSegments } from "@web/components/BreakablePath/utils";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import type { ComparisonQuery } from "../../../model/comparison/comparison-query";
import {
  buildChunkComparisonView,
  type ComparisonMarkFiles,
} from "../../../model/comparison/runs";
import type { ConversationPlan } from "@web/features/conversation";
import { ReplyResultKinds } from "@web/features/conversation/types";
import type { BriefChunkSize } from "@web/utils/diffTokens/types";
import type { ProgressTotals } from "../../utils/progress";
import { type BriefChunk, type ComparisonMarks } from "../../../model/types";
import {
  readStoredCounts,
  type StoredChunkCounts,
} from "../../../model/chunk-layout/useChunkLayout";
import { getShortSha } from "../../../model/utils/short-sha";
import {
  LARGE_CHUNK_CHANGED_LINES,
  NO_REVIEW_REASON_KEY,
  OWN_DRAFT_STALE_COMPOSER_REASON_KEY,
  SESSION_FROZEN_REASON_KEY,
} from "./consts";
import type { RevisionNavigation } from "../../hooks/useRevisionNavigation";
import {
  type AnnouncedRevisionNavInput,
  type ConversationReadOnly,
  type DiffViewToggleInput,
  type FilePathParts,
  type GithubHeadRef,
  type LinkParamError,
  LinkParamErrors,
  type LinkTarget,
  LinkTargetKinds,
  type MarkReadyBatch,
  PostDraftOutcomes,
  type PostDraftOutcome,
  type ReviewCapability,
  type SinceMarkers,
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
  if (marks === null) {
    return 0;
  }
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
  if (marks === null) {
    return undefined;
  }
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

export function deriveSinceMarkers(
  groups: { id: string; chunks: { file: string }[] }[],
  marks: Pick<ComparisonMarks, "baselineSha" | "files"> | null,
): SinceMarkers | undefined {
  const counts = groupSinceMarkers(groups, marks);
  const nothingToMark = counts === undefined || marks === null;
  if (nothingToMark) {
    return undefined;
  }

  return { counts, baselineShortSha: getShortSha(marks.baselineSha) };
}

/**
 * Soft-gate line: count of precise stated-but-missing asks. Zero on
 * broad/none or a pre-feature Brief. Never feeds the gate's OPEN condition.
 */
export function countIntentGaps(intentCheck: IntentCheck | undefined): number {
  return intentCheck?.specificity === Specificities.PRECISE
    ? intentCheck.statedButMissing.length
    : 0;
}

/**
 * Soft-gate line 2: count of precise intent TENSIONS, unacknowledged
 * deviations plus masked fixes. Acknowledged deviations are excluded:
 * the description already owns that reversal. Never part of the gate's OPEN
 * condition.
 */
export function countIntentTensions(
  intentCheck: IntentCheck | undefined,
): number {
  return intentCheck?.specificity === Specificities.PRECISE
    ? intentCheck.deviations.filter((item) => !item.acknowledged).length +
        intentCheck.maskedFixes.length
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
  if (conversationByChunk === undefined || conversationByChunk.size === 0) {
    return undefined;
  }
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

export function countChangedLines(chunk: Pick<BriefChunk, "loc">): number {
  return chunk.loc.added + chunk.loc.deleted;
}

export function isLargeChunk(chunk: Pick<BriefChunk, "loc">): boolean {
  return countChangedLines(chunk) > LARGE_CHUNK_CHANGED_LINES;
}

/**
 * The chunk's file on GitHub at head. The hunk header says whether the file
 * still exists there, a deleted file having no page; before it lands, added
 * lines already prove the file is there.
 */
export function resolveChunkGithubUrl(
  chunk: Pick<BriefChunk, "file" | "diff" | "loc">,
  githubHead: GithubHeadRef | undefined,
): string | undefined {
  const hasNoPageAtHead = githubHead === undefined || !isFileAtHead(chunk);
  if (hasNoPageAtHead) {
    return undefined;
  }
  return buildGithubFileUrl(githubHead.repoSlug, githubHead.sha, chunk.file);
}

function isFileAtHead(chunk: Pick<BriefChunk, "diff" | "loc">): boolean {
  const rows = chunk.diff ?? [];
  if (!rows.some((row) => row.kind === DiffLineKinds.HUNK)) {
    return chunk.loc.added > 0;
  }
  return resolveFileStatus(rows) !== FileStatuses.DELETED;
}

/** A file as GitHub shows it at one commit, each path segment encoded on its own so the slashes stay. */
function buildGithubFileUrl(
  repoSlug: string,
  sha: string,
  path: string,
): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repoSlug}/blob/${sha}/${encodedPath}`;
}

export function listLargeChunkIds(
  chunks: readonly Pick<BriefChunk, "id" | "loc">[],
): Set<string> {
  const largeChunks = chunks.filter(isLargeChunk);
  return new Set(largeChunks.map((chunk) => chunk.id));
}

export function listInitiallyOpenChunkIds(
  groups: readonly {
    chunks: readonly Pick<BriefChunk, "id" | "loc">[];
  }[],
): string[] {
  const chunks = groups.flatMap((group) => group.chunks);
  const openChunks = chunks.filter((chunk) => !isLargeChunk(chunk));
  return openChunks.map((chunk) => chunk.id);
}

/** Chunk ids in the rendered reading order, group by group. */
export function listChunkIds(
  groups: readonly { chunks: readonly { id: string }[] }[],
): string[] {
  return groups.flatMap((group) => group.chunks.map((chunk) => chunk.id));
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

export interface DiscriminatedNarrative {
  narrative: RevisionNarrative | null;
  skipReason: RevisionNarrativeSkipReason | null;
  /** The span holds no change of the PR's own, so no narrative is owed. */
  isUnchanged: boolean;
}

/**
 * An artifact's presence only means "something was fetched"; a skip stub is
 * narrative-unavailable with a knowable reason, and a no-change record says
 * the PR's change did not move: discriminate on the kind.
 */
export function discriminateNarrativeArtifact(
  artifact: StoredRevisionNarrative | null,
): DiscriminatedNarrative {
  const none = { narrative: null, skipReason: null, isUnchanged: false };
  if (artifact === null) {
    return none;
  }
  if (artifact.artifactKind === "revisionNarrative") {
    return { ...none, narrative: artifact };
  }
  if (artifact.artifactKind === "revisionNarrativeUnchanged") {
    return { ...none, isUnchanged: true };
  }
  return { ...none, skipReason: artifact.skipped };
}

/**
 * Batch "post my drafts, then mark ready" failure toast: honest counts prefix
 * and the explicit NOT-marked-ready suffix on every variant; guidance branches
 * on the stop-cause. Only `indeterminate` reads as may-have-posted, a
 * confident "not posted" there would invite a double-posting retry.
 */
const BATCH_CAUSE_KEYS = {
  [PostDraftOutcomes.REJECTED]: "brief.markReadyBatch.causeRejected",
  [PostDraftOutcomes.NO_PERMISSION]: "brief.markReadyBatch.causeNoPermission",
  [PostDraftOutcomes.UNAUTHORIZED]: "brief.markReadyBatch.causeUnauthorized",
  [PostDraftOutcomes.STALE]: "brief.markReadyBatch.causeStale",
  [PostDraftOutcomes.NOT_FOUND]: "brief.markReadyBatch.causeNotFound",
  [PostDraftOutcomes.INDETERMINATE]: "brief.markReadyBatch.causeIndeterminate",
} as const satisfies Record<
  Exclude<PostDraftOutcome, typeof PostDraftOutcomes.POSTED>,
  TranslationKey
>;

export function markReadyBatchFailureCopy(
  t: TFunction,
  posted: number,
  total: number,
  cause: Exclude<PostDraftOutcome, typeof PostDraftOutcomes.POSTED>,
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
  batch: MarkReadyBatch | undefined,
): string | undefined {
  return batch !== undefined
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
  if (next.has(member)) {
    next.delete(member);
  } else {
    next.add(member);
  }
  return next;
}

/**
 * Address-with-evidence resolution: linked-comment without a chosen comment
 * falls back to chunk-reviewed on the flag's chunk.
 */
export function resolveRiskEvidence(
  kind: DispositionEvidenceKind,
  commentId: string | undefined,
  note: string | undefined,
  chunkId: string,
): RiskEvidence {
  if (kind === DispositionEvidenceKinds.LINKED_COMMENT) {
    if (commentId) {
      return { kind, commentId };
    }
    return { kind: DispositionEvidenceKinds.CHUNK_REVIEWED, chunkId };
  }
  if (kind === DispositionEvidenceKinds.CHUNK_REVIEWED) {
    return { kind, chunkId };
  }
  if (note) {
    return { kind, note };
  }
  return { kind };
}

/** The whole pinned stack as one registered length; the header writes it. */
export const STICKY_STACK_HEIGHT_VAR = "--sticky-stack-h";

export function readNumericCssVar(name: string): number {
  if (typeof window === "undefined") {
    return 0;
  }
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name);
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

/** The search param that names a chunk, or lines inside one, to scroll to. */
export const LINK_PARAM = "l";
const CHUNK_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
/** Between the chunk id and the lines; both encoders leave it as it is. */
const LINK_LINES_SEPARATOR = ".";

/** The search param that names a thread to open; its own scroll owns the arrival. */
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

const LINE_SIDE_LETTERS: Record<DiffSide, string> = {
  [DiffSides.OLD]: "L",
  [DiffSides.NEW]: "R",
};
const SIDE_BY_LETTER: Record<string, DiffSide> = {
  L: DiffSides.OLD,
  R: DiffSides.NEW,
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
  if (match === null) {
    return undefined;
  }
  const [, startLetter = "", startDigits = "", endLetter, endDigits] = match;
  const startSide = SIDE_BY_LETTER[startLetter];
  const startLine = Number(startDigits);
  if (startSide === undefined || startLine < 1) {
    return undefined;
  }
  if (endLetter === undefined || endDigits === undefined) {
    return { side: startSide, startLine, endLine: startLine };
  }
  const side = SIDE_BY_LETTER[endLetter];
  const endLine = Number(endDigits);
  if (side === undefined || endLine < 1) {
    return undefined;
  }
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
  if (band === ViewportBands.NARROW) {
    return SidebarLayouts.BAR;
  }
  return expanded ? SidebarLayouts.EXPANDED : SidebarLayouts.COLLAPSED;
}

/**
 * The file and row count the grammar budget reads, per card that has rows,
 * remainder cards included: the stored count where the brief carries one,
 * so the budget is planned before the code lands and holds when it does;
 * the sliced rows otherwise.
 */
export function deriveChunkSizes(
  chunks: readonly BriefChunk[],
  storedCounts?: StoredChunkCounts,
): BriefChunkSize[] {
  const sizes: BriefChunkSize[] = [];

  for (const chunk of chunks) {
    const stored = readStoredCounts(storedCounts, chunk);
    const rowCount = stored?.rows ?? chunk.diff?.length ?? 0;
    if (rowCount === 0) {
      continue;
    }

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
      if (
        result.kind === ReplyResultKinds.POSTED &&
        result.reviewId !== undefined
      ) {
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

/** The shown path's directories, each ending at its slash, and its basename. */
export function splitFilePath(path: string): FilePathParts {
  const segments = splitPathSegments(formatDisplayPath(path));
  const last = segments.at(-1);
  const endsInFile = last !== undefined && !last.text.endsWith("/");
  const directories = endsInFile ? segments.slice(0, -1) : segments;
  const basename = endsInFile ? last.text : "";

  return { directories, basename };
}

/** A missing review outranks a read-only one, which outranks a frozen session. */
export function deriveWritesDisabledReason(
  t: TFunction,
  review: Pick<ReviewCapability, "readOnly"> | undefined,
  sessionFrozen: boolean,
): string | undefined {
  if (review === undefined) {
    return t(NO_REVIEW_REASON_KEY);
  }
  const readOnlyReason = review.readOnly?.reason;
  if (readOnlyReason !== undefined) {
    return readOnlyReason;
  }

  return sessionFrozen ? t(SESSION_FROZEN_REASON_KEY) : undefined;
}

export function deriveComposerDisabledReason(
  t: TFunction,
  writesDisabledReason: string | undefined,
  staleOwnDraft: boolean,
): string | undefined {
  if (writesDisabledReason !== undefined) {
    return writesDisabledReason;
  }

  return staleOwnDraft ? t(OWN_DRAFT_STALE_COMPOSER_REASON_KEY) : undefined;
}

export function deriveConversationReadOnly(
  writesDisabledReason: string | undefined,
): ConversationReadOnly {
  return writesDisabledReason === undefined
    ? {}
    : { readOnlyReason: writesDisabledReason };
}

/**
 * Only the Full scope pairs rows. The Changes scope renders raw span diffs
 * that never split, so both entry points stand down there rather than
 * announcing a view the screen cannot show.
 */
export function resolveDiffViewToggle({
  t,
  view,
  setView,
  announce,
  inChangesScope,
}: DiffViewToggleInput): (() => void) | undefined {
  if (inChangesScope) {
    return undefined;
  }

  return () => {
    const next = view === DiffViews.SPLIT ? DiffViews.UNIFIED : DiffViews.SPLIT;
    setView(next);
    announce(
      next === DiffViews.SPLIT
        ? t("brief.diff.viewSplit")
        : t("brief.diff.viewUnified"),
    );
  };
}

export type RepoPolicyCaptionInput = Pick<
  AttributeDisplayMeta,
  "source" | "deEmphasized" | "implication"
>;

/** The repo-policy captions beside a risk label, on one line; a second caption reads mid-line. */
export function buildRepoPolicyCaption(
  t: TFunction,
  { source, deEmphasized, implication }: RepoPolicyCaptionInput,
): string | undefined {
  const captions: string[] = [];
  if (source === "repo-policy") {
    const lead =
      implication === undefined || implication === ""
        ? t("brief.riskBadge.repoPolicyLead")
        : t("brief.riskBadge.repoPolicyWithImplication", { implication });
    captions.push(lead);
  }
  if (deEmphasized) {
    const followsLead = captions.length > 0;
    captions.push(
      followsLead
        ? t("brief.riskBadge.deEmphasized", { context: "inline" })
        : t("brief.riskBadge.deEmphasized"),
    );
  }
  if (captions.length === 0) {
    return undefined;
  }
  return captions.join(" · ");
}

/** A wrap jumps to the far end; screen readers hear which end it reached. */
export function buildAnnouncedRevisionNav({
  t,
  revisionNav,
  announceQuietly,
}: AnnouncedRevisionNavInput): RevisionNavigation {
  return {
    jumpNext: () => {
      const step = revisionNav.jumpNext();
      if (step?.wrapped === true) {
        announceQuietly(t("brief.toolbar.changeStepperWrappedToFirst"));
      }
      return step;
    },
    jumpPrev: () => {
      const step = revisionNav.jumpPrev();
      if (step?.wrapped === true) {
        announceQuietly(t("brief.toolbar.changeStepperWrappedToLast"));
      }
      return step;
    },
  };
}

/**
 * The view a chunk's table draws, read from its claimed ranges so a card
 * still waiting on its code knows it: split only when the reader asked for
 * it, the chunk holds a line on each side, and the table is not a guest's.
 */
export function resolveChunkView(
  view: DiffView,
  chunk: Pick<BriefChunk, "addedRanges" | "removedRanges">,
  guest: boolean,
): DiffView {
  const pairable =
    chunk.addedRanges.length > 0 && chunk.removedRanges.length > 0;
  const drawsSplit = view === DiffViews.SPLIT && pairable && !guest;

  return drawsSplit ? DiffViews.SPLIT : DiffViews.UNIFIED;
}
