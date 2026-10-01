import { countSplitRows } from "@web/components/DiffRows/pairSplitRows";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import type { ChunkShare } from "../types";
import { hasPairedSides } from "@web/components/DiffRows/utils";
import { useMergedRef } from "@web/hooks/useMergedRef";
import { useSplitWidth } from "./useSplitWidth";
import type { DiffLine } from "@web/utils/diffTokens/types";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
} from "react";

import type { ComparisonOverlayState } from "../../../comparison/comparisonOverlay";
import type { AddressedReviewComment, Brief, BriefChunk } from "../../../types";
import { countExpandedRows } from "../../../utils/expansionState";
import type { BriefViewModel } from "../../../utils/viewModel";
import type {
  DigestRow,
  DigestThreadRow,
} from "@web/features/conversation/utils";
import type { ThreadComposerWiring } from "@web/features/conversation";
import { useReviewFlow } from "@web/features/review/session";
import {
  isLineCommentAnchor,
  type ChunkLocator,
  type CommentAnchor,
} from "@web/features/review/utils";
import { ChunkCard } from "./ChunkCard";
import { ChunkFooter, type ChunkFooterWiring } from "./ChunkFooter";
import { GroupCard } from "./GroupCard";
import { StorySplitter } from "./StorySplitter";
import { estimateChunkCardHeight } from "../chunkHeightModel";
import { useFileRows } from "../../../hooks/useFileRows";
import { type FileLineOwners, type LineTarget } from "../../../utils/lineOwner";
import { useChunkWindows } from "../chunkWindows";
import { useReadingPosition } from "../readingPosition";
import { CHUNK_WINDOW_INDEX_ATTR, useGroupWindow } from "../useGroupWindow";
import { deriveGroupSectionId, type SidebarLayout } from "../utils";
import styles from "./StoryView.module.scss";

const EMPTY_ADDRESSED_REVIEW_COMMENTS: AddressedReviewComment[] = [];

export interface StoryViewProps {
  brief: Brief;
  diffView?: DiffView;
  model: BriefViewModel;
  /** Per file, so a card frames a sibling's expanded rows with its owner. */
  lineOwnersByFile: ReadonlyMap<string, FileLineOwners>;
  comparison: ComparisonOverlayState;
  focusMode: boolean;
  openChunks: Set<string>;
  addressedReviewComments: AddressedReviewComment[] | undefined;
  jumpToChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  /** Writes are off (no session): the Viewed toggles disable. */
  marksDisabled?: boolean;
  toggleChunk: (chunkId: string) => void;
  /** Inline conversation threads per chunk; absent on the local path. */
  conversationByChunk?: ReadonlyMap<string, DigestRow[]> | undefined;
  /** Head-file lines of live threads no chunk renders, per file. */
  hiddenThreadsByFile?: ReadonlyMap<string, DigestThreadRow[]> | undefined;
  /** Every current line thread per file; expanded rows show theirs. */
  lineThreadsByFile?: ReadonlyMap<string, DigestThreadRow[]> | undefined;
  /** Lands on one line of a chunk; a sibling span's control uses it. */
  jumpToLine?: ((chunkId: string, target: LineTarget) => void) | undefined;
  /** Writes a chunk's hash and answers the URL to copy. */
  shareChunk?: ChunkShare | undefined;
  conversationComposer?: ThreadComposerWiring | undefined;
  /**
   * Per-group changed-since data; absent without a checkpoint. Split into
   * primitives at the GroupCard boundary so the memo holds.
   */
  sinceMarkers?:
    | { counts: ReadonlyMap<string, number>; baselineShortSha: string }
    | undefined;
  /** Opens the delta lens; route-owned, absent on the local path. */
  openDeltaLens?: (() => void) | undefined;
  /** Sidebar layout the stacked breakpoints key on. */
  sidebar?: SidebarLayout | undefined;
  /** Card column width control; absent leaves the groups without a splitter. */
  cardTrack?: StoryCardTrackControl | undefined;
  /** Focus mode's step and Viewed controls under the chunk. */
  chunkFooter?: ChunkFooterWiring | undefined;
}

export interface StoryCardTrackControl {
  setTrack: (px: number) => void;
  resetTrack: () => void;
}

export function StoryView(props: StoryViewProps) {
  const requestedView = props.diffView ?? DiffViews.UNIFIED;
  const splitWidth = useSplitWidth(requestedView === DiffViews.SPLIT);
  const diffView =
    requestedView === DiffViews.SPLIT && splitWidth.wideEnough
      ? DiffViews.SPLIT
      : DiffViews.UNIFIED;
  const { lineOwnersByFile } = props;
  const addressedReviewComments =
    props.addressedReviewComments ?? EMPTY_ADDRESSED_REVIEW_COMMENTS;
  // Gated on focus mode: outside it the selector pins null, so scroll-spy
  // ticks never re-render the whole story tree. In focus mode the spy is
  // off, the group only moves on explicit navigation.
  const { focusMode } = props;
  const activeFocusGroupId = useReadingPosition((state) =>
    focusMode ? state.activeGroupId : null,
  );

  return (
    <div
      className={styles["storyView"]}
      data-zen={props.focusMode ? "on" : undefined}
    >
      {props.model.groups.map((group) => {
        const isActiveFocusGroup =
          props.focusMode && group.id === activeFocusGroupId;
        const groupView = resolveGroupDiffView(diffView, group.chunks);
        const sectionId = deriveGroupSectionId(group.id);
        const cardId = `${sectionId}-card`;
        return (
          <section
            className="story-group reveal"
            id={sectionId}
            key={group.id}
            data-active-group={isActiveFocusGroup ? "" : undefined}
            data-diff-view={groupView}
          >
            {props.focusMode ? (
              <div className="group-chunks" ref={splitWidth.attachWrapper}>
                {/**
                 * Focus mode hides sections with CSS, which the windowing latch cannot detect.
                 * Use a plain list to avoid a fixed-height empty track, and mount only
                 * the active group's cards to preserve the windowing cost savings.
                 */}
                {(isActiveFocusGroup ? group.chunks : []).map((chunk) => (
                  <ChunkCard
                    key={`${chunk.file}#${chunk.id}`}
                    chunk={chunk}
                    riskMeta={props.model.riskMetaByChunk.get(chunk.id)}
                    comparison={props.comparison}
                    diffView={groupView}
                    open={props.openChunks.has(chunk.id)}
                    addressedReviewComments={addressedReviewComments}
                    conversationComposer={props.conversationComposer}
                    conversationRows={props.conversationByChunk?.get(chunk.id)}
                    hiddenThreads={props.hiddenThreadsByFile?.get(chunk.file)}
                    fileThreads={props.lineThreadsByFile?.get(chunk.file)}
                    jumpToLine={props.jumpToLine}
                    shareChunk={props.shareChunk}
                    lineOwners={lineOwnersByFile.get(chunk.file)}
                    markReviewed={props.markReviewed}
                    marksDisabled={props.marksDisabled}
                    toggleChunk={props.toggleChunk}
                  />
                ))}
              </div>
            ) : (
              <WindowedChunkList
                diffView={groupView}
                attachWrapper={splitWidth.attachWrapper}
                addressedReviewComments={addressedReviewComments}
                group={group}
                lineOwnersByFile={lineOwnersByFile}
                view={props}
              />
            )}
            {props.focusMode || props.cardTrack === undefined ? null : (
              <StorySplitter
                sidebar={props.sidebar}
                cardId={cardId}
                setTrack={props.cardTrack.setTrack}
                resetTrack={props.cardTrack.resetTrack}
              />
            )}
            {props.focusMode ? null : (
              <GroupCard
                id={cardId}
                group={group}
                brief={props.brief}
                model={props.model}
                jumpToChunk={props.jumpToChunk}
                sinceBaselineShortSha={props.sinceMarkers?.baselineShortSha}
                sinceChangedFileCount={props.sinceMarkers?.counts.get(group.id)}
                openDeltaLens={props.openDeltaLens}
              />
            )}
          </section>
        );
      })}
      {props.focusMode && props.chunkFooter ? (
        <ChunkFooter
          groups={props.model.groups}
          marksDisabled={props.marksDisabled}
          wiring={props.chunkFooter}
        />
      ) : null}
    </div>
  );
}

const NO_DIFF: DiffLine[] = [];

function countDiffRows(diff: readonly DiffLine[], view: DiffView): number {
  return view === DiffViews.SPLIT ? countSplitRows(diff) : diff.length;
}

interface WindowedChunkListProps {
  group: BriefViewModel["groups"][number];
  view: StoryViewProps;
  diffView: DiffView;
  attachWrapper: (node: HTMLElement | null) => (() => void) | undefined;
  addressedReviewComments: AddressedReviewComment[];
  lineOwnersByFile: ReadonlyMap<string, FileLineOwners>;
}

function pinComposerChunks(
  pinned: Set<string>,
  composerAnchor: CommentAnchor,
  chunks: readonly ChunkLocator[],
  keyByChunkId: ReadonlyMap<string, string>,
): void {
  if (isLineCommentAnchor(composerAnchor)) {
    const key = keyByChunkId.get(composerAnchor.chunkId);
    if (key !== undefined) {
      pinned.add(key);
    }
    return;
  }

  for (const chunk of chunks) {
    if (chunk.file !== composerAnchor.file) {
      continue;
    }
    pinned.add(`${chunk.file}#${chunk.id}`);
  }
}

function collectPinnedChunkKeys(
  focusedKey: string | null,
  composerAnchor: CommentAnchor | null,
  composerHost: string | null,
  chunks: readonly ChunkLocator[],
  keyByChunkId: ReadonlyMap<string, string>,
): Set<string> | undefined {
  const pinned = new Set<string>();

  if (focusedKey !== null) {
    pinned.add(focusedKey);
  }

  if (composerAnchor !== null) {
    pinComposerChunks(pinned, composerAnchor, chunks, keyByChunkId);
  }
  // The composer renders in its host's table, which may be a sibling of
  // the anchor's chunk.
  const hostKey =
    composerHost === null ? undefined : keyByChunkId.get(composerHost);
  if (hostKey !== undefined) pinned.add(hostKey);

  if (pinned.size === 0) {
    return undefined;
  }

  return pinned;
}

/**
 * Mount viewport-adjacent cards while preserving the estimated column height.
 * Keep the focused card and open composer mounted.
 * Register jumps so anchors can reach chunks that have not mounted yet.
 */
function WindowedChunkList({
  group,
  view,
  diffView,
  attachWrapper,
  addressedReviewComments,
  lineOwnersByFile,
}: WindowedChunkListProps) {
  const chunkKeys = useMemo(
    () => group.chunks.map((chunk) => `${chunk.file}#${chunk.id}`),
    [group.chunks],
  );
  const keyByChunkId = useMemo(
    () =>
      new Map(
        group.chunks.map((chunk) => [chunk.id, `${chunk.file}#${chunk.id}`]),
      ),
    [group.chunks],
  );

  const composerAnchor = useReviewFlow((state) => state.composerAnchor);
  const composerHost = useReviewFlow((state) => state.composerHost);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const pinnedKeys = useMemo(
    () =>
      collectPinnedChunkKeys(
        focusedKey,
        composerAnchor,
        composerHost,
        group.chunks,
        keyByChunkId,
      ),
    [composerAnchor, composerHost, focusedKey, group.chunks, keyByChunkId],
  );

  const { openChunks } = view;
  const expandedEdges = useReviewFlow((state) => state.expandedEdges);
  const fileRowsCache = useFileRows();
  // Counted once per group: the virtualizer asks for every unmeasured card
  // on each measurement pass. Expanded rows charge the same row height.
  const diffRowCounts = useMemo(
    () =>
      group.chunks.map((chunk) => {
        const base = chunk.diff ?? NO_DIFF;
        return (
          countDiffRows(base, diffView) +
          countExpandedRows(
            expandedEdges,
            chunk.id,
            base,
            fileRowsCache?.getFileRows(chunk.file),
            diffView,
          )
        );
      }),
    [group.chunks, diffView, expandedEdges, fileRowsCache],
  );
  const estimateChunk = useCallback(
    (index: number) => {
      const chunk = group.chunks[index];
      if (!chunk) return 0;
      return estimateChunkCardHeight({
        diffRowCount: diffRowCounts[index] ?? 0,
        open: openChunks.has(chunk.id),
      });
    },
    [group.chunks, openChunks, diffRowCounts],
  );

  const window = useGroupWindow({ chunkKeys, estimateChunk, pinnedKeys });
  const { scrollToKey } = window;

  const registry = useChunkWindows();
  useEffect(() => {
    if (!registry) return;
    return registry.register({
      scrollToChunk: (chunkId) => {
        const key = keyByChunkId.get(chunkId);
        return key !== undefined && scrollToKey(key);
      },
    });
  }, [keyByChunkId, registry, scrollToKey]);

  // Focus-pin bookkeeping: focusin bubbles, so the list container sees every
  // focus landing inside a card; the pin lifts when focus leaves the list.
  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    const holder =
      target instanceof Element
        ? target.closest(`[${CHUNK_WINDOW_INDEX_ATTR}]`)
        : null;
    const index = holder
      ? Number(holder.getAttribute(CHUNK_WINDOW_INDEX_ATTR))
      : Number.NaN;
    setFocusedKey(Number.isInteger(index) ? (chunkKeys[index] ?? null) : null);
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    )
      return;
    setFocusedKey(null);
  };

  const listRef = useMergedRef(attachWrapper, window.listRef);

  return (
    <div
      className="group-chunks"
      ref={listRef}
      style={{
        position: "relative",
        blockSize: window.totalSize,
        // Explicit: absolute cards give this column ZERO intrinsic width, so
        // any content-sized ancestor (narrow flex uses align-items:start)
        // would collapse it to 0.
        inlineSize: "100%",
      }}
      onBlur={handleBlur}
      onFocus={handleFocus}
    >
      {window.items.map((item) => {
        const chunk = group.chunks[item.index];
        if (!chunk) return null;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={window.measureElement}
            style={{
              position: "absolute",
              // `top`, never `transform`: a transformed ancestor becomes the
              // containing block for the card's sticky header, and Chromium
              // leaves stale sticky paint behind after programmatic jumps,
              // headers detach from their cards.
              insetBlockStart: item.start - window.scrollMargin,
              insetInlineStart: 0,
              inlineSize: "100%",
            }}
          >
            {/* File-qualified key: a DIFFERENT file landing on a reused
                positional id remounts clean. Same file + same id keeps the
                card (the common revision step), so chunk-subtree local
                state MUST be thread-id-scoped or gesture-transient. */}
            <ChunkCard
              chunk={chunk}
              riskMeta={view.model.riskMetaByChunk.get(chunk.id)}
              comparison={view.comparison}
              diffView={diffView}
              open={view.openChunks.has(chunk.id)}
              addressedReviewComments={addressedReviewComments}
              conversationComposer={view.conversationComposer}
              conversationRows={view.conversationByChunk?.get(chunk.id)}
              hiddenThreads={view.hiddenThreadsByFile?.get(chunk.file)}
              fileThreads={view.lineThreadsByFile?.get(chunk.file)}
              jumpToLine={view.jumpToLine}
              shareChunk={view.shareChunk}
              lineOwners={lineOwnersByFile.get(chunk.file)}
              markReviewed={view.markReviewed}
              marksDisabled={view.marksDisabled}
              toggleChunk={view.toggleChunk}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The view a group actually renders: split only when some chunk in it has a
 * line on each side, matching the rule each table applies to itself.
 */
function resolveGroupDiffView(
  diffView: DiffView,
  chunks: readonly BriefChunk[],
): DiffView {
  if (diffView !== DiffViews.SPLIT) return DiffViews.UNIFIED;
  const anyPairable = chunks.some((chunk) =>
    hasPairedSides(chunk.diff ?? NO_DIFF),
  );
  return anyPairable ? DiffViews.SPLIT : DiffViews.UNIFIED;
}
