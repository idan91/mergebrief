// The filter UI as anchored-panel CONTENT. Chips carry TEXT, not color alone
// (WCAG 1.4.1); selection is OR within a family and AND across; All/None/Clear go
// aria-disabled rather than disabled so focus survives. Selection lives in the
// URL, so this component is pure props, and the live region belongs to the wrapper.
import { useTranslation } from "react-i18next";
import { Button } from "@web/components/Button";
import { Chip } from "@web/components/Chip";
import { Checkbox } from "@web/components/Checkbox";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import {
  isFilterActive,
  withAllReviewers,
  withLatestOnly,
  withNoFilters,
  withNoReviewers,
  withReviewerSelection,
  withVerdictSelection,
  type ConversationFilter,
  type FilterVerdictState,
  type ReviewerFacet,
  type VerdictFacet,
} from "../../utils/filter";
import rowStyles from "../../rows.module.scss";
import styles from "./ConversationFilterPanel.module.scss";

export interface ConversationFilterPanelProps {
  filter: ConversationFilter;
  verdicts: readonly VerdictFacet[];
  reviewers: readonly ReviewerFacet[];
  onChange: (next: ConversationFilter) => void;
}

/** Chip text, the digest's own verdict vocabulary. */
const VERDICT_LABEL: Record<FilterVerdictState, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  COMMENTED: "commented",
};

const VERDICT_ORDER: readonly FilterVerdictState[] = [
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
];

/**
 * The chips to draw: every state with reviews behind it, PLUS any state the
 * filter selects. Zero-count states drop out only while UNSELECTED, a
 * selected chip that vanished would leave an active filter nothing to unpress.
 */
function chipFacets(
  facets: readonly VerdictFacet[],
  filter: ConversationFilter,
): readonly VerdictFacet[] {
  return VERDICT_ORDER.flatMap((state) => {
    const facet = facets.find((candidate) => candidate.state === state);
    if (facet !== undefined) return [facet];
    return filter.verdicts.has(state)
      ? [{ state, humanCount: 0, botCount: 0 }]
      : [];
  });
}

export function ConversationFilterPanel({
  filter,
  verdicts,
  reviewers,
  onChange,
}: ConversationFilterPanelProps) {
  const { t } = useTranslation();
  const chips = chipFacets(verdicts, filter);
  const humans = reviewers.filter((reviewer) => !reviewer.isBot);
  const bots = reviewers.filter((reviewer) => reviewer.isBot);
  const active = isFilterActive(filter);
  const allSelected = filter.reviewers.size === reviewers.length;

  return (
    <div
      aria-label={t("conversation.ariaLabelFilterPanel")}
      className={styles["body"]}
      data-testid="conversation-filter-panel"
      role="group"
    >
      {/* The chip list is rendered only when it HAS chips: an empty row
          reads as a lane of dead space promising controls it lacks. */}
      {chips.length > 0 ? (
        <div className={styles["row"]}>
          <span className={styles["rowLabel"]}>
            {t("conversation.filterVerdict")}
          </span>
          <ul className={styles["chips"]}>
            {chips.map((facet) => (
              <li key={facet.state}>
                <Chip
                  pressed={filter.verdicts.has(facet.state)}
                  onClick={() =>
                    onChange(withVerdictSelection(filter, facet.state))
                  }
                >
                  {VERDICT_LABEL[facet.state]}
                  <span className={styles["count"]}>{facet.humanCount}</span>
                  {facet.botCount > 0 ? (
                    <span className={rowStyles["botTag"]}>
                      {t("conversation.botCount", { count: facet.botCount })}
                    </span>
                  ) : null}
                  <ScreenReaderOnly>
                    {t("conversation.srFacetSummary", {
                      humanCount: facet.humanCount,
                      botCount: facet.botCount,
                    })}
                  </ScreenReaderOnly>
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reviewers.length > 0 ? (
        <div className={styles["row"]}>
          <span className={styles["rowLabel"]}>
            {t("conversation.filterReviewer")}
          </span>
          <ul className={styles["chips"]}>
            {humans.map((reviewer) => (
              <li key={reviewer.login}>
                <ReviewerChip
                  filter={filter}
                  reviewer={reviewer}
                  onChange={onChange}
                />
              </li>
            ))}
            {bots.length > 0 && humans.length > 0 ? (
              <li aria-hidden className={styles["divider"]} />
            ) : null}
            {bots.map((reviewer) => (
              <li key={reviewer.login}>
                <ReviewerChip
                  filter={filter}
                  reviewer={reviewer}
                  onChange={onChange}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The recency toggle sits OUTSIDE the chip gates, it governs the
          reviews the whole section reads. Quick actions are real buttons,
          not text links: these ACT on the view. */}
      <div className={styles["foot"]}>
        <Checkbox
          checked={filter.latestOnly}
          testId="conversation-filter-latest-only"
          onChange={(latestOnly) =>
            onChange(withLatestOnly(filter, latestOnly))
          }
        >
          {t("conversation.filterLatestOnly")}
        </Checkbox>
        <span className={styles["links"]}>
          {reviewers.length > 0 ? (
            <>
              <Button
                disabled={allSelected}
                size="sm"
                onClick={() => {
                  onChange(
                    withAllReviewers(
                      filter,
                      reviewers.map((reviewer) => reviewer.login),
                    ),
                  );
                }}
              >
                {t("conversation.filterAll")}
              </Button>
              <Button
                disabled={filter.reviewers.size === 0}
                size="sm"
                onClick={() => onChange(withNoReviewers(filter))}
              >
                {t("conversation.filterNone")}
              </Button>
            </>
          ) : null}
          <Button
            disabled={!active}
            size="sm"
            onClick={() => onChange(withNoFilters(filter))}
          >
            {t("conversation.filterClear")}
          </Button>
        </span>
      </div>
    </div>
  );
}

interface ReviewerChipProps {
  filter: ConversationFilter;
  reviewer: ReviewerFacet;
  onChange: (next: ConversationFilter) => void;
}

function ReviewerChip({ filter, reviewer, onChange }: ReviewerChipProps) {
  const { t } = useTranslation();
  return (
    <Chip
      className={styles["chip"]}
      data-bot={reviewer.isBot || undefined}
      pressed={filter.reviewers.has(reviewer.login)}
      onClick={() => onChange(withReviewerSelection(filter, reviewer.login))}
    >
      @{reviewer.login}
      {reviewer.isBot ? (
        <span className={rowStyles["botTag"]}>{t("conversation.botTag")}</span>
      ) : null}
      <ScreenReaderOnly>{t("conversation.srFiltersToAuthor")}</ScreenReaderOnly>
    </Chip>
  );
}
