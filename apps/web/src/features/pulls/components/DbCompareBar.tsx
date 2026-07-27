// View/Compare controls for the DB brief route (BRIEF-19 4.1). The local
// route's controls live inside TimelineNavigator, which requires a local
// artifact timeline (deferred to BRIEF-24 for the DB path) — this bar drives
// the SAME normalized search-state helpers against the route's own params, so
// the two surfaces cannot drift semantically.
//
// Disabled Compare options stay FOCUSABLE (`aria-disabled`, not `disabled`)
// so their reason tooltip is keyboard-reachable: shown on hover/focus,
// referenced via `aria-describedby`, dismissible with Escape (BRIEF-21).
import { useState } from "react";
import {
  compareUnavailableTitle,
  isCompareAvailable,
  withCompare,
  withView,
  type BriefSearch,
  type CompareOptionFlags,
  type CompareParam,
  type ViewParam,
} from "../../brief/comparison/compareState";
import styles from "./DbCompareBar.module.scss";

export interface DbCompareBarProps {
  availability: CompareOptionFlags;
  compareState: BriefSearch;
  /**
   * Overrides the generic disabled title for "Your last review" with the
   * PR-meta reason copy (pending / baseline-unavailable). Only read when the
   * option is unavailable.
   */
  lastReviewDisabledReason?: string | undefined;
  /** Route-owned navigation — receives the next normalized View/Compare state. */
  onNavigate: (next: BriefSearch) => void;
}

export function DbCompareBar({
  availability,
  compareState,
  lastReviewDisabledReason,
  onNavigate,
}: DbCompareBarProps) {
  // Escape hides the focused option's tooltip until the pointer/focus leaves
  // (WAI-ARIA tooltip pattern); re-entry re-arms it.
  const [dismissedTip, setDismissedTip] = useState<CompareParam | null>(null);
  const selectView = (view: ViewParam) =>
    onNavigate(withView(compareState, view, availability));
  const selectCompare = (compare: CompareParam) =>
    onNavigate(withCompare(compareState, compare, availability));

  const compareButton = (
    compare: "previous-brief" | "last-review",
    label: string,
  ) => {
    const available = isCompareAvailable(compare, availability);
    if (available) {
      return (
        <button
          aria-pressed={compareState.compare === compare}
          data-state={compareState.compare === compare ? "active" : undefined}
          onClick={() => selectCompare(compare)}
          type="button"
        >
          {label}
        </button>
      );
    }
    const reason =
      (compare === "last-review" ? lastReviewDisabledReason : undefined) ??
      compareUnavailableTitle(compare);
    const tooltipId = `db-compare-${compare}-reason`;
    return (
      <span
        className={styles["tipAnchor"]}
        data-tip-dismissed={dismissedTip === compare ? "true" : undefined}
      >
        <button
          aria-describedby={tooltipId}
          aria-disabled="true"
          aria-pressed={false}
          className={styles["disabledOption"]}
          onBlur={() => setDismissedTip(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setDismissedTip(compare);
          }}
          onMouseLeave={() => setDismissedTip(null)}
          type="button"
        >
          {label}
        </button>
        <span className={styles["tip"]} id={tooltipId} role="tooltip">
          {reason}
        </span>
      </span>
    );
  };

  return (
    <nav aria-label="Brief view and compare" className={styles["bar"]}>
      <fieldset className={styles["group"]}>
        <legend className="sr-only">View</legend>
        <button
          aria-pressed={compareState.view === "full"}
          data-state={compareState.view === "full" ? "active" : undefined}
          onClick={() => selectView("full")}
          type="button"
        >
          Full brief
        </button>
        <button
          aria-pressed={compareState.view === "changes"}
          data-state={compareState.view === "changes" ? "active" : undefined}
          disabled={!availability.previousBrief && !availability.lastReview}
          onClick={() => selectView("changes")}
          type="button"
        >
          Changes Only
        </button>
      </fieldset>
      <fieldset className={styles["labeledGroup"]}>
        <legend className="sr-only">Compare</legend>
        {/* Outside the bordered group — inside it the label reads as a
            fourth (selectable) option. */}
        <span aria-hidden="true" className={styles["groupLabel"]}>
          Compare
        </span>
        <div className={styles["group"]}>
          {compareButton("last-review", "Your last review")}
          {compareButton("previous-brief", "Previous brief")}
          <button
            aria-pressed={compareState.compare === "off"}
            data-state={compareState.compare === "off" ? "active" : undefined}
            disabled={compareState.view === "changes"}
            onClick={() => selectCompare("off")}
            title={
              compareState.view === "changes"
                ? "Off is only available in Full brief"
                : undefined
            }
            type="button"
          >
            Off
          </button>
        </div>
      </fieldset>
    </nav>
  );
}
