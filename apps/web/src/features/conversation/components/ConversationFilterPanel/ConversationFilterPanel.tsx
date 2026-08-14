// The filter UI as anchored-panel CONTENT: two chip rows — verdict states
// with counts, per-reviewer — and a footer with the recency toggle and
// All/None/Clear. Chips are `aria-pressed` toggle buttons carrying TEXT, not
// color alone (WCAG 1.4.1).
//
// Selection is OR within a family, AND across; verdict counts are faceted;
// zero-count chips are unrendered unless selected (something must stay to
// unpress); All/None/Clear never disable UNDER the pointer that just used
// them — `aria-disabled` plus a no-op, keeping focus.
//
// The trigger, the hidden-thread receipt and the always-mounted live region
// belong to the disclosure wrapper: a region living here would unmount with
// the panel, which is exactly the insertion screen readers skip. Selection
// lives in the URL, so this component is pure props.
import { useTranslation } from "react-i18next";
import { Button } from "@web/components/Button/Button";
import { Chip } from "@web/components/Chip/Chip";
import { Checkbox } from "@web/components/Checkbox/Checkbox";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
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

/** Chip text — the digest's own verdict vocabulary. */
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
 * filter selects. Zero-count states drop out only while UNSELECTED — a
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
                    {` — ${facet.humanCount} from people, ${facet.botCount} from bots; filters the conversation`}
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

      {/* The recency toggle sits OUTSIDE the chip gates — it governs the
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
