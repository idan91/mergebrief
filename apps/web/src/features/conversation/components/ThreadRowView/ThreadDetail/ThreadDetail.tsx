import { Markdown } from "@web/components/Markdown/Markdown";
import type { DigestThreadRow } from "../../../utils/digest";
import rowStyles from "../../../rows.module.scss";
import type { ThreadComposerWiring } from "../../../wiring";
import { RevisionJumpAction } from "../RevisionJumpAction/RevisionJumpAction";
import { mentionCandidatesFromThread } from "../../../utils/mentions";
import { ReplyComposer } from "./ReplyComposer/ReplyComposer";

export interface ThreadDetailProps {
  row: DigestThreadRow;
  jumpToChunk: (
    chunkId: string,
    target?: { rowId: string; threadId: number },
  ) => void;
  composer: ThreadComposerWiring;
  /** True when the detail already renders AT its chunk (inline). */
  hideJump?: boolean;
}

export function ThreadDetail({
  row,
  jumpToChunk,
  composer,
  hideJump = false,
}: ThreadDetailProps) {
  const { thread, placement } = row;
  return (
    <div className={rowStyles["detail"]}>
      {thread.comments.map((comment) => (
        <article
          aria-label={`Comment by ${comment.author.login}`}
          className={rowStyles["comment"]}
          key={comment.commentId}
        >
          <header className={rowStyles["commentHead"]}>
            <span className={rowStyles["author"]}>
              @{comment.author.login}
              {comment.author.isBot ? (
                <span className={rowStyles["botTag"]}>bot</span>
              ) : null}
            </span>
            <time dateTime={comment.createdAt}>
              {new Date(comment.createdAt).toLocaleDateString()}
            </time>
          </header>
          <Markdown content={comment.body} />
        </article>
      ))}
      {thread.hasMoreComments ? (
        <p className={rowStyles["note"]}>
          Longer thread — the rest is on GitHub.
        </p>
      ) : null}
      <div className={rowStyles["detailActions"]}>
        {placement.kind === "chunk" && !hideJump ? (
          <button
            className={rowStyles["action"]}
            type="button"
            onClick={() =>
              jumpToChunk(placement.chunkId, {
                rowId: placement.rowId,
                threadId: thread.rootCommentId,
              })
            }
          >
            Jump to comment
          </button>
        ) : null}
        <RevisionJumpAction jump={composer.revisionJump} thread={thread} />
        <a
          className={rowStyles["action"]}
          href={thread.comments[0]?.url}
          rel="noreferrer"
          target="_blank"
        >
          View on GitHub
          <span className={rowStyles["srOnly"]}> (opens in a new tab)</span>
        </a>
      </div>
      <ReplyComposer
        briefId={composer.briefId}
        mentionCandidates={mentionCandidatesFromThread(thread)}
        onPosted={composer.onPosted}
        post={composer.post}
        threadId={thread.rootCommentId}
      />
    </div>
  );
}
