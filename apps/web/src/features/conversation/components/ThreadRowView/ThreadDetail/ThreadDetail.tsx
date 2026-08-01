import { useCallback, useEffect, useRef, useState } from "react";

import { Markdown } from "@web/components/Markdown/Markdown";
import type { DigestThreadRow } from "../../../utils/digest";
import rowStyles from "../../../rows.module.scss";
import type { ThreadComposerWiring } from "../../../wiring";
import { RevisionJumpAction } from "../RevisionJumpAction/RevisionJumpAction";
import {
  mentionCandidatesFromThread,
  mergeMentionCandidates,
} from "../../../utils/mentions";
import { postdatesBrief } from "../../../utils/postdate";
import { buildQuoteBlock } from "../../../utils/quote";
import { ReplyComposer } from "./ReplyComposer/ReplyComposer";
import { ThreadResolveAction } from "./ThreadResolveAction/ThreadResolveAction";
import { useThreadResolution } from "./useThreadResolution";

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
  // Resolution flow state (BRIEF-93) lives in the facade hook; this detail is
  // the nearest common ancestor of its two consumers — the standalone action
  // below and the composer's Reply & resolve leg.
  const resolution = useThreadResolution({
    threadId: thread.rootCommentId,
    isResolved: thread.isResolved,
    resolution: composer.resolution,
  });
  // The standalone control's node, handed to the composer as its focus rescue
  // target — this detail is the only place that knows both controls exist.
  const resolveButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusResolveAction = useCallback(() => {
    resolveButtonRef.current?.focus();
  }, []);
  // Quote-reply (BRIEF-56): the button quotes the selection when one lives
  // inside THIS detail, else the whole comment; `R` requires a selection.
  // Nonce-triggered so quoting the same text twice appends twice.
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [quote, setQuote] = useState<
    { block: string; nonce: number } | undefined
  >(undefined);
  const pushQuote = (text: string) => {
    if (text.trim() === "") return;
    setQuote((current) => ({
      block: buildQuoteBlock(text),
      nonce: (current?.nonce ?? 0) + 1,
    }));
  };
  const selectionRef = useRef<() => string | null>(() => null);
  // Both ends must sit inside THIS detail: an anchored-inside selection
  // dragged past the thread would otherwise quote unrelated page content
  // (and chrome like action labels) into the reply.
  selectionRef.current = () => {
    const selection = window.getSelection();
    if (
      selection === null ||
      selection.isCollapsed ||
      !detailRef.current?.contains(selection.anchorNode) ||
      !detailRef.current?.contains(selection.focusNode)
    ) {
      return null;
    }
    return selection.toString();
  };
  const selectionInsideDetail = () => selectionRef.current();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "r" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Overlay stand-down, same convention as the page shortcuts: an open
      // modal owns the keyboard — R must not append-and-yank-focus behind it.
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      // Containment scopes the shortcut: with the same thread rendered
      // inline AND in the section, only the detail holding the selection
      // reacts.
      const text = selectionRef.current();
      if (text === null || text.trim() === "") return;
      event.preventDefault();
      setQuote((current) => ({
        block: buildQuoteBlock(text),
        nonce: (current?.nonce ?? 0) + 1,
      }));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <div className={rowStyles["detail"]} ref={detailRef}>
      {thread.comments.map((comment) => (
        <article
          aria-label={`Comment by ${comment.author.login}`}
          className={rowStyles["comment"]}
          key={comment.commentId}
        >
          <header className={rowStyles["commentHead"]}>
            {comment.author.avatarUrl === undefined ? null : (
              // Decorative — the adjacent login carries the identity.
              <img
                alt=""
                className={rowStyles["commentAvatar"]}
                decoding="async"
                loading="lazy"
                src={comment.author.avatarUrl}
              />
            )}
            <span className={rowStyles["author"]}>
              @{comment.author.login}
              {comment.author.isBot ? (
                <span className={rowStyles["botTag"]}>bot</span>
              ) : null}
            </span>
            <time dateTime={comment.createdAt}>
              {new Date(comment.createdAt).toLocaleDateString()}
            </time>
            {postdatesBrief(comment.createdAt, row.briefGeneratedAt) ? (
              <span className={rowStyles["chip"]} data-state="after-brief">
                after this brief
              </span>
            ) : null}
            <button
              aria-label={`Quote reply to @${comment.author.login}`}
              className={rowStyles["action"]}
              type="button"
              onClick={() => pushQuote(selectionInsideDetail() ?? comment.body)}
            >
              Quote reply
            </button>
          </header>
          <Markdown content={comment.body} renderSuggestions />
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
        mentionCandidates={mergeMentionCandidates(
          mentionCandidatesFromThread(thread),
          composer.mentionPool ?? [],
        )}
        quote={quote}
        onPosted={composer.onPosted}
        post={composer.post}
        // The combo closes an open thread — never offered on a resolved one
        // (Unresolve is that thread's action) nor without the capability.
        resolveAfterPost={
          resolution.available && !thread.isResolved
            ? resolution.resolveAfterReply
            : undefined
        }
        // Focus destination when the combo button retires mid-flow: the
        // standalone control is mounted for the whole combo (both outcomes
        // leave it on screen), and on a partial it IS the retry path.
        focusResolveAction={focusResolveAction}
        threadId={thread.rootCommentId}
      />
      {/* Bottom of the expanded thread, next to the composer (locked design). */}
      {resolution.available ? (
        <ThreadResolveAction
          error={resolution.error}
          exposeButton={(element) => {
            resolveButtonRef.current = element;
          }}
          pending={resolution.pending}
          resolved={thread.isResolved}
          onToggle={resolution.toggle}
        />
      ) : null}
    </div>
  );
}
