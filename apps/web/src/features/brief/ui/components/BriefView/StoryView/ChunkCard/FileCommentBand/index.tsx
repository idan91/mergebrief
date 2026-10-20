import { useTranslation } from "react-i18next";
import { useId } from "react";

import { LinkButton } from "@web/components/LinkButton";
import {
  ThreadRowElements,
  ThreadRowView,
  type ThreadComposerWiring,
} from "@web/features/conversation";
import type { DigestThreadRow } from "@web/features/conversation/utils";
import { CommentComposer, CommentThread } from "@web/features/review";
import type { CommentAnchor } from "@web/features/review/utils";
import type { BriefChunk } from "../../../../../../model/types";
import { useFileCommentBandFacade } from "./useFileCommentBandFacade";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import styles from "./FileCommentBand.module.scss";

const noJump = () => undefined;

export interface FileCommentBandProps {
  chunk: BriefChunk;
  composerOpen: boolean;
  onCancelComposer: () => void;
  inboundRows: readonly DigestThreadRow[];
  conversationComposer?: ThreadComposerWiring | undefined;
}

export function FileCommentBand({
  chunk,
  composerOpen,
  onCancelComposer,
  inboundRows,
  conversationComposer,
}: FileCommentBandProps) {
  const { t } = useTranslation();
  const threadsId = useId();
  const band = useFileCommentBandFacade({
    chunk,
    composerOpen,
    inboundRows,
  });
  if (!band.visible) {
    return null;
  }

  const bandState = band.showBody ? "open" : "collapsed";
  const handleToggleConversation = (threadId: number) =>
    band.toggleConversationThread(band.chunkKey, threadId);

  const handleSave = (anchor: CommentAnchor, body: string) => {
    void band.saveComment(anchor, body).then((saved) => {
      if (saved) {
        onCancelComposer();
      }
      return saved;
    });
  };

  return (
    <section
      aria-label={t("review.comment.commentOnFile")}
      className={styles["band"]}
      data-state={bandState}
      data-testid="file-comment-band"
    >
      {band.hasSaved ? (
        <div className={styles["head"]}>
          <LinkButton
            aria-controls={threadsId}
            aria-expanded={band.showBody}
            className={styles["title"]}
            disabled={composerOpen}
            onClick={band.toggleCollapsed}
          >
            <span aria-hidden="true" className={styles["twist"]}>
              <Icon
                name={IconNames.CARET_DOWN}
                rotation={
                  band.showBody
                    ? IconRotations.NONE
                    : IconRotations.THREE_QUARTERS
                }
                size={IconSizes.SM}
              />
            </span>
            {t("review.comment.commentOnFile")}
          </LinkButton>
        </div>
      ) : null}
      {band.showBody ? (
        <div className={styles["threads"]} id={threadsId}>
          {composerOpen ? (
            <CommentComposer
              anchor={band.fileAnchor}
              cancel={onCancelComposer}
              mentionSource={conversationComposer?.mentionSource}
              save={handleSave}
              saving={band.composerSaving}
            />
          ) : null}
          {band.comments.map((comment) => (
            <CommentThread
              comment={comment}
              deleteComment={band.deleteComment}
              key={comment.id}
              mentionSource={conversationComposer?.mentionSource}
              post={band.postComment}
              posting={band.postingCommentIds.includes(comment.id)}
              postBlockedExternally={band.postBlockedExternally}
              toggle={band.toggleComment}
              update={band.updateComment}
            />
          ))}
          {conversationComposer === undefined
            ? null
            : inboundRows.map((row) => (
                <ThreadRowView
                  composer={conversationComposer}
                  element={ThreadRowElements.BLOCK}
                  expanded={band.expandedConversation.has(
                    row.thread.rootCommentId,
                  )}
                  hideJump
                  jumpToChunk={noJump}
                  key={row.thread.rootCommentId}
                  row={row}
                  toggle={handleToggleConversation}
                />
              ))}
        </div>
      ) : null}
    </section>
  );
}
