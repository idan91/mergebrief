// Chips need text as well as color; digest rows use button disclosures.
// Keep expansion keyed by thread id across refetches. Refresh on focus/navigation
// and manual request, without background polling.
import {
  ReviewVerdictStates,
  type Mutable,
  type ReviewVerdictState,
} from "types";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { prefersReducedMotion } from "@web/utils/motion";
import { UnknownValues } from "@web/utils/open-enum/types";
import { toggleSet } from "@web/utils/collections";
import type { BriefChunk } from "@web/features/brief/model";
import type { ReviewComment } from "@web/features/review/utils";
import { buildConversationDigest } from "../../utils/digest";
import {
  applyConversationFilter,
  DEFAULT_CONVERSATION_FILTER,
  isFilterActive,
  reconcileReviewers,
  type ConversationFilter,
} from "../../utils/filter";
import { NO_OWN_REVIEWS, countCommentsAfterBrief } from "../../utils/postdate";
import { reconcileOwnComments } from "../../utils/ownComments";
import type { buildConversationQueryOptions } from "../../queries";
import { buildMentionSource } from "../../utils/mentions";
import { Button } from "@web/components/Button";
import { CollapsibleBar } from "@web/components/CollapsibleBar";
import { MentionText } from "@web/components/Markdown/MentionText";
import { BarHeadingLevels } from "@web/components/CollapsibleBar/types";
import rowStyles from "../../rows.module.scss";
import type { ReplyResult } from "../../types";
import type {
  ConversationResolutionPlan,
  ThreadComposerWiring,
  ThreadRevisionJump,
} from "../../wiring";
import { VERDICT_LABEL_KEYS } from "../../utils/chips";
import { DigestGroupView } from "./DigestGroupView";
import { HeadSummary } from "./HeadSummary";
import {
  listHeadSummaryParts,
  markSmoothScroll,
  shouldRelandInPlace,
} from "./utils";
import { RegionBoundary } from "@web/components/RegionBoundary";
import styles from "./ConversationSection.module.scss";

/** The route-injected data plan (absent on the local demo path). */
export interface ConversationPlan {
  readonly queryOptions: ReturnType<typeof buildConversationQueryOptions>;
  /**
   * The repository GitHub is asked for mention suggestions. Absent on the
   * local demo path, where only the conversation's participants are offered.
   */
  readonly mentionRepoId?: string;
  /** Immediate viewer-token reply to a thread's root comment. */
  readonly postReply: (
    rootCommentId: number,
    body: string,
  ) => Promise<ReplyResult>;
  /** Absent on the local demo path, no resolve affordance renders at all. */
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
  /** Writes are off (no session): the reply composers refuse. */
  readOnlyReason?: string | undefined;
  chunks: readonly BriefChunk[];
  localComments: readonly ReviewComment[];
  submittedReviewIds: readonly number[];
  /**
   * Jump to a chunk, or, when `target` is given, to a specific thread's
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
   * The toolbar owns filter writes; this section reads the same URL state as the diff.
   * Keep it off the plan whose identity protects memoized chunk cards.
   */
  filter?: ConversationFilter | undefined;
  /** Marks the landing's smooth scroll in flight, so a landing hold leaves it alone. */
  beginSmoothScroll?: () => () => void;
}

const VERDICT_STATE_ATTRIBUTES: Record<ReviewVerdictState, string> = {
  [ReviewVerdictStates.APPROVED]: "approved",
  [ReviewVerdictStates.CHANGES_REQUESTED]: "changes-requested",
  [ReviewVerdictStates.COMMENTED]: "commented",
  [ReviewVerdictStates.DISMISSED]: "dismissed",
};

/**
 * Error states stay specific and the empty state teaches. Own threads carry a
 * "yours" tag from the review-id reconciliation, and drafts the reconciliation
 * proved posted flip to submitted (server-backed wins).
 */
export function ConversationSection({
  plan,
  readOnlyReason,
  chunks,
  localComments,
  submittedReviewIds,
  jumpToChunk,
  markCommentsSubmitted,
  open,
  onToggle,
  focusThreadId,
  filter: filterProp,
  beginSmoothScroll,
}: ConversationSectionProps) {
  const { t } = useTranslation();
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
  // Ids already flipped this mount, the reconciliation effect must never
  // loop (a flip changes localComments, which recomputes the reconcile).
  const flippedRef = useRef<Set<string>>(new Set());

  const conversation =
    query.data?.kind === "ready" ? query.data.conversation : undefined;
  const mentionSource = useMemo(
    () => buildMentionSource(plan.mentionRepoId, conversation),
    [conversation, plan.mentionRepoId],
  );

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
    if (reconciliation === undefined) {
      return;
    }
    const ids = reconciliation.resurrectedDraftIds.filter(
      (id) => !flippedRef.current.has(id),
    );
    if (ids.length === 0) {
      return;
    }
    for (const id of ids) {
      flippedRef.current.add(id);
    }
    // These drafts ARE on GitHub.
    markCommentsSubmitted(ids);
  }, [markCommentsSubmitted, reconciliation]);

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
    if (conversation === undefined) {
      return undefined;
    }
    const next = applyConversationFilter(conversation, filter);
    if (focusThreadId === undefined) {
      return next;
    }
    const alreadyIn = next.threads.some(
      (thread) => thread.rootCommentId === focusThreadId,
    );
    if (alreadyIn) {
      return next;
    }
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
        : buildConversationDigest(t, {
            conversation: filtered,
            chunks,
            ownThreadIds: reconciliation?.ownThreadIds ?? new Set(),
            briefGeneratedAt: plan.briefGeneratedAt,
            ownReviewIds: reconciliation?.ownReviewIds,
          }),
    [chunks, filtered, plan.briefGeneratedAt, reconciliation, t],
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

  // Spend a thread landing only after its row is found and focused. Hidden rows retry
  // on refetch; a completed target must not keep pulling focus from the reviewer.
  const landedThreadRef = useRef<number | undefined>(undefined);
  const [landingRequest, setLandingRequest] = useState(0);
  useEffect(() => {
    if (focusThreadId === undefined || !open || conversation === undefined) {
      return;
    }
    if (landedThreadRef.current === focusThreadId) {
      return;
    }
    // Reveal the target everywhere it could be hidden: expand its detail,
    // lift its group's show-more cap, and open a containing bot group, a
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
        if (!holdsTarget) {
          continue;
        }
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
        // Found, only now is the target spent.
        landedThreadRef.current = focusThreadId;
        // Reduced motion lands instantly; the flash is CSS-gated where styled.
        const smooth = !prefersReducedMotion();
        if (smooth && beginSmoothScroll !== undefined) {
          markSmoothScroll(beginSmoothScroll);
        }
        row.scrollIntoView({
          behavior: smooth ? "smooth" : "auto",
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
      if (frames > 0) {
        window.requestAnimationFrame(land);
      }
    };
    window.requestAnimationFrame(land);
  }, [
    conversation,
    digest,
    focusThreadId,
    open,
    landingRequest,
    beginSmoothScroll,
  ]);

  // Every conversation write evicts server-side; the post-reply refetch makes
  // the reply visible in-section. Draft reads/writes and announce copy live
  // inside ReplyComposer, only the transport rides here.
  const composer: Mutable<ThreadComposerWiring> = {
    post: plan.postReply,
    onPosted: refresh,
    mentionSource,
  };

  if (readOnlyReason !== undefined) {
    composer.readOnlyReason = readOnlyReason;
  }
  if (plan.revisionJump !== undefined) {
    const revisionJump = plan.revisionJump;
    composer.revisionJump = {
      ...revisionJump,
      onJump: (anchorSha, threadId) => {
        const spot = {
          currentHeadSha: revisionJump.currentHeadSha,
          anchorSha,
          focusThreadId,
          threadId,
        };
        if (shouldRelandInPlace(spot)) {
          landedThreadRef.current = undefined;
          setLandingRequest((count) => count + 1);
        }
        revisionJump.onJump(anchorSha, threadId);
      },
    };
  }
  // A resolution flip is a conversation write too: the row's slim/full
  // transition comes from THIS section's refetch, not a local edit.
  if (plan.resolution !== undefined) {
    composer.resolution = { ...plan.resolution, refetchConversation: refresh };
  }

  // Comments the viewed revision's brief cannot account for, an older
  // revision honestly counts more; zero (or no cutoff) renders nothing.
  const afterBriefCount = useMemo(
    () =>
      conversation === undefined
        ? 0
        : countCommentsAfterBrief(
            conversation,
            plan.briefGeneratedAt,
            reconciliation?.ownReviewIds ?? NO_OWN_REVIEWS,
          ),
    [conversation, plan.briefGeneratedAt, reconciliation],
  );

  // Empty-bodied COMMENTED reviews (GitHub's envelope around inline comments)
  // are already dropped by `applyConversationFilter`.
  const verdicts = filtered?.reviews ?? [];

  const summaryParts =
    conversation === undefined
      ? []
      : listHeadSummaryParts(conversation, afterBriefCount);
  const summary =
    summaryParts.length === 0 ? undefined : (
      <HeadSummary parts={summaryParts} />
    );

  const refreshAction = open ? (
    <Button
      disabled={query.isFetching}
      loading={query.isFetching}
      variant="quiet"
      onClick={refresh}
    >
      {query.isFetching
        ? t("conversation.refreshing")
        : t("conversation.refresh")}
    </Button>
  ) : undefined;
  const threadsResetKey = String(query.dataUpdatedAt);
  return (
    <CollapsibleBar
      actions={refreshAction}
      data-conversation-section=""
      headingLevel={BarHeadingLevels.H2}
      open={open}
      summary={summary}
      title={t("conversation.heading")}
      toggleClassName={styles["headingToggle"]}
      toggleId="conversation-heading"
      onToggle={onToggle}
    >
      {open ? (
        <div className={styles["body"]}>
          {query.isPending ? (
            <p className={rowStyles["note"]} role="status">
              {t("conversation.loading")}
            </p>
          ) : null}
          {query.isError ? (
            <p className={rowStyles["error"]} role="alert">
              {t("conversation.readFailed")}
            </p>
          ) : null}
          {query.data?.kind === "unauthorized" ? (
            <p className={rowStyles["error"]} role="alert">
              {t("conversation.unauthorized")}
            </p>
          ) : null}
          {query.data?.kind === "not-found" ? (
            <p className={rowStyles["error"]} role="alert">
              {t("conversation.notFound")}
            </p>
          ) : null}
          {query.data?.kind === "unavailable" ? (
            <p className={rowStyles["error"]} role="alert">
              {t("conversation.unavailable")}
            </p>
          ) : null}

          {conversation !== undefined ? (
            <RegionBoundary
              heading={<h3>{t("conversation.renderFailed")}</h3>}
              resetKey={threadsResetKey}
            >
              {verdicts.length > 0 ? (
                <ul
                  aria-label={t("conversation.ariaLabelVerdicts")}
                  className={styles["verdicts"]}
                >
                  {verdicts.map((review) => (
                    <li className={styles["verdict"]} key={review.reviewId}>
                      <span className={rowStyles["author"]}>
                        @{review.author.login}
                        {review.author.isBot ? (
                          <span className={rowStyles["botTag"]}>
                            {t("conversation.botTag")}
                          </span>
                        ) : null}
                      </span>
                      {review.state === UnknownValues.UNKNOWN ? null : (
                        <span
                          className={rowStyles["chip"]}
                          data-state={VERDICT_STATE_ATTRIBUTES[review.state]}
                        >
                          {t(VERDICT_LABEL_KEYS[review.state])}
                        </span>
                      )}
                      {review.body.trim() !== "" ? (
                        <span className={rowStyles["rowLine"]}>
                          <MentionText text={review.body} />
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {digest.length === 0 && verdicts.length === 0 ? (
                <p className={rowStyles["note"]}>
                  {isFilterActive(filter)
                    ? t("conversation.noneMatchFilter")
                    : t("conversation.noneYet")}
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
                  {t("conversation.tooLarge")}
                </p>
              ) : null}
            </RegionBoundary>
          ) : null}
        </div>
      ) : null}
    </CollapsibleBar>
  );
}
