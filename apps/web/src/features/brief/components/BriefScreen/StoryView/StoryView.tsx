import { useId, useState } from "react";

import type { ComparisonOverlayState } from "../../../comparison/comparisonOverlay";
import type { AddressedReviewComment, Brief } from "../../../types";
import type { BriefViewModel, RiskFlag } from "../../../utils/viewModel";
import type { DigestRow } from "@web/features/conversation/utils/digest";
import type { ThreadComposerWiring } from "@web/features/conversation";
import { ChunkCard } from "./ChunkCard/ChunkCard";
import { GroupCard } from "./GroupCard/GroupCard";
import { RiskBadge } from "../RiskBadge/RiskBadge";
import { RiskChipDisclosure } from "../RiskChipDisclosure/RiskChipDisclosure";
import { RiskDetailList } from "../RiskDetailList/RiskDetailList";
import styles from "./StoryView.module.scss";

const EMPTY_ADDRESSED_REVIEW_COMMENTS: AddressedReviewComment[] = [];
const EMPTY_RISK_FLAGS: RiskFlag[] = [];

export interface StoryViewProps {
  brief: Brief;
  model: BriefViewModel;
  comparison: ComparisonOverlayState;
  activeChunkId: string | null;
  collapseSupporting: boolean;
  focusMode: boolean;
  openChunks: Set<string>;
  addressedReviewComments: AddressedReviewComment[] | undefined;
  jumpToChunk: (chunkId: string) => void;
  /** Enters Read-through at step 1; absent when unavailable (comparing, no chunks). */
  startReadThrough?: () => void;
  markReviewed: (chunkId: string) => void;
  toggleChunk: (chunkId: string) => void;
  /** Inline conversation threads per chunk (BRIEF-25); absent on the local path. */
  conversationByChunk?: ReadonlyMap<string, DigestRow[]> | undefined;
  conversationComposer?: ThreadComposerWiring | undefined;
  /**
   * Per-group changed-since data (BRIEF-102); absent without a checkpoint.
   * Split into primitives at the GroupCard boundary (memo discipline).
   */
  sinceMarkers?:
    | { counts: ReadonlyMap<string, number>; baselineShortSha: string }
    | undefined;
  /** Opens the delta lens (BRIEF-102); route-owned, absent on the local path. */
  openDeltaLens?: (() => void) | undefined;
}

export function StoryView(props: StoryViewProps) {
  const [focusRailOpen, setFocusRailOpen] = useState(true);
  const addressedReviewComments =
    props.addressedReviewComments ?? EMPTY_ADDRESSED_REVIEW_COMMENTS;
  return (
    <div
      className={styles["storyView"]}
      data-zen={props.focusMode ? "on" : undefined}
    >
      {/* The chunks-count label row dissolved into the reading toolbar
          (BRIEF-134); Start read-through stays here — an ENTRY action lives
          in the flow it enters, and scrolls away with it. */}
      {props.startReadThrough && !props.focusMode ? (
        <div className={`${styles["entryRow"]} reveal`}>
          <button
            className={styles["readThrough"]}
            type="button"
            onClick={props.startReadThrough}
          >
            Start read-through
          </button>
        </div>
      ) : null}
      {props.model.groups.map((group) => {
        const isActiveFocusGroup =
          props.focusMode &&
          group.chunks.some((chunk) => chunk.id === props.activeChunkId);
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
            <div className="group-chunks">
              {group.chunks.map((chunk) => (
                <ChunkCard
                  key={chunk.id}
                  active={props.activeChunkId === chunk.id}
                  chunk={chunk}
                  riskMeta={props.model.riskMetaByChunk.get(chunk.id)}
                  comparison={props.comparison}
                  forceCollapsed={
                    props.collapseSupporting && chunk.role === "supporting"
                  }
                  open={props.openChunks.has(chunk.id)}
                  addressedReviewComments={addressedReviewComments}
                  conversationComposer={props.conversationComposer}
                  conversationRows={props.conversationByChunk?.get(chunk.id)}
                  markReviewed={props.markReviewed}
                  toggleChunk={props.toggleChunk}
                />
              ))}
            </div>
            {props.focusMode ? (
              isActiveFocusGroup ? (
                <FocusGroupRail
                  activeChunkId={props.activeChunkId}
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

interface FocusGroupRailProps {
  activeChunkId: string | null;
  group: BriefViewModel["groups"][number];
  model: BriefViewModel;
  open: boolean;
  setOpen: (open: boolean) => void;
  jumpToChunk: (chunkId: string) => void;
}

function FocusGroupRail({
  activeChunkId,
  group,
  model,
  open,
  setOpen,
  jumpToChunk,
}: FocusGroupRailProps) {
  const panelId = useId();
  const groupFlags = model.flagsByGroup.get(group.id) ?? EMPTY_RISK_FLAGS;
  const dominant = group.group.dominantCategory;
  const activeChunk =
    group.chunks.find((chunk) => chunk.id === activeChunkId) ??
    group.chunks[0] ??
    null;

  return (
    <aside
      aria-label="Focused change-group context"
      className={`${styles["focusRail"]} focus-group-rail`}
      data-state={open ? "open" : "collapsed"}
    >
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={open ? "Collapse group context" : "Expand group context"}
        className={styles["railToggle"]}
        type="button"
        onClick={() => setOpen(!open)}
      >
        <span className={styles["railToggleText"]}>
          {group.readingOrderStep !== undefined
            ? `Step ${group.readingOrderStep}`
            : `Group ${group.index + 1}`}
        </span>
        <span aria-hidden="true" className={styles["railToggleMark"]}>
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? (
        <div className={styles["railPanel"]} id={panelId}>
          {/* Fixed header: everything above the stats divider stays put;
              only the detail region below it scrolls. */}
          <div className={styles["railHead"]}>
            <div className={styles["railMeta"]}>
              {group.readingOrderStep !== undefined
                ? `Step ${group.readingOrderStep} of ${model.groups.length}`
                : `Change-group ${group.index + 1} of ${model.groups.length}`}
            </div>
            <h2 className={styles["railTitle"]}>{group.group.title}</h2>
            <p className={styles["railSummary"]}>{group.group.summary}</p>
            {group.readingOrderWhy ? (
              <p className={styles["railWhy"]}>{group.readingOrderWhy}</p>
            ) : null}
            <div className={styles["railChips"]}>
              <span className={styles["railChip"]} data-kind="dominant">
                dominant {dominant}
              </span>
              {group.group.secondaryCategories.map((category) => (
                <span className={styles["railChip"]} key={category}>
                  secondary {category}
                </span>
              ))}
              {group.group.uncertain ? (
                <span className={styles["railChip"]} data-kind="uncertain">
                  uncertain
                </span>
              ) : null}
            </div>
          </div>
          {/* The keyboard-reachable scroll region: tabindex + label live here,
              on the element that actually scrolls, so they coincide. */}
          <div
            aria-label="Change-group details"
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
                {groupFlags.length} flag{groupFlags.length === 1 ? "" : "s"}
              </span>
            </div>
            {activeChunk ? (
              <div className={styles["railRiskFacts"]}>
                <div className={styles["railLabel"]}>Active chunk risks</div>
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
                    No risk-surface attributes on this chunk.
                  </p>
                )}
              </div>
            ) : null}
            <div className={styles["railChunkList"]}>
              <div className={styles["railLabel"]}>Chunks</div>
              {group.chunks.map((chunk) => (
                <button
                  className={styles["railChunkButton"]}
                  data-current={chunk.id === activeChunkId ? "" : undefined}
                  key={chunk.id}
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
