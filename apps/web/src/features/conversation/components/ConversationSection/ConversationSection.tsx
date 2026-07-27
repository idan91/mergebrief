// The PR-conversation section (BRIEF-25, ADR 0027): an IN-FLOW section at
// the Brief's end — not a drawer (the drawer is the Receipt's). Verdict
// strip on top, then the digest: threads grouped by chunk in the Brief's
// reading order, unresolved first, bots collapsed per author (never
// hidden). Chips carry TEXT (WCAG 1.4.1) and stay factual — `resolved`
// never dresses as success. Digest rows are ONE keyboard pattern: a plain
// list of `<button aria-expanded>` disclosures.
//
// Live data: refetch on focus/navigation via the query's staleTime, plus
// the manual refresh control here — no background poll. Expansion state is
// keyed by thread id in component state, so it survives refetch (visible
// state, never entry-path memory).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { prefersReducedMotion } from "@web/utils/motion";
import { toggleSet } from "@web/utils/collections";
import type { BriefChunk } from "@web/features/brief/types";
import type { ReviewComment } from "@web/features/review/comments";
import { markSnapshotCommentsSubmitted } from "@web/features/review/session";
import { buildConversationDigest } from "../../digest";
import { reconcileOwnComments } from "../../ownComments";
import type { conversationQueryOptions } from "../../queries";
import type { ReplyResult } from "../../reply";
import rowStyles from "../../rows.module.scss";
import type { ConversationReview } from "../../types";
import type { ThreadComposerWiring, ThreadRevisionJump } from "../../wiring";
import { DigestGroupView } from "./DigestGroupView/DigestGroupView";
import styles from "./ConversationSection.module.scss";

/** The route-injected data plan (absent on the local demo path). */
export interface ConversationPlan {
  readonly queryOptions: ReturnType<typeof conversationQueryOptions>;
  /** Immediate viewer-token reply to a thread's root comment (BRIEF-25 #7). */
  readonly postReply: (
    rootCommentId: number,
    body: string,
  ) => Promise<ReplyResult>;
  /** Outdated-thread revision jump (BRIEF-24); absent when there is no timeline. */
  readonly revisionJump?: ThreadRevisionJump;
}

export interface ConversationSectionProps {
  plan: ConversationPlan;
  briefId: string;
  chunks: readonly BriefChunk[];
  localComments: readonly ReviewComment[];
  submittedReviewIds: readonly number[];
  /**
   * Jump to a chunk — or, when `target` is given, to a specific thread's
   * row inside its diff (the row-level rendering is the real destination;
   * the chunk is just the container).
   */
  jumpToChunk: (
    chunkId: string,
    target?: { rowId: string; threadId: number },
  ) => void;
  /** Store flip for drafts the reconciliation proved posted (BRIEF-23 residual). */
  markCommentsSubmitted: (ids: readonly string[]) => void;
  /** Collapsed/expanded state is the PAGE's (the C shortcut expands it). */
  open: boolean;
  onToggle: () => void;
  /**
   * A thread to land on after an outdated-thread revision jump (BRIEF-24 reads
   * `?thread=`): once the conversation is loaded, its digest row expands,
   * scrolls into view, flashes, and takes focus.
   */
  focusThreadId?: number | undefined;
}

const VERDICT_LABEL: Record<ConversationReview["state"], string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

/**
 * The in-flow conversation section. Error states are SPECIFIC (locked
 * design constraint); the empty state teaches. Own threads carry a
 * "yours" tag from the review-id reconciliation, and drafts the
 * reconciliation proved posted flip to submitted (server-backed wins).
 */
export function ConversationSection({
  plan,
  briefId,
  chunks,
  localComments,
  submittedReviewIds,
  jumpToChunk,
  markCommentsSubmitted,
  open,
  onToggle,
  focusThreadId,
}: ConversationSectionProps) {
  const queryClient = useQueryClient();
  const query = useQuery(plan.queryOptions);
  const [expandedThreads, setExpandedThreads] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [shownAllGroups, setShownAllGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Ids already flipped this mount — the reconciliation effect must never
  // loop (a flip changes localComments, which recomputes the reconcile).
  const flippedRef = useRef<Set<string>>(new Set());

  const conversation =
    query.data?.kind === "ready" ? query.data.conversation : undefined;

  const reconciliation = useMemo(
    () =>
      conversation === undefined
        ? undefined
        : reconcileOwnComments(
            localComments,
            conversation.threads,
            submittedReviewIds,
          ),
    [conversation, localComments, submittedReviewIds],
  );

  useEffect(() => {
    if (reconciliation === undefined) return;
    const ids = reconciliation.resurrectedDraftIds.filter(
      (id) => !flippedRef.current.has(id),
    );
    if (ids.length === 0) return;
    for (const id of ids) flippedRef.current.add(id);
    // Server-backed wins: these drafts ARE on GitHub. Live flip + durable
    // write (the provider may outlive neither — same discipline as submit).
    markCommentsSubmitted(ids);
    try {
      markSnapshotCommentsSubmitted(briefId, ids);
    } catch (persistError) {
      console.error("conversation: durable flip failed", persistError);
    }
  }, [briefId, markCommentsSubmitted, reconciliation]);

  const digest = useMemo(
    () =>
      conversation === undefined
        ? []
        : buildConversationDigest({
            conversation,
            chunks,
            ownThreadIds: reconciliation?.ownThreadIds ?? new Set(),
          }),
    [chunks, conversation, reconciliation],
  );

  const toggleThread = (threadId: number) =>
    setExpandedThreads((current) => toggleSet(current, threadId));
  const toggleGroup = (key: string) =>
    setExpandedGroups((current) => toggleSet(current, key));
  const showAll = (groupId: string) =>
    setShownAllGroups((current) => new Set(current).add(groupId));

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: plan.queryOptions.queryKey,
    });

  // Inbound `?thread=` landing (BRIEF-24): once the conversation is loaded and
  // the section is open, reveal the targeted thread, then scroll+flash+focus
  // its row. Lands ONCE per target id (a ref, not state — re-runs must not
  // re-yank focus while the reviewer reads), but the target is only marked
  // landed AFTER its row was actually found and focused — a row still hidden
  // (or data still settling) retries on the next conversation refetch instead
  // of being silently spent.
  const landedThreadRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (focusThreadId === undefined || !open || conversation === undefined) {
      return;
    }
    if (landedThreadRef.current === focusThreadId) return;
    // Reveal the target everywhere it could be hidden: expand its detail,
    // lift its group's show-more cap, and open a containing bot group — a
    // row behind any of these never renders, so it could never be landed on.
    setExpandedThreads((current) => new Set(current).add(focusThreadId));
    for (const group of digest) {
      for (const row of group.rows) {
        const holdsTarget =
          row.kind === "thread"
            ? row.thread.rootCommentId === focusThreadId
            : row.threads.some(
                (nested) => nested.thread.rootCommentId === focusThreadId,
              );
        if (!holdsTarget) continue;
        setShownAllGroups((current) => new Set(current).add(group.id));
        if (row.kind === "bot-group") {
          setExpandedGroups((current) =>
            new Set(current).add(`${group.id}:${row.author}`),
          );
        }
      }
    }
    let frames = 12;
    const land = () => {
      const row = document.querySelector<HTMLElement>(
        `[data-conversation-section-thread="${focusThreadId}"]`,
      );
      if (row !== null) {
        // Found — only now is the target spent.
        landedThreadRef.current = focusThreadId;
        // Reduced motion: land instantly. The flash side is already CSS-gated
        // (`@media (prefers-reduced-motion: reduce)` swaps the animation for
        // a static ring where the flash is styled).
        row.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "center",
        });
        (row.querySelector("button") ?? row).focus({ preventScroll: true });
        row.setAttribute("data-conversation-flash", "");
        window.setTimeout(
          () => row.removeAttribute("data-conversation-flash"),
          1600,
        );
        return;
      }
      frames -= 1;
      if (frames > 0) window.requestAnimationFrame(land);
    };
    window.requestAnimationFrame(land);
  }, [conversation, digest, focusThreadId, open]);

  // Every conversation write evicts server-side; the post-reply refetch
  // makes the reply visible in-section (locked decision 9). Draft reads,
  // draft writes, and announce copy live INSIDE ReplyComposer (session-store
  // reads) — only the transport rides here.
  const composer: ThreadComposerWiring = {
    briefId,
    post: plan.postReply,
    onPosted: refresh,
    ...(plan.revisionJump === undefined
      ? {}
      : { revisionJump: plan.revisionJump }),
  };

  const verdicts =
    conversation?.reviews.filter(
      (review) => review.state !== "COMMENTED" || review.body.trim() !== "",
    ) ?? [];

  return (
    <section
      aria-labelledby="conversation-heading"
      className={styles["section"]}
      data-conversation-section
    >
      <div className={styles["head"]}>
        {/* The heading IS the disclosure (summary counts stay visible;
            expanding reveals the digest). Also the C shortcut's focus
            target — a button is natively focusable. */}
        <h2 className={styles["heading"]}>
          <button
            aria-expanded={open}
            className={styles["headingToggle"]}
            id="conversation-heading"
            type="button"
            onClick={onToggle}
          >
            <span
              aria-hidden
              className={styles["twist"]}
              data-open={open || undefined}
            >
              ▶
            </span>
            Conversation
            {conversation !== undefined ? (
              <span className={styles["headSummary"]}>
                {conversation.threads.length} thread
                {conversation.threads.length === 1 ? "" : "s"} ·{" "}
                {
                  conversation.threads.filter((thread) => !thread.isResolved)
                    .length
                }{" "}
                open
              </span>
            ) : null}
          </button>
        </h2>
        {open ? (
          <button
            className={rowStyles["action"]}
            disabled={query.isFetching}
            type="button"
            onClick={refresh}
          >
            {query.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>
      {open ? (
        <>
          {query.isPending ? (
            <p className={rowStyles["note"]} role="status">
              Loading the conversation…
            </p>
          ) : null}
          {query.isError ? (
            <p className={rowStyles["error"]} role="alert">
              The conversation could not be read (unexpected response). Refresh
              to retry.
            </p>
          ) : null}
          {query.data?.kind === "unauthorized" ? (
            <p className={rowStyles["error"]} role="alert">
              Your GitHub session expired — sign in again to see the
              conversation.
            </p>
          ) : null}
          {query.data?.kind === "not-found" ? (
            <p className={rowStyles["error"]} role="alert">
              This pull request&apos;s conversation is no longer accessible on
              GitHub.
            </p>
          ) : null}
          {query.data?.kind === "unavailable" ? (
            <p className={rowStyles["error"]} role="alert">
              GitHub (or the backend) is unreachable — the conversation could
              not be fetched. Refresh to retry.
            </p>
          ) : null}

          {conversation !== undefined ? (
            <>
              {verdicts.length > 0 ? (
                <ul aria-label="Review verdicts" className={styles["verdicts"]}>
                  {verdicts.map((review) => (
                    <li className={styles["verdict"]} key={review.reviewId}>
                      <span className={rowStyles["author"]}>
                        @{review.author.login}
                        {review.author.isBot ? (
                          <span className={rowStyles["botTag"]}>bot</span>
                        ) : null}
                      </span>
                      <span
                        className={rowStyles["chip"]}
                        data-state={VERDICT_LABEL[review.state]}
                      >
                        {VERDICT_LABEL[review.state]}
                      </span>
                      {review.body.trim() !== "" ? (
                        <span className={rowStyles["rowLine"]}>
                          {review.body}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {digest.length === 0 && verdicts.length === 0 ? (
                <p className={rowStyles["note"]}>
                  No conversation yet — comments land here as teammates review.
                </p>
              ) : null}

              {digest.map((group) => (
                <DigestGroupView
                  composer={composer}
                  expandedGroups={expandedGroups}
                  expandedThreads={expandedThreads}
                  group={group}
                  jumpToChunk={jumpToChunk}
                  key={group.id}
                  showAll={showAll}
                  shownAll={shownAllGroups.has(group.id)}
                  toggleGroup={toggleGroup}
                  toggleThread={toggleThread}
                />
              ))}

              {conversation.hasMoreThreads ||
              conversation.hasMoreReviews ||
              conversation.hasMorePrComments ? (
                <p className={rowStyles["note"]}>
                  This conversation is unusually large — some items are only on
                  GitHub.
                </p>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
