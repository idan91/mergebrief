// The DB-path Brief revision navigator over PR-meta's `revisions[]`. Unlike
// the local TimelineNavigator (a path param), this one drives the route's
// search params through `onSelect`.
//
// Selection identity is the POINT (its array position), never a head SHA
// alone — a retarget re-brief yields two revisions with the same head and
// different bases, so a SHA-keyed picker could not address both.
//
// A11y: the polite selection announcement and focus-to-heading are the
// ROUTE's job (one live region per page) — this component only emits the
// controls.
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import type { DbTimelinePoint } from "../../../../../utils/dbTimeline";
import styles from "./DbTimelineNavigator.module.scss";

export interface DbTimelineNavigatorProps {
  /** All points, ordered by `headIndex` ascending (latest last). */
  points: readonly DbTimelinePoint[];
  /** Position of the selected point within `points` — the selection identity. */
  selectedIndex: number;
  previous: DbTimelinePoint | undefined;
  next: DbTimelinePoint | undefined;
  /** Route-owned navigation — receives the selected revision point. */
  onSelect: (point: DbTimelinePoint) => void;
}

/** Rendered dots either side of the selected point (the "capped" stepper). */
const STEPPER_RADIUS = 4;

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function hasComparison(point: DbTimelinePoint): boolean {
  return (
    point.comparisons.previousBrief !== undefined ||
    point.comparisons.lastReview !== undefined
  );
}

/** `position:point` — unique per row even across duplicate heads. */
function pointKey(position: number, point: DbTimelinePoint): string {
  return `${String(position)}:${point.baseSha}:${point.headSha}`;
}

export function DbTimelineNavigator({
  points,
  selectedIndex,
  previous,
  next,
  onSelect,
}: DbTimelineNavigatorProps) {
  // Only a real timeline (more than one revision) earns a navigator.
  if (points.length < 2) return null;
  const stepperStart = Math.max(0, selectedIndex - STEPPER_RADIUS);
  const stepper = points.slice(
    stepperStart,
    selectedIndex + STEPPER_RADIUS + 1,
  );
  // Duplicate heads render identical "Revision N · sha" labels; suffix the
  // base so a retarget re-brief's two rows are tellable apart in the picker.
  const headCounts = new Map<string, number>();
  for (const point of points) {
    headCounts.set(point.headSha, (headCounts.get(point.headSha) ?? 0) + 1);
  }
  return (
    <nav aria-label="PR revision timeline" className={styles["timeline"]}>
      <button
        // Disabled state keeps a descriptive name — a bare arrow glyph is
        // meaningless to a screen reader.
        aria-label={
          previous
            ? `Previous revision, ${previous.headIndex}`
            : "Previous revision (none)"
        }
        className={styles["arrow"]}
        disabled={previous === undefined}
        onClick={() => previous && onSelect(previous)}
        type="button"
      >
        ←
      </button>
      <label className={styles["picker"]}>
        <ScreenReaderOnly>Select PR revision</ScreenReaderOnly>
        <select
          onChange={(event) => {
            const point = points[Number(event.target.value)];
            if (point !== undefined) onSelect(point);
          }}
          value={String(selectedIndex)}
        >
          {points.map((point, position) => (
            <option key={pointKey(position, point)} value={String(position)}>
              Revision {point.headIndex} · {shortSha(point.headSha)}
              {(headCounts.get(point.headSha) ?? 0) > 1
                ? ` (base ${shortSha(point.baseSha)})`
                : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        aria-label={
          next ? `Next revision, ${next.headIndex}` : "Next revision (none)"
        }
        className={styles["arrow"]}
        disabled={next === undefined}
        onClick={() => next && onSelect(next)}
        type="button"
      >
        →
      </button>
      <ol className={styles["steps"]}>
        {stepper.map((point, offset) => {
          const position = stepperStart + offset;
          const isSelected = position === selectedIndex;
          return (
            <li key={pointKey(position, point)}>
              <button
                aria-current={isSelected ? "step" : undefined}
                className={styles["step"]}
                data-comparable={hasComparison(point) ? "" : undefined}
                data-state={isSelected ? "active" : undefined}
                onClick={() => onSelect(point)}
                type="button"
              >
                <ScreenReaderOnly>Revision {point.headIndex}</ScreenReaderOnly>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
