import type { DiffLine } from "@web/utils/diffTokens/types";
import { useTranslation } from "react-i18next";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";

import { rangeBetween } from "@web/utils/collections";
import { CommentComposer } from "@web/features/review";
import { CommentThread } from "@web/features/review";
import { ThreadRowView } from "@web/features/conversation";
import { demotedSubmittedCommentIds } from "@web/features/conversation/utils";

// Row-level threads already sit AT their line, so the detail's jump is hidden.
const noJump = () => undefined;
import { AddressedDiffComment } from "@web/features/review";
import {
  CommentSides,
  createCommentAnchor,
  createSideAnchor,
  isLineCommentAnchor,
  type LineCommentAnchor,
  type ReviewComment,
  rowId,
} from "@web/features/review/utils";
import type { ConversationThread } from "@web/features/conversation/types";
import type { BriefChunk } from "../../../types";
import {
  useChunkReviewComments,
  useReviewActions,
  useReviewCommentsForChunks,
  useReviewFlow,
} from "@web/features/review/session";
import { type ComparisonRun } from "../../../comparison/comparison";
import {
  ExpandControl,
  type ExpandedEvent,
} from "./ExpandControl/ExpandControl";
import { ComparisonCallout } from "./ComparisonCallout/ComparisonCallout";
import { RevisionGutterCell } from "./RevisionGutterCell/RevisionGutterCell";
import { SiblingSpanHeader } from "./SiblingSpanHeader/SiblingSpanHeader";
import { groupSiblingSpans } from "../../../utils/siblingSpans";
import { resolveSpanOwner } from "../../../utils/lineOwner";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import {
  type DiffRowView,
  getDiffRowView,
  resolveStrandedRows,
} from "./diffRowView";
import { DiffLineKinds } from "@web/utils/diffTokens/types";
import { computeIntraLineEmphasis } from "@web/components/DiffRows/diffPairedTokens";
import { pairSplitRows } from "@web/components/DiffRows/pairSplitRows";
import {
  hasPairedSides,
  isFullWidthDiffRow,
} from "@web/components/DiffRows/utils";
import {
  type DiffRowAttributes,
  DiffViews,
  type SplitSide,
  SplitSides,
} from "@web/components/DiffRows/types";
import { DiffRows } from "@web/components/DiffRows/DiffRows";
import styles from "./DiffTable.module.scss";
import type {
  DiffTableProps,
  DiffViewportStyle,
  UnderRowLayout,
  UnderRowProps,
} from "./types";
import {
  COMMENT_ANCHOR_ATTRIBUTES,
  EMPTY_EXPANDED_THREADS,
  EMPTY_GAP,
  EMPTY_REVIEW_COMMENTS,
  NO_DIFF,
  NO_EDGES,
  NO_HIDDEN_THREADS,
  NO_PAIRS,
  NO_SPANS,
} from "./consts";
import {
  buildExpandedRowView,
  buildPairPartners,
  collectAnchoredIndexes,
  collectOwnerRowIds,
  collectSideIndexes,
  collectSpannedRows,
  collectThreadLines,
  focusExpandedLine,
  frameSpans,
  frameSpansOnPairs,
  groupEdgesByRow,
  isSideFocusable,
  isSpanRowCommentable,
  isUpEdge,
  placementForAnchor,
  placementForThread,
  resolveDragSelection,
  resolveSpanLines,
  showsThreadOnRow,
  unzipPairsByOwner,
  spanForPlacement,
  unionRail,
} from "./utils";

export function DiffTable({
  tokensByRow,
  tokensPending = false,
  view: diffView = DiffViews.UNIFIED,
  chunk,
  comparisonView,
  comparisonSource,
  comparisonSkipReason,
  addressedComments,
  conversationThreadsByRow,
  conversationComposer,
  reviewCommentLabel,
  readOnlyReason,
  expansion,
  hiddenThreads = NO_HIDDEN_THREADS,
  fileThreads = NO_HIDDEN_THREADS,
  lineOwners,
  jumpToLine,
}: DiffTableProps) {
  const hiddenThreadLines = useMemo(
    () => collectThreadLines(hiddenThreads),
    [hiddenThreads],
  );
  const { t } = useTranslation();
  const baseRows = chunk.diff ?? NO_DIFF;
  // Rendered rows are the spliced ones; comments, marks and threads stay
  // keyed on base indexes and translate through `baseIndexOf`.
  const rows = expansion?.rows ?? baseRows;
  const baseIndexOf = expansion?.baseIndexOf;
  const edges = expansion?.edges ?? NO_EDGES;
  const edgesByRow = useMemo(() => groupEdgesByRow(edges), [edges]);
  const hasExpandedRows = baseIndexOf?.includes(-1) === true;
  // A line the chunk's own ranges hold is never a sibling's, whatever the
  // owner index says about it.
  const spans = useMemo(
    () =>
      lineOwners === undefined || !hasExpandedRows
        ? NO_SPANS
        : groupSiblingSpans(rows, (line) => {
            const owner = resolveSpanOwner(lineOwners, line)?.chunkId;
            return owner === chunk.id ? undefined : owner;
          }),
    [rows, lineOwners, hasExpandedRows, chunk.id],
  );
  const spanOwnerByRow = useMemo(() => {
    const byRow = new Map<number, string>();
    for (const span of spans) {
      for (const index of rangeBetween(span.start, span.end)) {
        byRow.set(index, span.owner);
      }
    }
    return byRow;
  }, [spans]);
  const canPairSides = useMemo(() => hasPairedSides(rows), [rows]);
  const split = diffView === DiffViews.SPLIT && canPairSides;
  const resolvedView = split ? DiffViews.SPLIT : DiffViews.UNIFIED;

  const pairRows = useCallback(
    () =>
      unzipPairsByOwner(pairSplitRows(rows), (index) =>
        spanOwnerByRow.get(index),
      ),
    [rows, spanOwnerByRow],
  );
  const pairs = useMemo(
    () => (split ? pairRows() : NO_PAIRS),
    [split, pairRows],
  );
  const spanFrames = useMemo(
    () => (split ? frameSpansOnPairs(spans, pairs) : frameSpans(spans)),
    [spans, split, pairs],
  );
  const spanStarts = useMemo(
    () => new Map(spanFrames.map((frame) => [frame.headerAt, frame])),
    [spanFrames],
  );
  const spanEnds = useMemo(
    () => new Set(spanFrames.map((frame) => frame.endAt)),
    [spanFrames],
  );
  const spannedRows = useMemo(
    () => collectSpannedRows(spanFrames),
    [spanFrames],
  );
  const spanOwnerIds = useMemo(
    () => [...new Set(spans.map((span) => span.owner))].toSorted(),
    [spans],
  );
  const ownerChunkById = useMemo(
    () => new Map(lineOwners?.chunks.map((owner) => [owner.id, owner])),
    [lineOwners],
  );
  // Once per row set, not per render: a drag re-renders the table on every
  // row the pointer crosses, and the owner's diff scan is per span row.
  const commentableSpanRows = useMemo(() => {
    const commentable = new Set<number>();
    for (const [index, owner] of spanOwnerByRow) {
      const line = rows[index];
      if (line === undefined) continue;
      if (isSpanRowCommentable(line, ownerChunkById.get(owner))) {
        commentable.add(index);
      }
    }
    return commentable;
  }, [rows, spanOwnerByRow, ownerChunkById]);
  const pairPartners = useMemo(() => buildPairPartners(pairs), [pairs]);
  // Unified pairs the same rows for emphasis without rendering them paired.
  const emphasisByRow = useMemo(
    () => computeIntraLineEmphasis(split ? pairs : pairRows(), tokensByRow),
    [pairs, pairRows, split, tokensByRow],
  );
  const readOnly = readOnlyReason !== undefined;
  // Every stateful read below is chunk-scoped so this table re-renders for
  // ITS composer/posts only, never a sibling's.
  const {
    openComposer,
    cancelComposer,
    saveComment,
    deleteComment,
    toggleComment,
    toggleConversationThread,
    updateComment,
    announce,
  } = useReviewActions();
  const chunkComments = useChunkReviewComments(chunk.id);
  const allComments = readOnly ? EMPTY_REVIEW_COMMENTS : chunkComments;
  const ownerComments = useReviewCommentsForChunks(spanOwnerIds);
  const allSpanComments = readOnly ? EMPTY_REVIEW_COMMENTS : ownerComments;
  // Server-backed wins: once a posted comment's own GitHub thread renders in
  // this chunk, the local submitted card demotes out of display. With no
  // conversation loaded there are no own threads, so local cards stay.
  const ownChunkThreads = useMemo(
    () =>
      [...(conversationThreadsByRow?.values() ?? [])]
        .flat()
        .filter((row) => row.isOwn)
        .map((row) => row.thread),
    [conversationThreadsByRow],
  );
  const comments = useMemo(
    () => demoteSubmitted(allComments, ownChunkThreads),
    [allComments, ownChunkThreads],
  );
  // A span shows the owners' threads too, so the same demotion applies.
  const ownFileThreads = useMemo(
    () => fileThreads.filter((row) => row.isOwn).map((row) => row.thread),
    [fileThreads],
  );
  const spanComments = useMemo(
    () => demoteSubmitted(allSpanComments, ownFileThreads),
    [allSpanComments, ownFileThreads],
  );
  // Anchor-match selector: null (stable) unless the composer is hosted by
  // THIS table. A span row's composer anchors to the owner but opens here.
  const composerSaving = useReviewFlow((state) => state.composerSaving);
  const anchorForChunk = useReviewFlow((state) => {
    const anchor = state.composerAnchor;
    if (anchor === null || !isLineCommentAnchor(anchor)) return null;
    return state.composerHost === chunk.id ? anchor : null;
  });
  const activeCommentAnchor = readOnly ? null : anchorForChunk;
  const activeSpanIndexes = useMemo(() => {
    if (
      activeCommentAnchor === null ||
      activeCommentAnchor.chunkId === chunk.id
    ) {
      return EMPTY_EXPANDED_THREADS;
    }
    return new Set(
      collectAnchoredIndexes(rows, activeCommentAnchor).filter((index) =>
        spanOwnerByRow.has(index),
      ),
    );
  }, [activeCommentAnchor, chunk.id, rows, spanOwnerByRow]);
  /**
   * Why comment composition is disabled. When set, commentable rows stay
   * focusable but carry `aria-disabled` + an `aria-describedby` reason, and
   * selection/composer entry is inert.
   */
  const postureDisabledReason = useReviewFlow(
    (state) => state.composerDisabledReason,
  );
  const composerDisabledReason = readOnlyReason ?? postureDisabledReason;
  // Post a staged draft now; undefined hides the Post affordance entirely.
  const postComment = useReviewFlow((state) => state.postComment);
  const postReviewComment = readOnly ? undefined : postComment;
  // Wait-shaped reason every Post is blocked right now (submit in flight).
  const postBlockedExternally = useReviewFlow(
    (state) => state.postBlockedExternally,
  );
  // In-flight post-now ids scoped to THIS chunk's comments (the registry's
  // set covers the whole brief, so an unscoped read would re-render every
  // expanded table on any post).
  const postingCommentIds = useReviewFlow(
    useShallow((state) =>
      comments
        .filter((comment) => state.postingCommentIds.has(comment.id))
        .map((comment) => comment.id),
    ),
  );
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragSide, setDragSide] = useState<SplitSide | undefined>(undefined);
  const [dragCurrentSide, setDragCurrentSide] = useState<SplitSide | undefined>(
    undefined,
  );
  const tableRef = useRef<HTMLTableElement>(null);
  // Instance-scoped id for the read-only reason the disabled rows point at
  // (declared before the no-diff early return, for hooks order).
  const composerDisabledReasonId = `${useId()}-composer-disabled`;
  const expandedReasonId = `${useId()}-outside-diff`;
  // What a click just expanded, settled in the layout effect once the rows
  // land: the control's row keeps its viewport top, or, when the row went
  // with the closed gap, focus moves onto the first line that arrived.
  const landingRef = useRef<ExpandedEvent | null>(null);
  const landingTopRef = useRef(0);
  // Store-owned so it survives this card unmounting offscreen; the key is
  // file-qualified because a bare chunk id can collide across diff sources.
  const chunkKey = `${chunk.file}#${chunk.id}`;
  const expandedConversation =
    useReviewFlow((state) => state.expandedConversations.get(chunkKey)) ??
    EMPTY_EXPANDED_THREADS;
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);
  const [railHover, setRailHover] = useState<{
    run: ComparisonRun;
    el: HTMLElement;
    key: number;
  } | null>(null);
  const railHoverSeq = useRef(0);

  useEffect(() => {
    if (!railHover) return;
    const close = () => setRailHover(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [railHover]);

  // The row model a drag was resolved against can change under it: the view
  // toggle is a window shortcut and can fire mid-drag, and a revision switch
  // rebuilds the rows. Either way the drag goes with the model it belonged
  // to, rather than anchoring a comment on rows it never covered.
  useEffect(() => {
    setDragStart(null);
    setDragCurrent(null);
    setDragSide(undefined);
    setDragCurrentSide(undefined);
    tableRef.current?.removeAttribute("data-selecting");
  }, [chunk.diff, resolvedView]);

  // Reset the drag when the mouse is released anywhere. Without this, releasing
  // outside a commentable row leaves the selection highlight stuck on.
  useEffect(() => {
    if (dragStart === null) return;
    const reset = () => {
      setDragStart(null);
      setDragCurrent(null);
      setDragSide(undefined);
      setDragCurrentSide(undefined);
    };
    window.addEventListener("mouseup", reset);
    return () => window.removeEventListener("mouseup", reset);
  }, [dragStart]);

  // A text selection begun on one side must not spill into the other. The
  // side rides the table as an attribute set by hand: a state write here
  // would re-render every row on the pointer-down of a text selection.
  useEffect(() => {
    const release = () => tableRef.current?.removeAttribute("data-selecting");
    window.addEventListener("mouseup", release);
    return () => window.removeEventListener("mouseup", release);
  }, []);

  useLayoutEffect(() => {
    const landing = landingRef.current;
    if (landing === null) return;
    landingRef.current = null;
    const count = landing.window.end - landing.window.start + 1;
    const row = landing.row;
    const anchored = row !== null && row.isConnected;
    if (anchored) {
      const delta = row.getBoundingClientRect().top - landingTopRef.current;
      if (delta !== 0) window.scrollBy({ top: delta, behavior: "instant" });
    }
    // A spent edge unmounts its control while its row stays, so focus is
    // checked against the row, not the row against the document. An
    // anchored row keeps its viewport: the focus must not scroll again.
    const kept = row?.contains(document.activeElement) === true;
    if (!kept) {
      focusExpandedLine(tableRef.current, landing.window.start, {
        preventScroll: anchored,
      });
    }
    if (count > 0) announce(t("brief.diff.expandShown", { count }));
  }, [rows, announce, t]);

  // Registered at click time, before the read: the store write that lands
  // the rows renders synchronously, and the layout effect must find it then.
  const handleExpanded = (event: ExpandedEvent) => {
    landingTopRef.current = event.top;
    landingRef.current = event;
  };
  const handleAbandoned = (edgeKey: string) => {
    if (landingRef.current?.edgeKey === edgeKey) landingRef.current = null;
  };

  const handleRailEnter = (run: ComparisonRun, el: HTMLElement) => {
    railHoverSeq.current += 1;
    setRailHover({ run, el, key: railHoverSeq.current });
  };
  // Mouse-leave is owned by the Callout's hover system (safePolygon), so the
  // pointer can travel into the callout; this closes the keyboard path (blur).
  // A close names its anchor: the previous cell's leave lands after the next
  // cell's enter, and must not clear the callout that cell just opened.
  const handleRailLeave = (el: HTMLElement) =>
    setRailHover((current) => (current?.el === el ? null : current));

  if (!chunk.diff || chunk.diff.length === 0) {
    return (
      <div className={styles["metadataDiff"]}>
        <span>{t("brief.diff.unavailable")}</span>
        <p>{t("brief.diff.noMatchingRaw")}</p>
      </div>
    );
  }

  const dragSelection = resolveDragSelection(
    pairs,
    dragStart,
    dragCurrent,
    dragSide,
    dragCurrentSide,
  );
  const dragIndexes = new Set(dragSelection.indexes);
  const activePlacement =
    activeCommentAnchor === null
      ? undefined
      : placementForAnchor(activeCommentAnchor);
  const activeRowIds = new Set(activeCommentAnchor?.rowIds ?? []);
  const strandedRowIds = resolveStrandedRows(chunk, comments);
  const handleToggleConversationThread = (threadId: number) =>
    toggleConversationThread(chunkKey, threadId);
  const overlayActive = comparisonView.runs.length > 0;

  function finishSelection(rowIndex: number, side?: SplitSide) {
    // Read-only revision: composer entry is inert (the affordance itself is
    // aria-disabled with the reason, which guards the activation path).
    if (composerDisabledReason !== undefined) return;
    // Expanded context is not in the diff, so no comment can anchor to it.
    if (rowViews[rowIndex]?.isCommentable !== true) return;
    const startIndex = dragStart ?? rowIndex;
    const startSide = dragStart === null ? side : dragSide;
    setDragStart(null);
    setDragCurrent(null);
    setDragSide(undefined);
    setDragCurrentSide(undefined);
    const anchor = resolveAnchor(startIndex, startSide, rowIndex, side);
    if (anchor) openComposer(anchor, chunk.id);
  }

  // GitHub's rule: a range that stays on one side anchors on that side's
  // lines; a range that crosses sides is the unified span between the ends.
  function resolveAnchor(
    startIndex: number,
    startSide: SplitSide | undefined,
    endIndex: number,
    endSide: SplitSide | undefined,
  ): LineCommentAnchor | null {
    const sameSide = startSide !== undefined && startSide === endSide;
    const indexes = sameSide
      ? collectSideIndexes(pairs, startSide, startIndex, endIndex)
      : rangeBetween(startIndex, endIndex);
    const side = sameSide ? startSide : undefined;
    const baseIndexes = toBaseIndexes(indexes);
    if (baseIndexes !== undefined) {
      return buildAnchor(chunk.id, baseRows, baseIndexes, side);
    }
    // A range inside one sibling span anchors to the owner on the rendered
    // rows; row ids then belong to the owner's own table.
    const owner = resolveSpanRangeOwner(indexes);
    if (owner === undefined) return null;
    const anchor = buildAnchor(owner.id, rows, indexes, side);
    if (anchor === null) return null;
    return { ...anchor, rowIds: collectOwnerRowIds(owner, rows, indexes) };
  }

  function buildAnchor(
    chunkId: string,
    sourceRows: DiffLine[],
    indexes: number[],
    side: SplitSide | undefined,
  ): LineCommentAnchor | null {
    if (side === undefined) {
      return createCommentAnchor(chunkId, chunk.file, sourceRows, indexes);
    }
    const commentSide =
      side === SplitSides.LEFT ? CommentSides.OLD : CommentSides.NEW;
    return createSideAnchor(
      chunkId,
      chunk.file,
      sourceRows,
      indexes,
      commentSide,
    );
  }

  // Base rows anchor on base indexes; a range holding an expanded row is
  // answered by the span path instead.
  function toBaseIndexes(indexes: number[]): number[] | undefined {
    if (baseIndexOf === undefined) return indexes;
    const mapped = indexes.map((index) => baseIndexOf[index] ?? -1);
    return mapped.includes(-1) ? undefined : mapped;
  }

  // Every picked row must be a commentable row of the same owner: a range
  // that leaves the span, or crosses into expanded context, is refused.
  function resolveSpanRangeOwner(indexes: number[]): BriefChunk | undefined {
    const ownerIds = new Set(indexes.map((index) => spanOwnerByRow.get(index)));
    if (ownerIds.size !== 1) return undefined;
    const [ownerId] = ownerIds;
    if (ownerId === undefined) return undefined;
    if (indexes.some((index) => rowViews[index]?.isCommentable !== true)) {
      return undefined;
    }
    return ownerChunkById.get(ownerId);
  }

  const dragBaseIndexes =
    baseIndexOf === undefined
      ? dragIndexes
      : new Set(
          [...dragIndexes]
            .map((index) => baseIndexOf[index] ?? -1)
            .filter((index) => index >= 0),
        );
  const rowViews = rows.map(buildRowView);

  function buildRowView(
    line: DiffLine,
    index: number,
  ): DiffRowView | undefined {
    if (isFullWidthDiffRow(line)) return undefined;
    const baseIndex = baseIndexOf?.[index] ?? index;
    if (baseIndex < 0) {
      return buildExpandedRowView({
        line,
        index,
        hostId: chunk.id,
        owner: spanOwnerByRow.get(index),
        commentable: commentableSpanRows.has(index),
        comments: spanComments,
        activeCommentAnchor,
        dragIndexes,
        activeIndexes: activeSpanIndexes,
      });
    }
    return getDiffRowView({
      line,
      index: baseIndex,
      chunk,
      overlayActive,
      comparisonView,
      comments,
      addressedComments,
      dragIndexes: dragBaseIndexes,
      activeRowIds,
      activeCommentAnchor,
      strandedRowIds,
    });
  }

  function buildRowAttributes(
    line: DiffLine,
    index: number,
    side?: SplitSide,
  ): DiffRowAttributes {
    const view = rowViews[index];
    const outsideDiff = view?.isCommentable !== true;
    const commentable = composerDisabledReason === undefined && !outsideDiff;
    const attributes: DiffRowAttributes = {
      commentable,
      focusable: isSideFocusable(line, side),
      revision: view?.revMark,
      selected: isSideSelected(view, index, side),
      onKeyDown: (event) => {
        if (event.key === "Enter") finishSelection(index, side);
      },
      onMouseDown: (event) => {
        // Range anchoring starts from a comment anchor, the line-number
        // gutter or the +/− sign column, never the code text, which stays
        // natively selectable.
        if (
          !(event.target instanceof Element) ||
          event.target.closest("[data-comment-anchor]") === null
        ) {
          if (side !== undefined) markSelectingSide(side);
          return;
        }
        if (!commentable) return;
        // Anchoring intent: drop any stale text selection, preventDefault
        // keeps it alive otherwise, and it would trip the mouseup
        // suppression guard.
        window.getSelection()?.removeAllRanges();
        event.preventDefault();
        setDragStart(index);
        setDragCurrent(index);
        setDragSide(side);
        setDragCurrentSide(side);
      },
      onMouseEnter: () => {
        if (dragStart !== null) {
          setDragCurrent(index);
          setDragCurrentSide(side);
        }
      },
      onMouseUp: (event) => {
        // A gutter-initiated drag is unambiguous comment intent (the gutter
        // mousedown cleared any selection).
        if (dragStart !== null) {
          finishSelection(index, side);
          return;
        }
        // Plain mouseup: composer entry is anchor-only (gutter or sign
        // column), the code text is reserved for selection, so a
        // double-click word-select never pops the composer. Keyboard entry
        // stays row-level (Enter).
        if (
          !(event.target instanceof Element) ||
          event.target.closest("[data-comment-anchor]") === null
        ) {
          return;
        }
        // A text-selection drag released over the gutter: if either endpoint
        // of a non-collapsed selection touches this table, the reviewer was
        // selecting text.
        const selection = window.getSelection();
        const table = event.currentTarget.closest("table");
        if (
          selection &&
          !selection.isCollapsed &&
          table !== null &&
          (table.contains(selection.anchorNode) ||
            table.contains(selection.focusNode))
        ) {
          return;
        }
        finishSelection(index, side);
      },
    };
    if (composerDisabledReason !== undefined) {
      attributes.describedById = composerDisabledReasonId;
      attributes.disabled = true;
    } else if (outsideDiff) {
      // The reason renders once the table holds spliced rows; a row that
      // arrived in the diff itself carries the state alone.
      if (hasExpandedRows) attributes.describedById = expandedReasonId;
      attributes.disabled = true;
    }
    return attributes;
  }

  function buildExpandRow(
    row: DiffLine,
    index: number,
    columnCount: number,
  ): ReactNode {
    const hosted = edgesByRow.get(index) ?? [];
    if (row.kind !== DiffLineKinds.HUNK) return null;
    const above = edgesByRow.get(index + 1) ?? [];
    const own = hosted.concat(above.filter(isUpEdge));
    if (own.length === 0) return null;
    return (
      <ExpandControl
        columnCount={columnCount}
        edges={own}
        header={row.content}
        hiddenThreadLines={hiddenThreadLines}
        onAbandoned={handleAbandoned}
        onExpanded={handleExpanded}
        path={chunk.file}
      />
    );
  }

  function buildRowBefore(
    row: DiffLine,
    index: number,
    columnCount: number,
  ): ReactNode {
    const header = buildSpanHeader(index, columnCount);
    const expand = buildExpandBefore(row, index, columnCount);
    if (header === null && expand === null) return null;
    // The control belongs to the hole above the row, the header to the rows
    // below it.
    return (
      <>
        {expand}
        {header}
      </>
    );
  }

  function buildSpanHeader(index: number, columnCount: number): ReactNode {
    const frame = spanStarts.get(index);
    const owner =
      frame === undefined ? undefined : lineOwners?.owners.get(frame.owner);
    if (frame === undefined || owner === undefined) return null;
    const lines = resolveSpanLines(rows, frame.rows);
    return (
      <SiblingSpanHeader
        columnCount={columnCount}
        from={lines.from}
        jumpToLine={jumpToLine}
        owner={owner}
        side={lines.side}
        to={lines.to}
      />
    );
  }

  function buildExpandBefore(
    row: DiffLine,
    index: number,
    columnCount: number,
  ): ReactNode {
    const hosted = edgesByRow.get(index) ?? [];
    if (hosted.length === 0 || row.kind === DiffLineKinds.HUNK) return null;
    // An up edge right under a header rides the header's own row.
    const own =
      rows[index - 1]?.kind === DiffLineKinds.HUNK
        ? hosted.filter((edge) => !isUpEdge(edge))
        : hosted;
    if (own.length === 0) return null;
    return (
      <tr data-line-kind="expand">
        <ExpandControl
          columnCount={columnCount}
          edges={own}
          hiddenThreadLines={hiddenThreadLines}
          onAbandoned={handleAbandoned}
          onExpanded={handleExpanded}
          path={chunk.file}
        />
      </tr>
    );
  }

  function buildTrailingRow(columnCount: number): ReactNode {
    const own = edgesByRow.get(rows.length) ?? [];
    if (own.length === 0) return null;
    return (
      <tr data-line-kind="expand">
        <ExpandControl
          columnCount={columnCount}
          edges={own}
          hiddenThreadLines={hiddenThreadLines}
          onAbandoned={handleAbandoned}
          onExpanded={handleExpanded}
          path={chunk.file}
        />
      </tr>
    );
  }

  function markSelectingSide(side: SplitSide): void {
    tableRef.current?.setAttribute("data-selecting", side);
  }

  function isSideSelected(
    view: DiffRowView | undefined,
    index: number,
    side: SplitSide | undefined,
  ): boolean {
    if (side === undefined) return view?.isSelected === true;
    const dragged =
      dragIndexes.has(index) &&
      (dragSelection.placement === undefined ||
        dragSelection.placement === side);
    const active =
      (activeRowIds.has(rowId(chunk.id, index)) ||
        activeSpanIndexes.has(index)) &&
      (activePlacement === undefined || activePlacement === side);
    return dragged || active;
  }

  function buildGutterCell(_line: DiffLine, index: number): ReactNode {
    const own = rowViews[index];
    const partner = pairPartners.get(index);
    const other = partner === undefined ? undefined : rowViews[partner];
    const rail = unionRail(own, other);
    return (
      <RevisionGutterCell
        run={overlayActive ? rail.run : undefined}
        isStart={rail.isStart}
        isEnd={rail.isEnd}
        chunk={chunk}
        onRailEnter={handleRailEnter}
        onRailLeave={handleRailLeave}
        spanned={spannedRows.has(index)}
      />
    );
  }

  function buildCodeTrailer(_line: DiffLine, index: number): ReactNode {
    const view = rowViews[index];
    if (view === undefined || !view.isRevStart || !view.revRun) return null;
    const label =
      view.revRun.kind === "removed"
        ? t("brief.diff.revRemoved")
        : t("brief.diff.revNew");
    return (
      <span className={styles["newTag"]} data-kind={view.revRun.kind}>
        {label}
      </span>
    );
  }

  function buildUnderRow(
    line: DiffLine,
    index: number,
    columnCount: number,
    sideColumns?: number,
  ): ReactNode {
    const view = rowViews[index];
    if (view === undefined) return null;
    const baseIndex = baseIndexOf?.[index] ?? index;
    // An expanded row has no base index: its threads are the file's whose
    // line it now shows, a sibling's or a hidden one.
    const conversationRows =
      baseIndex < 0
        ? fileThreads.filter((row) => showsThreadOnRow(row, line))
        : (conversationThreadsByRow?.get(baseIndex) ?? []);
    const layout: UnderRowLayout = { columnCount, sideColumns };
    const composerPlacement =
      activeCommentAnchor === null
        ? undefined
        : placementForAnchor(activeCommentAnchor);
    return (
      <>
        {view.showComposer && activeCommentAnchor ? (
          <UnderRow
            layout={layout}
            placement={composerPlacement}
            spanned={spannedRows.has(index)}
          >
            <CommentComposer
              anchor={activeCommentAnchor}
              cancel={cancelComposer}
              saving={composerSaving}
              mentionCandidates={conversationComposer?.mentionPool}
              save={saveComment}
            />
          </UnderRow>
        ) : null}
        {view.rowComments.map((comment) => (
          <UnderRow
            key={comment.id}
            layout={layout}
            placement={placementForAnchor(comment.anchor)}
            spanned={spannedRows.has(index)}
          >
            <CommentThread
              comment={comment}
              deleteComment={deleteComment}
              mentionCandidates={conversationComposer?.mentionPool}
              post={postReviewComment}
              posting={postingCommentIds.includes(comment.id)}
              postBlockedExternally={postBlockedExternally}
              toggle={toggleComment}
              update={updateComment}
            />
          </UnderRow>
        ))}
        {conversationRows.map((row) =>
          conversationComposer !== undefined ? (
            <UnderRow
              // Addressable target for the digest's "Jump to comment"
              // (BriefPage descends to this row).
              conversationThread={row.thread.rootCommentId}
              key={`conversation-${row.thread.rootCommentId}`}
              layout={layout}
              placement={placementForThread(row.thread, line)}
              spanned={spannedRows.has(index)}
            >
              <ThreadRowView
                composer={conversationComposer}
                expanded={expandedConversation.has(row.thread.rootCommentId)}
                hideJump
                jumpToChunk={noJump}
                row={row}
                toggle={handleToggleConversationThread}
              />
            </UnderRow>
          ) : null,
        )}
        {view.rowAddressedComments.map((comment) => (
          <UnderRow
            key={`addressed-${comment.id}`}
            layout={layout}
            spanned={spannedRows.has(index)}
          >
            <AddressedDiffComment
              comment={comment}
              label={reviewCommentLabel}
            />
          </UnderRow>
        ))}
        {spanEnds.has(index) ? (
          <tr aria-hidden="true" className={styles["spanEnd"]}>
            <td colSpan={columnCount}>{EMPTY_GAP}</td>
          </tr>
        ) : null}
      </>
    );
  }

  const viewportStyle: DiffViewportStyle = {
    "--diff-rows": split ? pairs.length : rows.length,
  };
  return (
    <>
      {/* The reason the commentable rows are inert (aria-describedby target).
          Visible rather than sr-only, so pointer users learn it too. */}
      {composerDisabledReason !== undefined ? (
        <p
          className={styles["composerDisabledNote"]}
          id={composerDisabledReasonId}
        >
          {composerDisabledReason}
        </p>
      ) : null}
      {hasExpandedRows ? (
        <ScreenReaderOnly as="p" id={expandedReasonId}>
          {t("brief.diff.expandOutsideDiff")}
        </ScreenReaderOnly>
      ) : null}
      <div className={styles["viewport"]} style={viewportStyle}>
        <table
          className={styles["diff"]}
          ref={tableRef}
          data-view={resolvedView}
        >
          {split ? (
            <colgroup>
              <col className={styles["colRail"]} />
              <col className={styles["colNumber"]} />
              <col className={styles["colCode"]} />
              <col className={styles["colNumber"]} />
              <col className={styles["colCode"]} />
            </colgroup>
          ) : null}
          {/* Sr-only caption + column headers (the LiveDiffPreview pattern):
              without them AT table navigation reads bare cell soup. */}
          <ScreenReaderOnly as="caption">
            {t("brief.diff.caption", { file: chunk.file })}
          </ScreenReaderOnly>
          <ScreenReaderOnly as="thead">
            <tr>
              <th aria-hidden={overlayActive ? undefined : true} scope="col">
                {overlayActive ? t("brief.diff.colRevision") : null}
              </th>
              {split ? (
                <>
                  <th scope="col">{t("brief.diff.colOld")}</th>
                  <th scope="col">{t("brief.diff.colContentOld")}</th>
                  <th scope="col">{t("brief.diff.colNew")}</th>
                  <th scope="col">{t("brief.diff.colContentNew")}</th>
                </>
              ) : (
                <>
                  <th scope="col">{t("brief.diff.colOld")}</th>
                  <th scope="col">{t("brief.diff.colNew")}</th>
                  <th scope="col">{t("brief.diff.colContent")}</th>
                </>
              )}
            </tr>
          </ScreenReaderOnly>
          <DiffRows
            rows={rows}
            view={resolvedView}
            pairs={pairs}
            tokensByRow={tokensByRow}
            emphasisByRow={emphasisByRow}
            tokensPending={tokensPending}
            anchorAttributes={COMMENT_ANCHOR_ATTRIBUTES}
            codeTrailer={buildCodeTrailer}
            gutterCell={buildGutterCell}
            rowAttributes={buildRowAttributes}
            underRow={buildUnderRow}
            fullRow={buildExpandRow}
            beforeRow={buildRowBefore}
            trailingRow={buildTrailingRow}
          />
        </table>
      </div>
      {railHover && (
        <ComparisonCallout
          anchor={railHover.el}
          key={railHover.key}
          onClose={() => handleRailLeave(railHover.el)}
          run={railHover.run}
          chunk={chunk}
          source={comparisonSource}
          skipReason={comparisonSkipReason}
        />
      )}
    </>
  );
}

/** A thread, composer or addressed comment under a row, on its side if any. */
function UnderRow({
  layout,
  placement,
  conversationThread,
  spanned = false,
  children,
}: UnderRowProps) {
  const { columnCount, sideColumns } = layout;
  const beside = placement !== undefined && sideColumns !== undefined;
  const leadColumns = columnCount - (sideColumns ?? 0);

  return (
    <tr
      className={styles["commentRow"]}
      data-conversation-thread={conversationThread}
      data-placement={beside ? placement : undefined}
      data-span={spanned ? "" : undefined}
    >
      {beside && placement === SplitSides.RIGHT ? (
        <td className={styles["commentGap"]} colSpan={leadColumns}>
          {EMPTY_GAP}
        </td>
      ) : null}
      <td colSpan={beside ? spanForPlacement(placement, layout) : columnCount}>
        {children}
      </td>
      {beside && placement === SplitSides.LEFT ? (
        <td className={styles["commentGap"]} colSpan={sideColumns}>
          {EMPTY_GAP}
        </td>
      ) : null}
    </tr>
  );
}

/**
 * Server-backed wins: once a posted comment's own GitHub thread renders,
 * the local submitted card demotes out of display.
 */
function demoteSubmitted(
  comments: ReviewComment[],
  ownThreads: readonly ConversationThread[],
): ReviewComment[] {
  if (ownThreads.length === 0) return comments;
  const demoted = demotedSubmittedCommentIds(comments, ownThreads);
  return demoted.size === 0
    ? comments
    : comments.filter((comment) => !demoted.has(comment.id));
}
