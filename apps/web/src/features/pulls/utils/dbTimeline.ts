// Timeline points represent brief heads; a Delta is a comparison lens.
// The selected revision's own base drives the brief GET because bases can drift.
import type { PrComparisons, RevisionSummary } from "../types";
import type { Mutable } from "types";

export interface DbTimelinePoint {
  readonly headSha: string;
  /** This revision's OWN base, the brief GET is an exact (pr, base, head). */
  readonly baseSha: string;
  readonly headIndex: number;
  /** This revision's generation start, the conversation cutoff. */
  readonly generatedAt?: string;
  readonly comparisons: PrComparisons;
}

export interface DbTimelineSelection {
  /** All browsable points, ordered by `headIndex` ascending (latest last). */
  readonly points: readonly DbTimelinePoint[];
  readonly selected: DbTimelinePoint;
  /** Index of `selected` within `points`. */
  readonly selectedIndex: number;
  /**
   * True when a `?head=` was requested but is not a known revision, the
   * selection fell back to latest so a stale deep link renders SOMETHING with
   * a polite note, never a 404.
   */
  readonly degraded: boolean;
  readonly previous: DbTimelinePoint | undefined;
  readonly next: DbTimelinePoint | undefined;
}

function toPoint(revision: RevisionSummary): DbTimelinePoint {
  const point: Mutable<DbTimelinePoint> = {
    headSha: revision.headSha,
    baseSha: revision.baseSha,
    headIndex: revision.headIndex,
    comparisons: revision.comparisons,
  };

  if (revision.generatedAt !== undefined) {
    point.generatedAt = revision.generatedAt;
  }

  return point;
}

/**
 * Retargeting can produce multiple revisions for one head; identity is array position.
 * Prefer an exact base/head span, then the highest-index matching head, matching the backend.
 * Unknown heads degrade to latest; absent revisions return undefined.
 */
export function resolveDbTimeline(
  revisions: readonly RevisionSummary[] | undefined,
  requestedHead: string | undefined,
  requestedBase?: string,
): DbTimelineSelection | undefined {
  if (revisions === undefined || revisions.length === 0) {
    return undefined;
  }
  // Stable sort: duplicate-head rows keep the server's (headIndex) order, so
  // findLastIndex below matches the backend's `at(-1)` pick.
  const points = revisions
    .map(toPoint)
    .toSorted((a, b) => a.headIndex - b.headIndex);
  const latestIndex = points.length - 1;
  let requestedIndex = -1;
  if (requestedHead !== undefined) {
    if (requestedBase !== undefined) {
      requestedIndex = points.findIndex(
        (point) =>
          point.headSha === requestedHead && point.baseSha === requestedBase,
      );
    }
    if (requestedIndex === -1) {
      requestedIndex = points.findLastIndex(
        (point) => point.headSha === requestedHead,
      );
    }
  }
  const degraded = requestedHead !== undefined && requestedIndex === -1;
  const selectedIndex = requestedIndex === -1 ? latestIndex : requestedIndex;
  const selected = points[selectedIndex];
  // `selectedIndex` is always in range (findIndex hit, or the clamped latest),
  // so `selected` is defined, the guard is TypeScript narrowing only.
  if (selected === undefined) {
    return undefined;
  }
  return {
    points,
    selected,
    selectedIndex,
    degraded,
    previous: selectedIndex > 0 ? points[selectedIndex - 1] : undefined,
    next: selectedIndex < latestIndex ? points[selectedIndex + 1] : undefined,
  };
}
