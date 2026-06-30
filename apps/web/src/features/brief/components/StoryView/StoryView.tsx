import { useId, useState } from "react";

import type { CommentAnchor, ReviewComment } from "../../../review/comments";
import type { DismissTarget } from "../../../review/components/DismissModal/DismissModal";
import type { EvidenceTarget } from "../../../review/components/EvidenceModal/EvidenceModal";
import { useRevisionNavigation } from "../../useRevisionNavigation";
import type { RevisionOverlayState } from "../../revisionOverlay";
import type { AddressedReviewComment, Brief } from "../../types";
import type { BriefViewModel } from "../../viewModel";
import { ChunkCard } from "../ChunkCard/ChunkCard";
import { GroupCard } from "../GroupCard/GroupCard";
import styles from "./StoryView.module.scss";

const EMPTY_ADDRESSED_REVIEW_COMMENTS: AddressedReviewComment[] = [];
const EMPTY_REVIEW_COMMENTS: ReviewComment[] = [];

export interface StoryViewProps {
  brief: Brief;
  model: BriefViewModel;
  revision: RevisionOverlayState;
  activeChunkId: string | null;
  collapseSupporting: boolean;
  focusMode: boolean;
  openChunks: Set<string>;
  selectedRiskFlags: Set<string>;
  activeCommentAnchor: CommentAnchor | null;
  addressedReviewComments: AddressedReviewComment[] | undefined;
  commentsByChunk: Map<string, ReviewComment[]>;
  existingReviewCommentCount: number;
  cancelCommentComposer: () => void;
  deleteReviewComment: (commentId: string) => void;
  jumpToChunk: (chunkId: string) => void;
  markReviewed: (chunkId: string) => void;
  openCommentComposer: (anchor: CommentAnchor) => void;
  saveReviewComment: (anchor: CommentAnchor, body: string) => void;
  setCollapseSupporting: (value: boolean) => void;
  setDismissTarget: (target: DismissTarget) => void;
  setEvidenceTarget: (target: EvidenceTarget) => void;
  setToast: (message: string) => void;
  toggleChunk: (chunkId: string) => void;
  toggleRiskFlag: (flagId: string) => void;
  toggleRiskGroup: (flagIds: string[]) => void;
  toggleReviewComment: (commentId: string) => void;
  updateReviewComment: (commentId: string, body: string) => void;
}

export function StoryView(props: StoryViewProps) {
  const { jumpPrev, jumpNext } = useRevisionNavigation();
  const [focusRailOpen, setFocusRailOpen] = useState(true);
  const addressedReviewComments =
    props.addressedReviewComments ?? EMPTY_ADDRESSED_REVIEW_COMMENTS;
  return (
    <div
      className={styles["storyView"]}
      data-zen={props.focusMode ? "on" : undefined}
    >
      <div className={`${styles["chunksLabel"]} reveal`}>
        <span>{props.brief.chunks.length} chunks · grouped by intent</span>
        <span className={styles["rule"]} />
        <label className={styles["switch"]}>
          <input
            checked={props.collapseSupporting}
            className={styles["switchInput"]}
            suppressHydrationWarning
            type="checkbox"
            onChange={(event) =>
              props.setCollapseSupporting(event.target.checked)
            }
          />
          <span className={styles["track"]} />
          Collapse supporting
        </label>
        {props.revision.available ? (
          <label
            className={styles["switch"]}
            title="Highlight lines new in this revision (since the previous brief)"
          >
            <input
              checked={props.revision.enabled}
              className={styles["switchInput"]}
              suppressHydrationWarning
              type="checkbox"
              onChange={(event) =>
                props.revision.setEnabled(event.target.checked)
              }
            />
            <span className={styles["track"]} />
            Revision changes
          </label>
        ) : null}
        {props.revision.enabled && props.revision.runCount > 0 ? (
          <span
            className={styles["revisionJump"]}
            role="group"
            aria-label="Jump between revision changes"
          >
            <span className={styles["count"]}>
              {props.revision.runCount} revision change
              {props.revision.runCount === 1 ? "" : "s"}
            </span>
            <button
              aria-label="Previous revision change"
              type="button"
              onClick={jumpPrev}
            >
              ◂
            </button>
            <button
              aria-label="Next revision change"
              type="button"
              onClick={jumpNext}
            >
              ▸
            </button>
          </span>
        ) : null}
      </div>
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
                  revision={props.revision}
                  forceCollapsed={
                    props.collapseSupporting && chunk.role === "supporting"
                  }
                  open={props.openChunks.has(chunk.id)}
                  activeCommentAnchor={
                    props.activeCommentAnchor?.chunkId === chunk.id
                      ? props.activeCommentAnchor
                      : null
                  }
                  addressedReviewComments={addressedReviewComments}
                  cancelCommentComposer={props.cancelCommentComposer}
                  comments={
                    props.commentsByChunk.get(chunk.id) ?? EMPTY_REVIEW_COMMENTS
                  }
                  deleteReviewComment={props.deleteReviewComment}
                  existingReviewCommentCount={props.existingReviewCommentCount}
                  markReviewed={props.markReviewed}
                  openCommentComposer={props.openCommentComposer}
                  saveReviewComment={props.saveReviewComment}
                  toggleChunk={props.toggleChunk}
                  toggleReviewComment={props.toggleReviewComment}
                  updateReviewComment={props.updateReviewComment}
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
                selectedRiskFlags={props.selectedRiskFlags}
                jumpToChunk={props.jumpToChunk}
                setDismissTarget={props.setDismissTarget}
                setEvidenceTarget={props.setEvidenceTarget}
                setToast={props.setToast}
                toggleRiskFlag={props.toggleRiskFlag}
                toggleRiskGroup={props.toggleRiskGroup}
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
  const groupFlags = model.flags.filter((flag) => flag.groupId === group.id);
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
          Group {group.index + 1}
        </span>
        <span aria-hidden="true" className={styles["railToggleMark"]}>
          {open ? "−" : "+"}
        </span>
      </button>
      {!open ? (
        <div className={styles["railCollapsed"]} aria-hidden="true">
          <span>Group {group.index + 1}</span>
          <strong>{group.group.title}</strong>
        </div>
      ) : null}
      {open ? (
        <div className={styles["railPanel"]} id={panelId}>
          <div className={styles["railMeta"]}>
            Change-group {group.index + 1} of {model.groups.length}
          </div>
          <h2 className={styles["railTitle"]}>{group.group.title}</h2>
          <p className={styles["railSummary"]}>{group.group.summary}</p>
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
                  {activeChunk.riskSurface.map((risk) => (
                    <span className={styles["railRiskChip"]} key={risk}>
                      {risk}
                    </span>
                  ))}
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
      ) : null}
    </aside>
  );
}
