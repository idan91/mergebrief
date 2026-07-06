// View/Compare controls for the DB brief route (BRIEF-19 4.1). The local
// route's controls live inside TimelineNavigator, which requires a local
// artifact timeline (deferred to BRIEF-21 for the DB path) — this bar drives
// the SAME normalized search-state helpers against the route's own params, so
// the two surfaces cannot drift semantically.
import {
  compareUnavailableTitle,
  isCompareAvailable,
  withCompare,
  withView,
  type BriefSearch,
  type CompareOptionFlags,
  type CompareParam,
  type ViewParam,
} from "../../brief/compareState";
import styles from "./DbCompareBar.module.scss";

export interface DbCompareBarProps {
  availability: CompareOptionFlags;
  compareState: BriefSearch;
  /** Route-owned navigation — receives the next normalized View/Compare state. */
  onNavigate: (next: BriefSearch) => void;
}

export function DbCompareBar({
  availability,
  compareState,
  onNavigate,
}: DbCompareBarProps) {
  const selectView = (view: ViewParam) =>
    onNavigate(withView(compareState, view, availability));
  const selectCompare = (compare: CompareParam) =>
    onNavigate(withCompare(compareState, compare, availability));

  const compareButton = (
    compare: "previous-brief" | "last-review",
    label: string,
  ) => {
    const available = isCompareAvailable(compare, availability);
    return (
      <button
        aria-pressed={compareState.compare === compare}
        data-state={compareState.compare === compare ? "active" : undefined}
        disabled={!available}
        onClick={() => selectCompare(compare)}
        title={available ? undefined : compareUnavailableTitle(compare)}
        type="button"
      >
        {label}
      </button>
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
          Full Brief
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
      <fieldset className={styles["group"]}>
        <legend className="sr-only">Compare</legend>
        {compareButton("last-review", "Your last review")}
        {compareButton("previous-brief", "Previous Brief")}
      </fieldset>
    </nav>
  );
}
