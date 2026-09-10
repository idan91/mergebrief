import { useTranslation } from "react-i18next";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FocusEvent,
} from "react";

import type { ComparisonOverlayState } from "../../../comparison/comparisonOverlay";
import type { AddressedReviewComment, Brief } from "../../../types";
import type { BriefViewModel, RiskFlag } from "../../../utils/viewModel";
import { GroupViewKinds } from "../../../utils/viewModel";
import { resolveGroupName } from "../../../utils/resolveGroupName";
import { isUnattributedRemainderChunk } from "../../../utils/remainder";
import type { DigestRow } from "@web/features/conversation/utils";
import type { ThreadComposerWiring } from "@web/features/conversation";
import { useReviewFlow } from "@web/features/review/session";
import {
  isLineCommentAnchor,
  type ChunkLocator,
  type CommentAnchor,
} from "@web/features/review/utils";
import { ChunkCard } from "./ChunkCard/ChunkCard";
import { GroupCard } from "./GroupCard/GroupCard";
import { RiskBadge } from "../RiskBadge/RiskBadge";
import { RiskChipDisclosure } from "../RiskChipDisclosure/RiskChipDisclosure";
import { RiskDetailList } from "../RiskDetailList/RiskDetailList";
import { estimateChunkCardHeight } from "../chunkHeightModel";
import { useChunkWindows } from "../chunkWindows";
import { useReadingPosition } from "../readingPosition";
import { CHUNK_WINDOW_INDEX_ATTR, useGroupWindow } from "../useGroupWindow";
import { deriveGroupSectionId } from "../utils";
import { Button } from "@web/components/Button/Button";
import { ToolbarButton } from "@web/components/ToolbarButton/ToolbarButton";
import styles from "./StoryView.module.scss";

const EMPTY_ADDRESSED_REVIEW_COMMENTS: AddressedReviewComment[] = [];
const EMPTY_RISK_FLAGS: RiskFlag[] = [];

export interface StoryViewProps {
  brief: Brief;
  model: BriefViewModel;
  comparison: ComparisonOverlayState;
  focusMode: boolean;
  openChunks: Set<string>;
  addressedReviewComments: AddressedReviewComment[] | undefined;
  jumpToChunk: (chunkId: string) => void;
  /** Enters Read-through at step 1; absent when unavailable (comparing, no chunks). */
  startReadThrough?: () => void;
  markReviewed: (chunkId: string) => void;
  /** Writes are off (no session): the Viewed toggles disable. */
  marksDisabled?: boolean;
  toggleChunk: (chunkId: string) => void;
  /** Inline conversation threads per chunk; absent on the local path. */
  conversationByChunk?: ReadonlyMap<string, DigestRow[]> | undefined;
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
}

export function StoryView(props: StoryViewProps) {
  const { t } = useTranslation();
  const [focusRailOpen, setFocusRailOpen] = useState(true);
  const addressedReviewComments =
    props.addressedReviewComments ?? EMPTY_ADDRESSED_REVIEW_COMMENTS;
  // Gated on focus mode: outside it the selector pins null, so scroll-spy
  // ticks never re-render the whole story tree. In focus mode the spy is
  // off, the group only moves on explicit navigation.
  const { focusMode } = props;
  const activeFocusGroupId = useReadingPosition((state) =>
    focusMode ? state.activeGroupId : null,
  );
  const focusRailState = focusRailOpen ? "open" : "collapsed";
  const focusRailAttr = props.focusMode ? focusRailState : undefined;

  return (
    <div
      className={styles["storyView"]}
      data-zen={props.focusMode ? "on" : undefined}
    >
      {/* Start read-through stays in the flow it enters, and scrolls away
          with it. */}
      {props.startReadThrough && !props.focusMode ? (
        <div className={`${styles["entryRow"]} reveal`}>
          <Button
            className={styles["readThrough"]}
            size="sm"
            onClick={props.startReadThrough}
          >
            {t("brief.story.startReadThrough")}
          </Button>
        </div>
      ) : null}
      {props.model.groups.map((group) => {
        const isActiveFocusGroup =
          props.focusMode && group.id === activeFocusGroupId;
        return (
          <section
            className="story-group reveal"
            id={deriveGroupSectionId(group.id)}
            key={group.id}
            data-active-group={isActiveFocusGroup ? "" : undefined}
            data-focus-rail={focusRailAttr}
          >
            {props.focusMode ? (
              <div className="group-chunks">
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
                    open={props.openChunks.has(chunk.id)}
                    addressedReviewComments={addressedReviewComments}
                    conversationComposer={props.conversationComposer}
                    conversationRows={props.conversationByChunk?.get(chunk.id)}
                    markReviewed={props.markReviewed}
                    marksDisabled={props.marksDisabled}
                    toggleChunk={props.toggleChunk}
                  />
                ))}
              </div>
            ) : (
              <WindowedChunkList
                addressedReviewComments={addressedReviewComments}
                group={group}
                view={props}
              />
            )}
            {isActiveFocusGroup ? (
              <FocusGroupRail
                group={group}
                model={props.model}
                open={focusRailOpen}
                setOpen={setFocusRailOpen}
                jumpToChunk={props.jumpToChunk}
              />
            ) : null}
            {props.focusMode ? null : (
              <GroupCard
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
    </div>
  );
}

interface WindowedChunkListProps {
  group: BriefViewModel["groups"][number];
  view: StoryViewProps;
  addressedReviewComments: AddressedReviewComment[];
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
  addressedReviewComments,
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
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const pinnedKeys = useMemo(
    () =>
      collectPinnedChunkKeys(
        focusedKey,
        composerAnchor,
        group.chunks,
        keyByChunkId,
      ),
    [composerAnchor, focusedKey, group.chunks, keyByChunkId],
  );

  const { openChunks } = view;
  const estimateChunk = useCallback(
    (index: number) => {
      const chunk = group.chunks[index];
      if (!chunk) return 0;
      return estimateChunkCardHeight({
        diffRowCount: chunk.diff?.length ?? 0,
        open: openChunks.has(chunk.id),
      });
    },
    [group.chunks, openChunks],
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

  return (
    <div
      className="group-chunks"
      ref={window.listRef}
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
              open={view.openChunks.has(chunk.id)}
              addressedReviewComments={addressedReviewComments}
              conversationComposer={view.conversationComposer}
              conversationRows={view.conversationByChunk?.get(chunk.id)}
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

interface FocusGroupRailProps {
  group: BriefViewModel["groups"][number];
  model: BriefViewModel;
  open: boolean;
  setOpen: (open: boolean) => void;
  jumpToChunk: (chunkId: string) => void;
}

function FocusGroupRail({
  group,
  model,
  open,
  setOpen,
  jumpToChunk,
}: FocusGroupRailProps) {
  const { t } = useTranslation();
  const activeChunkId = useReadingPosition((state) => state.activeChunkId);
  const panelId = useId();
  const groupFlags = model.flagsByGroup.get(group.id) ?? EMPTY_RISK_FLAGS;
  const isRemainder = group.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER;
  const activeChunk =
    group.chunks.find((chunk) => chunk.id === activeChunkId) ??
    group.chunks[0] ??
    null;

  return (
    <aside
      aria-label={t("brief.story.ariaLabelFocusContext")}
      className={`${styles["focusRail"]} focus-group-rail`}
      data-state={open ? "open" : "collapsed"}
    >
      <ToolbarButton
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={
          open
            ? t("brief.story.ariaLabelCollapseContext")
            : t("brief.story.ariaLabelExpandContext")
        }
        className={styles["railToggle"]}
        onClick={() => setOpen(!open)}
      >
        <span className={styles["railToggleText"]}>
          {group.readingOrderStep !== undefined
            ? t("brief.story.stepLabel", { step: group.readingOrderStep })
            : t("brief.story.groupLabel", { index: group.index + 1 })}
        </span>
        <span aria-hidden="true" className={styles["railToggleMark"]}>
          {open ? "−" : "+"}
        </span>
      </ToolbarButton>
      {open ? (
        <div className={styles["railPanel"]} id={panelId}>
          <div className={styles["railHead"]}>
            <div className={styles["railMeta"]}>
              {group.readingOrderStep !== undefined
                ? t("brief.story.stepOf", {
                    step: group.readingOrderStep,
                    total: model.groups.length,
                  })
                : t("brief.story.groupOf", {
                    index: group.index + 1,
                    total: model.groups.length,
                  })}
            </div>
            <h2 className={styles["railTitle"]}>
              {resolveGroupName(t, group)}
            </h2>
            <p className={styles["railSummary"]}>
              {group.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER
                ? t("brief.unattributed.remainderSummary")
                : group.group.summary}
            </p>
            {group.kind === GroupViewKinds.ATTRIBUTED &&
            group.readingOrderWhy ? (
              <p className={styles["railWhy"]}>{group.readingOrderWhy}</p>
            ) : null}
            {group.kind === GroupViewKinds.ATTRIBUTED ? (
              <div className={styles["railChips"]}>
                <span className={styles["railChip"]} data-kind="dominant">
                  {t("brief.story.railDominant", {
                    category: group.group.dominantCategory,
                  })}
                </span>
                {group.group.secondaryCategories.map((category) => (
                  <span className={styles["railChip"]} key={category}>
                    {t("brief.story.railSecondary", { category })}
                  </span>
                ))}
                {group.group.uncertain ? (
                  <span className={styles["railChip"]} data-kind="uncertain">
                    {t("brief.story.railUncertain")}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div
            aria-label={t("brief.story.ariaLabelGroupDetails")}
            className={styles["railScroller"]}
            role="region"
            tabIndex={0}
          >
            <div className={styles["railStats"]}>
              <span>
                <span className="green">+{group.added}</span> /{" "}
                <span className="red">−{group.deleted}</span>
              </span>
              {isRemainder ? null : (
                <span>
                  {t("brief.story.flags", { count: groupFlags.length })}
                </span>
              )}
            </div>
            {isRemainder || !activeChunk ? null : (
              <div className={styles["railRiskFacts"]}>
                <div className={styles["railLabel"]}>
                  {t("brief.story.railActiveRisks")}
                </div>
                {activeChunk.riskSurface.length > 0 ? (
                  <div className={styles["railRiskChips"]}>
                    {activeChunk.riskSurface.map((risk) => {
                      const meta = model.riskMetaByChunk
                        .get(activeChunk.id)
                        ?.get(risk);
                      if (
                        meta?.source === "repo-policy" ||
                        meta?.deEmphasized
                      ) {
                        return (
                          <RiskChipDisclosure
                            detail={
                              <RiskDetailList
                                attrs={[risk]}
                                metaFor={() => meta}
                              />
                            }
                            key={risk}
                          >
                            <RiskBadge meta={meta}>{risk}</RiskBadge>
                          </RiskChipDisclosure>
                        );
                      }
                      return (
                        <RiskBadge key={risk} meta={meta}>
                          {risk}
                        </RiskBadge>
                      );
                    })}
                  </div>
                ) : (
                  <p className={styles["railNoRisks"]}>
                    {t("brief.story.railNoRisks")}
                  </p>
                )}
              </div>
            )}
            <div className={styles["railChunkList"]}>
              <div className={styles["railLabel"]}>
                {t("brief.story.railChunks")}
              </div>
              {group.chunks.map((chunk) => (
                // oxlint-disable-next-line house/no-raw-button -- multi-line card-as-button: arbitrary block content
                <button
                  className={styles["railChunkButton"]}
                  data-current={chunk.id === activeChunkId ? "" : undefined}
                  key={`${chunk.file}#${chunk.id}`}
                  type="button"
                  onClick={() => jumpToChunk(chunk.id)}
                >
                  <span className={styles["railChunkFile"]}>{chunk.file}</span>
                  <span className={styles["railChunkMeta"]}>
                    {isUnattributedRemainderChunk(chunk) ? null : (
                      <>{chunk.role} · </>
                    )}
                    <span className="green">+{chunk.loc.added}</span> /{" "}
                    <span className="red">−{chunk.loc.deleted}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
