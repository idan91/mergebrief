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
import type { DigestRow } from "@web/features/conversation/utils/digest";
import type { ThreadComposerWiring } from "@web/features/conversation";
import { useReviewFlow } from "@web/features/review/session";
import { ChunkCard } from "./ChunkCard/ChunkCard";
import { GroupCard } from "./GroupCard/GroupCard";
import { RiskBadge } from "../RiskBadge/RiskBadge";
import { RiskChipDisclosure } from "../RiskChipDisclosure/RiskChipDisclosure";
import { RiskDetailList } from "../RiskDetailList/RiskDetailList";
import { estimateChunkCardHeight } from "../chunkHeightModel";
import { useChunkWindows } from "../chunkWindows";
import { useReadingPosition } from "../readingPosition";
import { CHUNK_WINDOW_INDEX_ATTR, useGroupWindow } from "../useGroupWindow";
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
  // off — the group only moves on explicit navigation.
  const { focusMode } = props;
  const activeFocusGroupId = useReadingPosition((state) =>
    focusMode ? state.activeGroupId : null,
  );
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
            key={group.id}
            data-active-group={isActiveFocusGroup ? "" : undefined}
            data-focus-rail={
              props.focusMode
                ? focusRailOpen
                  ? "open"
                  : "collapsed"
                : undefined
            }
          >
            {props.focusMode ? (
              <div className="group-chunks">
                {/* Focus mode isolates one card via display:none CSS — the
                    windowing latch can't see CSS hiding (attribute-based),
                    and a fixed-height column would leave a giant empty
                    track. The plain list is the correct shape here, and only
                    the ACTIVE group's (the others' sections are display:none
                    whole) — mounting every group's cards would re-pay the
                    full-tree cost windowing exists to remove. */}
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
            {props.focusMode ? (
              isActiveFocusGroup ? (
                <FocusGroupRail
                  group={group}
                  model={props.model}
                  open={focusRailOpen}
                  setOpen={setFocusRailOpen}
                  jumpToChunk={props.jumpToChunk}
                />
              ) : null
            ) : (
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

/**
 * The windowed chunk column: only viewport-adjacent cards mount; the column
 * keeps its full estimated height so the page geometry (and the sticky
 * GroupCard beside it) is unaffected. The card holding focus or the open
 * composer is pinned mounted, and the list registers with the jump registry
 * so anchors resolve to not-yet-mounted chunks.
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
  const pinnedKeys = useMemo(() => {
    const pinned = new Set<string>();
    if (focusedKey !== null) pinned.add(focusedKey);
    if (composerAnchor) {
      const key = keyByChunkId.get(composerAnchor.chunkId);
      if (key !== undefined) pinned.add(key);
    }
    return pinned.size > 0 ? pinned : undefined;
  }, [composerAnchor, focusedKey, keyByChunkId]);

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
              // leaves stale sticky paint behind after programmatic jumps —
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
  const dominant = group.group.dominantCategory;
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
          {/* Fixed header: everything above the stats divider stays put;
              only the detail region below it scrolls. */}
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
            <h2 className={styles["railTitle"]}>{group.group.title}</h2>
            <p className={styles["railSummary"]}>{group.group.summary}</p>
            {group.readingOrderWhy ? (
              <p className={styles["railWhy"]}>{group.readingOrderWhy}</p>
            ) : null}
            <div className={styles["railChips"]}>
              <span className={styles["railChip"]} data-kind="dominant">
                {t("brief.story.railDominant", { category: dominant })}
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
          </div>
          {/* The keyboard-reachable scroll region: tabindex + label live here,
              on the element that actually scrolls, so they coincide. */}
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
              <span>
                {t("brief.story.flags", { count: groupFlags.length })}
              </span>
            </div>
            {activeChunk ? (
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
            ) : null}
            <div className={styles["railChunkList"]}>
              <div className={styles["railLabel"]}>
                {t("brief.story.railChunks")}
              </div>
              {group.chunks.map((chunk) => (
                // eslint-disable-next-line no-restricted-syntax -- multi-line card-as-button: arbitrary block content
                <button
                  className={styles["railChunkButton"]}
                  data-current={chunk.id === activeChunkId ? "" : undefined}
                  key={`${chunk.file}#${chunk.id}`}
                  type="button"
                  onClick={() => jumpToChunk(chunk.id)}
                >
                  <span className={styles["railChunkFile"]}>{chunk.file}</span>
                  <span className={styles["railChunkMeta"]}>
                    {chunk.role} ·{" "}
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
