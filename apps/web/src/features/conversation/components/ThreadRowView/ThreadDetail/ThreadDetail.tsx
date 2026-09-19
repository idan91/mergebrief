import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@web/components/Button/Button";
import { Markdown } from "@web/components/Markdown/Markdown";
import { formatDate, renderedLocale } from "@web/i18n/locale";
import type { DigestThreadRow } from "../../../utils/digest";
import { ThreadPlacementKinds } from "../../../utils/anchor";
import rowStyles from "../../../rows.module.scss";
import type { ThreadComposerWiring } from "../../../wiring";
import { RevisionJumpAction } from "../RevisionJumpAction/RevisionJumpAction";
import {
  mentionCandidatesFromThread,
  mergeMentionCandidates,
} from "../../../utils/mentions";
import { NO_OWN_REVIEWS, postdatesBrief } from "../../../utils/postdate";
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
  const { i18n, t } = useTranslation();
  const locale = renderedLocale(i18n.resolvedLanguage);
  const { thread, placement } = row;
  const ownReviewIds = row.ownReviewIds ?? NO_OWN_REVIEWS;
  // This detail is the nearest common ancestor of the flow's two consumers:
  // the standalone action below and the composer's Reply & resolve leg.
  const resolution = useThreadResolution({
    threadId: thread.rootCommentId,
    isResolved: thread.isResolved,
    resolution: composer.resolution,
  });
  // The standalone control's node, handed to the composer as its focus rescue
  // target. This detail is the only place that knows both controls exist.
  const resolveButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusResolveAction = useCallback(() => {
    resolveButtonRef.current?.focus();
  }, []);
  // The button quotes the selection when one lives inside THIS detail, else
  // the whole comment; `R` requires a selection. Nonce-triggered so quoting
  // the same text twice appends twice.
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
      // An open modal owns the keyboard. R must not act behind it.
      if (document.querySelector('[aria-modal="true"]') !== null) return;
      // Containment scopes the shortcut: with the same thread rendered inline
      // AND in the section, only the detail holding the selection reacts.
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
  // The parser guarantees a root comment; guard anyway rather than render a
  // self-opening href="".
  const rootCommentUrl = thread.comments[0]?.url;
  const showJump =
    !hideJump &&
    (placement.kind === ThreadPlacementKinds.CHUNK ||
      placement.kind === ThreadPlacementKinds.FILE_HEADER);
  const jumpToPlacedThread = () => {
    if (placement.kind === ThreadPlacementKinds.FILE_HEADER) {
      jumpToChunk(placement.chunkId);
      return;
    }
    if (placement.kind !== ThreadPlacementKinds.CHUNK) return;
    jumpToChunk(placement.chunkId, {
      rowId: placement.rowId,
      threadId: thread.rootCommentId,
    });
  };
  return (
    <div className={rowStyles["detail"]} ref={detailRef}>
      {thread.comments.map((comment) => (
        <article
          aria-label={t("conversation.ariaLabelComment", {
            login: comment.author.login,
          })}
          className={rowStyles["comment"]}
          key={comment.commentId}
        >
          <header className={rowStyles["commentHead"]}>
            {comment.author.avatarUrl === undefined ? null : (
              // Decorative. The adjacent login carries the identity.
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
                <span className={rowStyles["botTag"]}>
                  {t("conversation.botTag")}
                </span>
              ) : null}
            </span>
            <time dateTime={comment.createdAt}>
              {formatDate(comment.createdAt, locale)}
            </time>
            {postdatesBrief(comment, row.briefGeneratedAt, ownReviewIds) ? (
              <span className={rowStyles["chip"]} data-state="after-brief">
                {t("conversation.afterThisBrief")}
              </span>
            ) : null}
            <Button
              aria-label={t("conversation.ariaLabelQuoteReply", {
                login: comment.author.login,
              })}
              className={rowStyles["quoteAction"]}
              variant="quiet"
              onClick={() => pushQuote(selectionInsideDetail() ?? comment.body)}
            >
              {t("conversation.quoteReply")}
            </Button>
          </header>
          <Markdown
            content={comment.body}
            filePath={thread.path}
            renderSuggestions
          />
        </article>
      ))}
      {thread.hasMoreComments ? (
        <p className={rowStyles["note"]}>{t("conversation.longerThread")}</p>
      ) : null}
      <div className={rowStyles["detailActions"]}>
        {showJump ? (
          <Button variant="quiet" onClick={jumpToPlacedThread}>
            {t("conversation.jumpToComment")}
          </Button>
        ) : null}
        <RevisionJumpAction jump={composer.revisionJump} thread={thread} />
        {/* AccessibleLink under as="a" announces the new tab itself. */}
        {rootCommentUrl !== undefined ? (
          <Button as="a" href={rootCommentUrl} target="_blank" variant="quiet">
            {t("conversation.viewOnGithub")}
          </Button>
        ) : null}
      </div>
      <ReplyComposer
        readOnlyReason={composer.readOnlyReason}
        mentionCandidates={mergeMentionCandidates(
          mentionCandidatesFromThread(thread),
          composer.mentionPool ?? [],
        )}
        quote={quote}
        onPosted={composer.onPosted}
        post={composer.post}
        // The combo closes an open thread. Never offered on a resolved one
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
