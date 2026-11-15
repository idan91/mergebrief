// Chips need text as well as color; digest rows use button disclosures.
// Keep expansion keyed by thread id across refetches. Refresh on focus/navigation
// and manual request, without background polling.
import { ReviewVerdictStates, type ReviewVerdictState } from "types";
import { useTranslation } from "react-i18next";

import { UnknownValues } from "@web/utils/open-enum/types";
import { isFilterActive } from "../../utils/filter";
import { Button } from "@web/components/Button";
import { CollapsibleBar } from "@web/components/CollapsibleBar";
import { MentionText } from "@web/components/Markdown/MentionText";
import { BarHeadingLevels } from "@web/components/CollapsibleBar/types";
import rowStyles from "../../rows.module.scss";
import { VERDICT_LABEL_KEYS } from "../../utils/chips";
import { DigestGroupView } from "./DigestGroupView";
import { HeadSummary } from "./HeadSummary";
import { RegionBoundary } from "@web/components/RegionBoundary";
import styles from "./ConversationSection.module.scss";
import type { BriefChunk } from "@web/features/brief/model";
import type { ReviewComment } from "@web/features/review/utils";
import type { ConversationFilter } from "../../utils/filter";
import type { ConversationPlan } from "./types";
import { useConversationSectionFacade } from "./useConversationSectionFacade";

export interface ConversationSectionProps {
  plan: ConversationPlan;
  /** Writes are off (no session): the reply composers refuse. */
  readOnlyReason?: string | undefined;
  chunks: readonly BriefChunk[];
  localComments: readonly ReviewComment[];
  submittedReviewIds: readonly number[];
  /**
   * Jump to a chunk, or with `target` to a thread's row inside its diff: the
   * row is the destination, the chunk its container.
   */
  jumpToChunk: (
    chunkId: string,
    target?: { rowId: string; threadId: number },
  ) => void;
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
export function ConversationSection(props: ConversationSectionProps) {
  const { plan, jumpToChunk, open, onToggle } = props;
  const { t } = useTranslation();
  const facade = useConversationSectionFacade(props);
  const { query, conversation, digest, verdicts, disclosure } = facade;

  const summary =
    facade.summaryParts.length === 0 ? undefined : (
      <HeadSummary parts={facade.summaryParts} />
    );
  const refreshAction = open ? (
    <Button
      disabled={query.isFetching}
      loading={query.isFetching}
      variant="quiet"
      onClick={facade.refresh}
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
                  {isFilterActive(facade.filter)
                    ? t("conversation.noneMatchFilter")
                    : t("conversation.noneYet")}
                </p>
              ) : null}

              {digest.map((group) => (
                <DigestGroupView
                  briefGeneratedAt={plan.briefGeneratedAt}
                  composer={facade.composer}
                  expandedGroups={disclosure.expandedGroups}
                  expandedThreads={disclosure.expandedThreads}
                  group={group}
                  jumpToChunk={jumpToChunk}
                  key={group.id}
                  showAll={disclosure.showAll}
                  shownAll={disclosure.shownAllGroups.has(group.id)}
                  toggleGroup={disclosure.toggleGroup}
                  toggleThread={disclosure.toggleThread}
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
