import { Link, useNavigate } from "@tanstack/react-router";

import type { BriefTimeline } from "../../timeline";
import styles from "./TimelineNavigator.module.scss";

export interface TimelineNavigatorProps {
  briefId: string;
  timeline: BriefTimeline;
}

export function TimelineNavigator({
  briefId,
  timeline,
}: TimelineNavigatorProps) {
  const navigate = useNavigate();
  const selected = timeline.selectedPoint;
  const currentIndex = selected
    ? timeline.points.findIndex((point) => point.briefId === selected.briefId)
    : -1;
  const previous =
    currentIndex > 0 ? timeline.points[currentIndex - 1] : undefined;
  const next =
    currentIndex >= 0 ? timeline.points[currentIndex + 1] : undefined;
  const deltaId = selected?.deltaId;

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
        <span className="sr-only">Select PR revision</span>
        <select
          value={selected.briefId}
          onChange={(event) =>
            navigate({
              to: "/briefs/$briefId",
              params: { briefId: event.target.value },
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
      <div className={styles["lens"]} role="group" aria-label="Brief lens">
        <Link
          data-state={briefId === selected.briefId ? "active" : undefined}
          params={{ briefId: selected.briefId }}
          to="/briefs/$briefId"
        >
          Full
        </Link>
        {deltaId ? (
          <Link
            data-state={briefId === deltaId ? "active" : undefined}
            params={{ briefId: deltaId }}
            to="/briefs/$briefId"
          >
            Delta
          </Link>
        ) : (
          <span
            aria-disabled="true"
            title="No local delta is available for this revision"
          >
            Delta
          </span>
        )}
      </div>
      <ol className={styles["steps"]}>
        {timeline.points
          .slice(Math.max(0, currentIndex - 4), currentIndex + 5)
          .map((point) => (
            <li key={point.briefId}>
              <Link
                aria-current={
                  point.briefId === selected.briefId ? "step" : undefined
                }
                data-delta={point.deltaId ? "" : undefined}
                data-state={
                  point.briefId === selected.briefId ? "active" : undefined
                }
                params={{ briefId: point.briefId }}
                to="/briefs/$briefId"
              >
                <span className="sr-only">Brief {point.index}</span>
              </Link>
            </li>
          ))}
      </ol>
    </nav>
  );
}
