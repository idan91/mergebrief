import type {
  RevisionPoint,
  RevisionRow,
  RevisionTimelineView,
} from "../types";
import { getShortSha } from "./short-sha";
import type { BriefTimeline } from "./timeline";

/**
 * Rows newest first from points in ascending order. The last point is the
 * newest whichever one is current.
 */
export function buildRevisionTimeline(
  points: readonly RevisionPoint[],
): RevisionTimelineView {
  const newestPosition = points.length - 1;
  const rows = points.map((point, position) => {
    const row: RevisionRow = {
      key: point.key,
      ordinal: point.ordinal,
      shortSha: getShortSha(point.headSha),
      current: point.current,
      newest: position === newestPosition,
    };
    if (point.at !== undefined) {
      row.at = point.at;
    }
    return row;
  });
  return { rows: rows.toReversed() };
}

/**
 * The local route's rows, keyed by brief id. A delta artifact's head already
 * resolved to its brief in `selectedPoint`, so that brief reads as current.
 */
export function buildRevisionTimelineView(
  timeline: BriefTimeline,
): RevisionTimelineView {
  const selectedId = timeline.selectedPoint?.briefId;
  const points = timeline.points.map(
    (point): RevisionPoint => ({
      key: point.briefId,
      ordinal: point.index,
      headSha: point.headSha,
      current: point.briefId === selectedId,
    }),
  );
  return buildRevisionTimeline(points);
}
