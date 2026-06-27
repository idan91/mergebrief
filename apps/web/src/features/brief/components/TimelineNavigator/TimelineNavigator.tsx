import { Link, useNavigate } from "@tanstack/react-router";

import type { BriefTimeline } from "../../timeline";

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
    <nav className="timeline" aria-label="PR revision timeline">
      <span aria-live="polite" className="sr-only">
        Viewing Brief {selected.index} of {timeline.points.length}
      </span>
      {previous ? (
        <Link
          aria-label={`Previous brief, ${previous.index}`}
          className="timeline-arrow"
          params={{ briefId: previous.briefId }}
          to="/briefs/$briefId"
        >
          ←
        </Link>
      ) : (
        <span aria-hidden="true" className="timeline-arrow disabled">
          ←
        </span>
      )}
      <label className="timeline-picker">
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
          className="timeline-arrow"
          params={{ briefId: next.briefId }}
          to="/briefs/$briefId"
        >
          →
        </Link>
      ) : (
        <span aria-hidden="true" className="timeline-arrow disabled">
          →
        </span>
      )}
      <div className="timeline-lens" role="group" aria-label="Brief lens">
        <Link
          className={briefId === selected.briefId ? "active" : ""}
          params={{ briefId: selected.briefId }}
          to="/briefs/$briefId"
        >
          Full
        </Link>
        {deltaId ? (
          <Link
            className={briefId === deltaId ? "active" : ""}
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
      <ol className="timeline-steps">
        {timeline.points
          .slice(Math.max(0, currentIndex - 4), currentIndex + 5)
          .map((point) => (
            <li key={point.briefId}>
              <Link
                aria-current={
                  point.briefId === selected.briefId ? "step" : undefined
                }
                className={
                  point.briefId === selected.briefId
                    ? "active"
                    : point.deltaId
                      ? "has-delta"
                      : ""
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
