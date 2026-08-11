import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "@tanstack/react-router";

import {
  compareUnavailableTitle,
  isCompareAvailable,
  withCompare,
  withView,
  type BriefSearch,
  type CompareParam,
  type CompareOptionFlags,
  type ViewParam,
} from "../../../../comparison/compareState";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import type { BriefTimeline } from "../../../../utils/timeline";
import styles from "./TimelineNavigator.module.scss";

export interface TimelineNavigatorProps {
  /** Compare availability at the selected timeline point. */
  availability: CompareOptionFlags;
  briefId: string;
  /** Resolved, normalized View/Compare state. */
  compareState: BriefSearch;
  timeline: BriefTimeline;
}

/**
 * Timeline points navigate Brief heads only. The View and Compare controls
 * write canonical `view`/`compare` search params, always through
 * `withView`/`withCompare` so the URL only ever holds a normalized, valid
 * combination. Previous/Next/select preserve the current search verbatim —
 * the choice sticks across timeline navigation and re-normalizes against the
 * newly selected point's own availability.
 */
export function TimelineNavigator({
  availability,
  briefId,
  compareState,
  timeline,
}: TimelineNavigatorProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selected = timeline.selectedPoint;
  const currentIndex = selected
    ? timeline.points.findIndex((point) => point.briefId === selected.briefId)
    : -1;
  const previous =
    currentIndex > 0 ? timeline.points[currentIndex - 1] : undefined;
  const next =
    currentIndex >= 0 ? timeline.points[currentIndex + 1] : undefined;

  const selectView = (view: ViewParam) =>
    navigate({
      to: "/briefs/$briefId",
      params: { briefId },
      search: withView(compareState, view, availability),
    });
  const selectCompare = (compare: CompareParam) =>
    navigate({
      to: "/briefs/$briefId",
      params: { briefId },
      search: withCompare(compareState, compare, availability),
    });

  if (!selected) return null;
  return (
    <nav className={styles["timeline"]} aria-label="PR revision timeline">
      <span aria-live="polite" className="sr-only">
        Viewing Brief {selected.index} of {timeline.points.length}
      </span>
      {previous ? (
        <Link
          aria-label={`Previous brief, ${previous.index}`}
          className={styles["arrow"]}
          params={{ briefId: previous.briefId }}
          search={(prev) => prev}
          to="/briefs/$briefId"
        >
          ←
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={styles["arrow"]}
          data-state="disabled"
        >
          ←
        </span>
      )}
      <label>
        <ScreenReaderOnly>Select PR revision</ScreenReaderOnly>
        <select
          value={selected.briefId}
          onChange={(event) =>
            navigate({
              to: "/briefs/$briefId",
              params: { briefId: event.target.value },
              search: (prev) => prev,
            })
          }
        >
          {timeline.points.map((point) => (
            <option key={point.briefId} value={point.briefId}>
              Brief {point.index} · {point.headSha.slice(0, 7)}
            </option>
          ))}
        </select>
      </label>
      {next ? (
        <Link
          aria-label={`Next brief, ${next.index}`}
          className={styles["arrow"]}
          params={{ briefId: next.briefId }}
          search={(prev) => prev}
          to="/briefs/$briefId"
        >
          →
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={styles["arrow"]}
          data-state="disabled"
        >
          →
        </span>
      )}
      <ol className={styles["steps"]}>
        {timeline.points
          .slice(Math.max(0, currentIndex - 4), currentIndex + 5)
          .map((point) => (
            <li key={point.briefId}>
              <Link
                aria-current={
                  point.briefId === selected.briefId ? "step" : undefined
                }
                data-comparable={
                  point.comparisons.previousBrief ||
                  point.comparisons.lastReview
                    ? ""
                    : undefined
                }
                data-state={
                  point.briefId === selected.briefId ? "active" : undefined
                }
                params={{ briefId: point.briefId }}
                search={(prev) => prev}
                to="/briefs/$briefId"
              >
                <ScreenReaderOnly>Brief {point.index}</ScreenReaderOnly>
              </Link>
            </li>
          ))}
      </ol>
      <fieldset className={styles["lens"]}>
        <ScreenReaderOnly as="legend">View</ScreenReaderOnly>
        <button
          aria-pressed={compareState.view === "full"}
          data-state={compareState.view === "full" ? "active" : undefined}
          data-testid="view-full"
          type="button"
          onClick={() => selectView("full")}
        >
          Full brief
        </button>
        <button
          aria-pressed={compareState.view === "changes"}
          data-state={compareState.view === "changes" ? "active" : undefined}
          data-testid="view-changes"
          type="button"
          onClick={() => selectView("changes")}
        >
          Changes Only
        </button>
      </fieldset>
      <fieldset className={styles["labeledLens"]}>
        <ScreenReaderOnly as="legend">Compare</ScreenReaderOnly>
        {/* Outside the bordered group — inside it the label reads as a
            fourth (selectable) option. */}
        <span aria-hidden="true" className={styles["lensLabel"]}>
          Compare
        </span>
        <div className={styles["lens"]}>
          <button
            aria-pressed={compareState.compare === "last-review"}
            data-state={
              compareState.compare === "last-review" ? "active" : undefined
            }
            disabled={!isCompareAvailable("last-review", availability)}
            title={
              isCompareAvailable("last-review", availability)
                ? undefined
                : compareUnavailableTitle(t, "last-review")
            }
            type="button"
            onClick={() => selectCompare("last-review")}
          >
            Your last review
          </button>
          <button
            aria-pressed={compareState.compare === "previous-brief"}
            data-state={
              compareState.compare === "previous-brief" ? "active" : undefined
            }
            disabled={!isCompareAvailable("previous-brief", availability)}
            title={
              isCompareAvailable("previous-brief", availability)
                ? undefined
                : compareUnavailableTitle(t, "previous-brief")
            }
            type="button"
            onClick={() => selectCompare("previous-brief")}
          >
            Previous brief
          </button>
          <button
            aria-pressed={compareState.compare === "off"}
            data-state={compareState.compare === "off" ? "active" : undefined}
            disabled={compareState.view === "changes"}
            title={
              compareState.view === "changes"
                ? "Off is only available in Full brief"
                : undefined
            }
            type="button"
            onClick={() => selectCompare("off")}
          >
            Off
          </button>
        </div>
      </fieldset>
    </nav>
  );
}
