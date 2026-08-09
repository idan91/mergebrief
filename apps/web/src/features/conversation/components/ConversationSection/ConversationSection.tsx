// The in-flow PR-conversation section: verdict strip, then threads grouped
// by chunk in the Brief's reading order, unresolved first, bots collapsed
// per author (never hidden). Chips carry TEXT, not color alone (WCAG 1.4.1).
// Digest rows are one keyboard pattern: `<button aria-expanded>` disclosures.
//
// No background poll — refetch on focus/navigation via the query's staleTime
// plus the manual refresh control. Expansion state is keyed by thread id in
// component state so it survives refetch.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { prefersReducedMotion } from "@web/utils/motion";
import { toggleSet } from "@web/utils/collections";
import type { BriefChunk } from "@web/features/brief/types";
import type { ReviewComment } from "@web/features/review/utils/comments";
import { markSnapshotCommentsSubmitted } from "@web/features/review/session";
import { buildConversationDigest } from "../../utils/digest";
import {
  applyConversationFilter,
  DEFAULT_CONVERSATION_FILTER,
  isFilterActive,
  reconcileReviewers,
  type ConversationFilter,
} from "../../utils/filter";
import { countCommentsAfterBrief } from "../../utils/postdate";
import { reconcileOwnComments } from "../../utils/ownComments";
import type {
  collaboratorsQueryOptions,
  conversationQueryOptions,
} from "../../queries";
import { useMentionPool } from "../../hooks/useMentionPool";
import type { ReplyResult } from "../../reply";
import rowStyles from "../../rows.module.scss";
import type { ConversationReview } from "../../types";
import type {
  ConversationResolutionPlan,
  ThreadComposerWiring,
  ThreadRevisionJump,
} from "../../wiring";
import { DigestGroupView } from "./DigestGroupView/DigestGroupView";
import styles from "./ConversationSection.module.scss";

/** The route-injected data plan (absent on the local demo path). */
export interface ConversationPlan {
  readonly queryOptions: ReturnType<typeof conversationQueryOptions>;
  /**
   * Collaborator roster for mention autocomplete. Absent on the local demo
   * path; a non-ready result degrades to participants-only silently.
   */
  readonly collaborators?: ReturnType<typeof collaboratorsQueryOptions>;
  /** Immediate viewer-token reply to a thread's root comment. */
  readonly postReply: (
    rootCommentId: number,
    body: string,
  ) => Promise<ReplyResult>;
  /** Absent on the local demo path — no resolve affordance renders at all. */
  readonly resolution?: ConversationResolutionPlan;
  /** Absent when there is no revision timeline. */
  readonly revisionJump?: ThreadRevisionJump;
  /**
   * The VIEWED revision's generation start: newer comments postdate the brief
   * and get marked, so an older revision honestly marks more. Absent marks
   * nothing.
   */
  readonly briefGeneratedAt?: string;
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
  /** Store flip for drafts the reconciliation proved posted. */
  markCommentsSubmitted: (ids: readonly string[]) => void;
  /** Collapsed/expanded state is the PAGE's (the C shortcut expands it). */
  open: boolean;
  onToggle: () => void;
  /**
   * A thread to land on: once the conversation is loaded, its digest row
   * expands, scrolls into view, flashes, and takes focus.
   */
  focusThreadId?: number | undefined;
  /**
   * URL-carried reviewer/verdict filter. This section only READS it — the
   * toolbar's Filter disclosure above owns writes — so the digest, the strip
   * and the diff agree.
   *
   * Deliberately not on the plan: the plan's identity feeds the memo
   * boundaries that keep the diff's chunk cards off the render path.
   */
  filter?: ConversationFilter | undefined;
}

const VERDICT_LABEL: Record<ConversationReview["state"], string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

/**
 * Error states stay specific and the empty state teaches. Own threads carry a
 * "yours" tag from the review-id reconciliation, and drafts the reconciliation
 * proved posted flip to submitted (server-backed wins).
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
  filter: filterProp,
}: ConversationSectionProps) {
  const queryClient = useQueryClient();
  const query = useQuery(plan.queryOptions);
  // Shared query key with the inline wiring; non-ready = empty =
  // participants-only autocomplete.
  const mentionPool = useMentionPool(plan.collaborators);
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
    // These drafts ARE on GitHub: live flip plus a durable write, since the
    // provider may outlive neither.
    markCommentsSubmitted(ids);
    try {
      markSnapshotCommentsSubmitted(briefId, ids);
    } catch (persistError) {
      console.error("conversation: durable flip failed", persistError);
    }
  }, [briefId, markCommentsSubmitted, reconciliation]);

  // The filter as it applies to THIS conversation: logins nobody matches are
  // dropped, so a stale shared link loosens instead of emptying the section.
  const filter = useMemo(
    () =>
      conversation === undefined
        ? (filterProp ?? DEFAULT_CONVERSATION_FILTER)
        : reconcileReviewers(
            filterProp ?? DEFAULT_CONVERSATION_FILTER,
            conversation,
          ),
    [conversation, filterProp],
  );

  // Everything below reads the FILTERED conversation through this one call,
  // so the strip, the digest and the diff can never disagree.
  //
  // A `?thread=` landing target is EXEMPT: filter keys persist in the URL, so
  // a filtered-out target would make the jump silently do nothing.
  const filtered = useMemo(() => {
    if (conversation === undefined) return undefined;
    const next = applyConversationFilter(conversation, filter);
    if (focusThreadId === undefined) return next;
    const alreadyIn = next.threads.some(
      (thread) => thread.rootCommentId === focusThreadId,
    );
    if (alreadyIn) return next;
    const target = conversation.threads.find(
      (thread) => thread.rootCommentId === focusThreadId,
    );
    return target === undefined
      ? next
      : { ...next, threads: [...next.threads, target] };
  }, [conversation, filter, focusThreadId]);

  const digest = useMemo(
    () =>
      filtered === undefined
        ? []
        : buildConversationDigest({
            conversation: filtered,
            chunks,
            ownThreadIds: reconciliation?.ownThreadIds ?? new Set(),
            briefGeneratedAt: plan.briefGeneratedAt,
          }),
    [chunks, filtered, plan.briefGeneratedAt, reconciliation],
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

  // Inbound `?thread=` landing: reveal the targeted thread, then
  // scroll+flash+focus its row. Lands ONCE per target id (a ref, not state —
  // re-runs must not re-yank focus while the reviewer reads), and is only
  // marked landed AFTER the row was found and focused, so a still-hidden row
  // retries on the next refetch instead of being silently spent.
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
        // Reduced motion lands instantly; the flash is CSS-gated where styled.
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

  // Every conversation write evicts server-side; the post-reply refetch makes
  // the reply visible in-section. Draft reads/writes and announce copy live
  // inside ReplyComposer — only the transport rides here.
  const composer: ThreadComposerWiring = {
    briefId,
    post: plan.postReply,
    onPosted: refresh,
    mentionPool,
    ...(plan.revisionJump === undefined
      ? {}
      : { revisionJump: plan.revisionJump }),
    // A resolution flip is a conversation write too: the row's slim/full
    // transition comes from THIS section's refetch, not a local edit.
    ...(plan.resolution === undefined
      ? {}
      : {
          resolution: { ...plan.resolution, refetchConversation: refresh },
        }),
  };

  // Comments the viewed revision's brief cannot account for — an older
  // revision honestly counts more; zero (or no cutoff) renders nothing.
  const afterBriefCount = useMemo(
    () =>
      conversation === undefined
        ? 0
        : countCommentsAfterBrief(conversation, plan.briefGeneratedAt),
    [conversation, plan.briefGeneratedAt],
  );

  // Empty-bodied COMMENTED reviews (GitHub's envelope around inline comments)
  // are already dropped by `applyConversationFilter`.
  const verdicts = filtered?.reviews ?? [];

  return (
    <section
      aria-labelledby="conversation-heading"
      className={styles["section"]}
      data-conversation-section
    >
      <div className={styles["head"]}>
        {/* The heading IS the disclosure, and the C shortcut's focus target —
            a button is natively focusable. */}
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
            {/* Totals ONLY: the header describes the whole conversation;
                filter state renders in exactly one place — the toolbar's
                Filter trigger. */}
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
      {afterBriefCount > 0 ? (
        <p className={styles["afterBriefNote"]}>
          {afterBriefCount} comment{afterBriefCount === 1 ? "" : "s"} arrived
          after this brief was generated
        </p>
      ) : null}
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
                  {isFilterActive(filter)
                    ? "No activity matches these filters."
                    : "No conversation yet — comments land here as teammates review."}
                </p>
              ) : null}

              {digest.map((group) => (
                <DigestGroupView
                  briefGeneratedAt={plan.briefGeneratedAt}
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
