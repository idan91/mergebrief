import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import type { ChunkShare, GithubHeadRef } from "../types";
import { useMergedRef } from "@web/hooks/useMergedRef";
import { useViewportShape } from "@web/hooks/useViewportShape";
import { useSplitWidth } from "./useSplitWidth";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
} from "react";

import type { ComparisonOverlayState } from "../../../../model/comparison/comparison-overlay";
import type {
  AddressedReviewComment,
  Brief,
  BriefChunk,
} from "../../../../model/types";
import type { BriefViewModel } from "../../../../model/utils/view-model";
import type {
  DigestRow,
  DigestThreadRow,
} from "@web/features/conversation/utils";
import type { ThreadComposerWiring } from "@web/features/conversation";
import { getComposerHost, useReviewFlow } from "@web/features/review/session";
import { ChunkCard } from "./ChunkCard";
import { ChunkFooter, type ChunkFooterWiring } from "./ChunkFooter";
import { GroupCard } from "./GroupCard";
import { StorySplitter } from "./StorySplitter";
import {
  readCardCounts,
  useChunkLayout,
} from "../../../../model/chunk-layout/useChunkLayout";
import { useExpansion } from "../../../../model/expansion/useExpansion";
import { useFileRows } from "../../../../model/file-rows/useFileRows";
import {
  type FileLineOwners,
  type LineTarget,
} from "../../../../model/utils/line-owner";
import { resolveChunkCardMetrics } from "../reading/chunk-height-model";
import { useChunkWindows } from "../reading/chunk-windows";
import { WINDOW_LIST_STYLE } from "../reading/window-layout";
import { WindowedCards } from "../reading/WindowedCards";
import { useWrapColumns } from "../reading/useWrapColumns";
import { useReadingPosition } from "../reading/reading-position";
import {
  CHUNK_WINDOW_INDEX_ATTR,
  useGroupWindow,
} from "../reading/useGroupWindow";
import {
  deriveGroupSectionId,
  isLargeChunk,
  resolveChunkView,
  type SidebarLayout,
} from "../utils";
import styles from "./StoryView.module.scss";
import {
  countStoryChunkRows,
  estimateStoryChunkHeight,
  NO_STORY_ROWS,
} from "./utils";

const EMPTY_ADDRESSED_REVIEW_COMMENTS: AddressedReviewComment[] = [];

export interface StoryViewProps {
  brief: Brief;
  /** The chunk whose actions sheet is open; absent = none. */
  chunkActionsFor: string | undefined;
  openChunkActions: (chunkId: string) => void;
  closeChunkActions: () => void;
  diffView?: DiffView;
  model: BriefViewModel;
  /** Per file, so a card frames a sibling's expanded rows with its owner. */
  lineOwnersByFile: ReadonlyMap<string, FileLineOwners>;
  comparison: ComparisonOverlayState;
  focusMode: boolean;
  openChunks: ReadonlySet<string>;
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
  /** Scrolls to one line of a chunk; a sibling span's control uses it. */
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
  /** Opens the last-review comparison; route-owned, absent on the local path. */
  openComparison?: (() => void) | undefined;
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
  const githubHead = useGithubHead(props.brief);

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
            className={`${styles["group"]} reveal`}
            id={sectionId}
            key={group.id}
            data-active-group={isActiveFocusGroup ? "" : undefined}
            data-diff-view={groupView}
            data-testid="story-group"
          >
            {props.focusMode ? (
              <div
                className={styles["chunks"]}
                data-story-chunks=""
                ref={splitWidth.attachWrapper}
              >
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
                    githubHead={githubHead}
                    actionsOpen={props.chunkActionsFor === chunk.id}
                    openActions={props.openChunkActions}
                    closeActions={props.closeChunkActions}
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
                githubHead={githubHead}
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
                openComparison={props.openComparison}
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

/** One identity per head, so the memoized cards hold while nothing about the PR moved. */
function useGithubHead(brief: Brief): GithubHeadRef {
  const { repo, sha } = brief.pr;
  return useMemo(() => ({ repoSlug: repo, sha }), [repo, sha]);
}

interface WindowedChunkListProps {
  group: BriefViewModel["groups"][number];
  view: StoryViewProps;
  githubHead: GithubHeadRef;
  diffView: DiffView;
  attachWrapper: (node: HTMLElement | null) => (() => void) | undefined;
  addressedReviewComments: AddressedReviewComment[];
  lineOwnersByFile: ReadonlyMap<string, FileLineOwners>;
}

function collectPinnedChunkKeys(
  focusedKey: string | null,
  composerHost: string | undefined,
  keyByChunkId: ReadonlyMap<string, string>,
): Set<string> | undefined {
  const pinned = new Set<string>();

  if (focusedKey !== null) {
    pinned.add(focusedKey);
  }
  // The composer renders only in its host, which may be a sibling of the
  // anchor's chunk or, for a file comment, the header that opened it.
  const hostKey =
    composerHost === undefined ? undefined : keyByChunkId.get(composerHost);
  if (hostKey !== undefined) {
    pinned.add(hostKey);
  }

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
  githubHead,
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

  const composerHost = useReviewFlow((state) =>
    getComposerHost(state.composer),
  );
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const pinnedKeys = useMemo(
    () => collectPinnedChunkKeys(focusedKey, composerHost, keyByChunkId),
    [composerHost, focusedKey, keyByChunkId],
  );

  const { openChunks } = view;
  const expandedEdges = useExpansion((state) => state.expandedEdges);
  const fileRowsCache = useFileRows();
  // Counted once per group: the virtualizer asks for every unmeasured card
  // on each measurement pass. The stored counts size a card before its code
  // lands and after: the sliced rows alone would drop the tall-row and wrap
  // allowances the reservation carried. Without them a pending card reserves
  // what its skeleton draws.
  const layout = useChunkLayout();
  const storedCounts = layout?.counts;
  const rowCounts = useMemo(
    () =>
      countStoryChunkRows({
        chunks: group.chunks,
        diffView,
        expandedEdges,
        fileRows: fileRowsCache,
        storedCounts,
      }),
    [group.chunks, diffView, expandedEdges, fileRowsCache, storedCounts],
  );
  const shape = useViewportShape();
  const metrics = resolveChunkCardMetrics(shape);
  const wrapColumns = useWrapColumns();
  const estimateChunk = useCallback(
    (index: number) => {
      const chunk = group.chunks[index];
      if (!chunk) {
        return 0;
      }
      return estimateStoryChunkHeight({
        chunk,
        groupView: diffView,
        counts: readCardCounts(layout, chunk),
        rows: rowCounts[index] ?? NO_STORY_ROWS,
        open: openChunks.has(chunk.id),
        large: isLargeChunk(chunk),
        metrics,
        wrapColumns,
      });
    },
    [
      group.chunks,
      openChunks,
      rowCounts,
      layout,
      diffView,
      metrics,
      wrapColumns,
    ],
  );

  const window = useGroupWindow({ chunkKeys, estimateChunk, pinnedKeys });
  const { scrollToKey, holdScrollCompensation } = window;

  const registry = useChunkWindows();
  useEffect(() => {
    if (!registry) {
      return;
    }
    return registry.register({
      scrollToChunk: (chunkId) => {
        const key = keyByChunkId.get(chunkId);
        return key !== undefined && scrollToKey(key);
      },
      holdScrollCompensation,
    });
  }, [holdScrollCompensation, keyByChunkId, registry, scrollToKey]);

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
    ) {
      return;
    }
    setFocusedKey(null);
  };

  const listRef = useMergedRef(attachWrapper, window.listRef);
  function buildCard(index: number) {
    const chunk = group.chunks[index];
    if (!chunk) {
      return undefined;
    }
    // The window keys each card by file and chunk id: a DIFFERENT file landing
    // on a reused positional id remounts clean. Same file + same id keeps the
    // card (the common revision step), so chunk-subtree local state MUST be
    // thread-id-scoped or gesture-transient.
    return (
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
        githubHead={githubHead}
        actionsOpen={view.chunkActionsFor === chunk.id}
        openActions={view.openChunkActions}
        closeActions={view.closeChunkActions}
        lineOwners={lineOwnersByFile.get(chunk.file)}
        markReviewed={view.markReviewed}
        marksDisabled={view.marksDisabled}
        toggleChunk={view.toggleChunk}
      />
    );
  }

  return (
    <div
      className={styles["chunks"]}
      data-story-chunks=""
      ref={listRef}
      style={WINDOW_LIST_STYLE}
      onBlur={handleBlur}
      onFocus={handleFocus}
    >
      <WindowedCards window={window} buildCard={buildCard} />
    </div>
  );
}

/**
 * The view a group actually renders: split when some chunk's own table
 * draws split, read from claimed ranges so a group still waiting on its
 * code resolves the view its tables will draw.
 */
function resolveGroupDiffView(
  diffView: DiffView,
  chunks: readonly BriefChunk[],
): DiffView {
  const anySplit = chunks.some(
    (chunk) => resolveChunkView(diffView, chunk, false) === DiffViews.SPLIT,
  );
  return anySplit ? DiffViews.SPLIT : DiffViews.UNIFIED;
}
