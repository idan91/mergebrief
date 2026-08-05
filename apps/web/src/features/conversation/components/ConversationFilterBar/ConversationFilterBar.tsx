// The conversation filter bar (BRIEF-99): who reviewed this, and what did
// they say? Two rows — verdict-state chips with counts on top, per-reviewer
// chips below — plus the recency toggle. Chips are `aria-pressed` toggle
// buttons carrying TEXT (WCAG 1.4.1), the same vocabulary the digest's own
// chips use.
//
// It sits ABOVE the conversation section, not inside it: the section is a
// collapsed-by-default disclosure, and a filter buried inside one is a
// control nobody finds. It also governs the diff's inline threads, which are
// visible whether or not the section is open — so the state it reports has
// to be readable from the same place.
//
// Selection lives in the URL, so this component is pure props: it renders
// the facets it is handed and reports the next filter state.
//
// Controls never disappear or disable UNDER the pointer that just used them:
// All/None/Clear stay enabled and no-op at their limits, and the status line
// is always mounted. A control that unmounts on click drops keyboard focus to
// <body>, and a live region inserted already-populated is exactly the
// announcement screen readers skip.
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
import styles from "./ConversationFilterBar.module.scss";

export interface ConversationFilterBarProps {
  filter: ConversationFilter;
  verdicts: readonly VerdictFacet[];
  reviewers: readonly ReviewerFacet[];
  /**
   * Threads the filter removes from the DIFF (BRIEF-99 decision 9) — an
   * unannounced gap inline reads as "nothing was said about this line".
   * Counted by `countHiddenInlineThreads` at the call site.
   */
  hiddenInlineThreads: number;
  onChange: (next: ConversationFilter) => void;
}

/** Chip text — the digest's own verdict vocabulary (ADR 0027). */
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
 * filter selects. Decision 5's "zero-count states render no chip" governs
 * UNSELECTED states — a selected chip that vanishes when the reviewer
 * selection empties its count would leave an active filter with nothing to
 * unpress.
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

export function ConversationFilterBar({
  filter,
  verdicts,
  reviewers,
  hiddenInlineThreads,
  onChange,
}: ConversationFilterBarProps) {
  const chips = chipFacets(verdicts, filter);
  const humans = reviewers.filter((reviewer) => !reviewer.isBot);
  const bots = reviewers.filter((reviewer) => reviewer.isBot);
  const active = isFilterActive(filter);
  const allSelected = filter.reviewers.size === reviewers.length;

  // Nothing to slice and nothing sliced: a bordered empty strip above "No
  // conversation yet" is chrome promising a control it does not have.
  if (chips.length === 0 && reviewers.length === 0 && !active) return null;

  return (
    <div
      aria-label="Filter the conversation"
      className={styles["bar"]}
      data-testid="conversation-filter-bar"
      role="group"
    >
      <div className={styles["row"]}>
        <span className={styles["rowLabel"]}>Verdict</span>
        {/* The chip list is rendered only when it HAS chips: an empty <ul>
            plus a trailing control reads as a lane of dead space with one
            control marooned at the far edge. */}
        {chips.length > 0 ? (
          <ul className={styles["chips"]}>
            {chips.map((facet) => (
              <li key={facet.state}>
                <button
                  aria-pressed={filter.verdicts.has(facet.state)}
                  className={styles["chip"]}
                  type="button"
                  onClick={() =>
                    onChange(withVerdictSelection(filter, facet.state))
                  }
                >
                  {VERDICT_LABEL[facet.state]}
                  <span className={styles["count"]}>{facet.humanCount}</span>
                  {facet.botCount > 0 ? (
                    <span className={rowStyles["botTag"]}>
                      {facet.botCount} bot
                    </span>
                  ) : null}
                  <ScreenReaderOnly>
                    {` — ${facet.humanCount} from people, ${facet.botCount} from bots; filters the conversation`}
                  </ScreenReaderOnly>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {/* Global control, deliberately OUTSIDE the chip gate: it governs the
            reviews the whole section reads, so a reviewer selection that
            empties the chip row must not strand it. */}
        <span className={styles["trailing"]}>
          <Checkbox
            checked={filter.latestOnly}
            testId="conversation-filter-latest-only"
            onChange={(latestOnly) =>
              onChange(withLatestOnly(filter, latestOnly))
            }
          >
            Only each reviewer&apos;s latest
          </Checkbox>
        </span>
      </div>

      {reviewers.length > 0 ? (
        <div className={styles["row"]}>
          <span className={styles["rowLabel"]}>Reviewer</span>
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
          {/* Real buttons (the repo's `.btn`, compact variant), not text
              links: these ACT on the view, and a bare label reads as
              navigation. All / None / Clear share one trailing group — a
              dedicated footer row for Clear would sit empty most of the
              time. */}
          <span className={styles["trailing"]}>
            <span className={styles["links"]}>
              <button
                aria-disabled={allSelected}
                className="btn compact"
                type="button"
                onClick={() => {
                  if (allSelected) return;
                  onChange(
                    withAllReviewers(
                      filter,
                      reviewers.map((reviewer) => reviewer.login),
                    ),
                  );
                }}
              >
                All
              </button>
              <button
                aria-disabled={filter.reviewers.size === 0}
                className="btn compact"
                type="button"
                onClick={() => {
                  if (filter.reviewers.size === 0) return;
                  onChange(withNoReviewers(filter));
                }}
              >
                None
              </button>
              <button
                aria-disabled={!active}
                className="btn compact"
                type="button"
                onClick={() => {
                  if (!active) return;
                  onChange(withNoFilters(filter));
                }}
              >
                Clear filters
              </button>
            </span>
          </span>
        </div>
      ) : null}

      {/* Always mounted (and empty rather than absent when inactive), so the
          first "N threads hidden" lands as an UPDATE to a live region instead
          of the insertion screen readers skip. It carries no controls: a
          button label has no business riding along in every announcement. */}
      <p className={styles["status"]} role="status">
        {active && hiddenInlineThreads > 0
          ? `${hiddenInlineThreads} thread${
              hiddenInlineThreads === 1 ? "" : "s"
            } hidden in the diff`
          : ""}
      </p>
    </div>
  );
}

interface ReviewerChipProps {
  filter: ConversationFilter;
  reviewer: ReviewerFacet;
  onChange: (next: ConversationFilter) => void;
}

function ReviewerChip({ filter, reviewer, onChange }: ReviewerChipProps) {
  return (
    <button
      aria-pressed={filter.reviewers.has(reviewer.login)}
      className={styles["chip"]}
      data-bot={reviewer.isBot || undefined}
      type="button"
      onClick={() => onChange(withReviewerSelection(filter, reviewer.login))}
    >
      @{reviewer.login}
      {reviewer.isBot ? <span className={rowStyles["botTag"]}>bot</span> : null}
      <ScreenReaderOnly>
        {" — filters the conversation to this author"}
      </ScreenReaderOnly>
    </button>
  );
}
