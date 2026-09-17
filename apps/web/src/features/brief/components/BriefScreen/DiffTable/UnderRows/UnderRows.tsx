import type { ComponentProps } from "react";

import {
  type ThreadComposerWiring,
  ThreadRowView,
} from "@web/features/conversation";
import type { DigestThreadRow } from "@web/features/conversation/utils";
import {
  AddressedDiffComment,
  CommentComposer,
  CommentThread,
} from "@web/features/review";
import type { LineCommentAnchor } from "@web/features/review/utils";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { DiffRowView } from "../diffRowView";
import { SpanEndRow } from "../SpanEndRow/SpanEndRow";
import type { UnderRowLayout } from "../types";
import { UnderRow } from "../UnderRow/UnderRow";
import { placementForAnchor, placementForThread } from "../utils";

// Row-level threads already sit AT their line, so the detail's jump is hidden.
const noJump = () => undefined;

export interface UnderRowsProps {
  view: DiffRowView;
  line: DiffLine;
  layout: UnderRowLayout;
  /** Inside a sibling span's frame, so every row carries the frame's edges. */
  spanned: boolean;
  /** The span's last row: the frame's end rule follows the attachments. */
  closesSpan: boolean;
  conversationRows: readonly DigestThreadRow[];
  conversationComposer: ThreadComposerWiring | undefined;
  expandedConversation: ReadonlySet<number>;
  onToggleConversationThread: (threadId: number) => void;
  activeCommentAnchor: LineCommentAnchor | null;
  composerSaving: boolean;
  cancelComposer: ComposerProps["cancel"];
  saveComment: ComposerProps["save"];
  deleteComment: ThreadProps["deleteComment"];
  toggleComment: ThreadProps["toggle"];
  updateComment: ThreadProps["update"];
  postReviewComment: ThreadProps["post"];
  postingCommentIds: readonly string[];
  postBlockedExternally: ThreadProps["postBlockedExternally"];
  reviewCommentLabel: string;
}

type ComposerProps = ComponentProps<typeof CommentComposer>;
type ThreadProps = ComponentProps<typeof CommentThread>;

/**
 * Everything that hangs under one diff row: the composer it hosts, its
 * review comments, the conversation threads on its line, the addressed
 * comments, and the span's end rule when the row closes a frame.
 */
export function UnderRows({
  view,
  line,
  layout,
  spanned,
  closesSpan,
  conversationRows,
  conversationComposer,
  expandedConversation,
  onToggleConversationThread,
  activeCommentAnchor,
  composerSaving,
  cancelComposer,
  saveComment,
  deleteComment,
  toggleComment,
  updateComment,
  postReviewComment,
  postingCommentIds,
  postBlockedExternally,
  reviewCommentLabel,
}: UnderRowsProps) {
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
          spanned={spanned}
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
          spanned={spanned}
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
            spanned={spanned}
          >
            <ThreadRowView
              composer={conversationComposer}
              expanded={expandedConversation.has(row.thread.rootCommentId)}
              hideJump
              jumpToChunk={noJump}
              row={row}
              toggle={onToggleConversationThread}
            />
          </UnderRow>
        ) : null,
      )}
      {view.rowAddressedComments.map((comment) => (
        <UnderRow
          key={`addressed-${comment.id}`}
          layout={layout}
          spanned={spanned}
        >
          <AddressedDiffComment comment={comment} label={reviewCommentLabel} />
        </UnderRow>
      ))}
      {closesSpan ? <SpanEndRow columnCount={layout.columnCount} /> : null}
    </>
  );
}
