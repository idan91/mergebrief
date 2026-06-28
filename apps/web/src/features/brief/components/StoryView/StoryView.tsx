import type { CommentAnchor } from "../../../review/comments";
import type { DismissTarget } from "../../../review/components/DismissModal/DismissModal";
import type { EvidenceTarget } from "../../../review/components/EvidenceModal/EvidenceModal";
import { useRevisionNavigation } from "../../useRevisionNavigation";
import type { RevisionOverlayState } from "../../revisionOverlay";
import type { Brief } from "../../types";
import type { BriefViewModel } from "../../viewModel";
import { ChunkCard } from "../ChunkCard/ChunkCard";
import { GroupCard } from "../GroupCard/GroupCard";

export interface StoryViewProps {
  brief: Brief;
  model: BriefViewModel;
  revision: RevisionOverlayState;
  activeChunkId: string | null;
  collapseSupporting: boolean;
  openChunks: Set<string>;
  selectedRiskFlags: Set<string>;
  activeCommentAnchor: CommentAnchor | null;
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
  return (
    <div className="story-view">
      <div className="chunks-label reveal">
        <span>{props.brief.chunks.length} chunks · grouped by intent</span>
        <span className="rule" />
        <label className="switch">
          <input
            checked={props.collapseSupporting}
            suppressHydrationWarning
            type="checkbox"
            onChange={(event) =>
              props.setCollapseSupporting(event.target.checked)
            }
          />
          <span className="track" />
          Collapse supporting
        </label>
        {props.revision.available ? (
          <label
            className="switch revision-switch"
            title="Highlight lines new in this revision (since the previous brief)"
          >
            <input
              checked={props.revision.enabled}
              suppressHydrationWarning
              type="checkbox"
              onChange={(event) =>
                props.revision.setEnabled(event.target.checked)
              }
            />
            <span className="track" />
            Revision changes
          </label>
        ) : null}
        {props.revision.enabled && props.revision.runCount > 0 ? (
          <span
            className="revision-jump"
            role="group"
            aria-label="Jump between revision changes"
          >
            <span className="count">
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
      {props.model.groups.map((group) => (
        <section className="story-group reveal" key={group.id}>
          <div className="group-chunks">
            {group.chunks.map((chunk) => (
              <ChunkCard
                key={chunk.id}
                active={props.activeChunkId === chunk.id}
                chunk={chunk}
                revision={props.revision}
                forceCollapsed={
                  props.collapseSupporting &&
                  chunk.role === "supporting" &&
                  !props.openChunks.has(chunk.id)
                }
                open={props.openChunks.has(chunk.id)}
                activeCommentAnchor={
                  props.activeCommentAnchor?.chunkId === chunk.id
                    ? props.activeCommentAnchor
                    : null
                }
                addressedReviewComments={props.brief.reviewComments ?? []}
                cancelCommentComposer={props.cancelCommentComposer}
                deleteReviewComment={props.deleteReviewComment}
                markReviewed={props.markReviewed}
                openCommentComposer={props.openCommentComposer}
                saveReviewComment={props.saveReviewComment}
                toggleChunk={props.toggleChunk}
                toggleReviewComment={props.toggleReviewComment}
                updateReviewComment={props.updateReviewComment}
              />
            ))}
          </div>
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
        </section>
      ))}
    </div>
  );
}
