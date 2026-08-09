// The DB-backed Brief revision timeline over PR-meta's `revisions[]`. Pure
// and framework-free so the whole resolution is unit-testable; the route
// wires a `?head=` search param through `resolveDbTimeline` to pick a point.
//
// Points navigate BRIEF heads only — a Delta is a lens, never a point.
// `baseSha` is per-entry and critical (base drifts across revisions), so the
// selected point's OWN base drives the brief GET — never the top-level
// view's.
import type { PrComparisons, RevisionSummary } from "../types";

export interface DbTimelinePoint {
  readonly headSha: string;
  /** This revision's OWN base — the brief GET is an exact (pr, base, head). */
  readonly baseSha: string;
  readonly headIndex: number;
  /** This revision's generation start — the conversation cutoff. */
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
   * True when a `?head=` was requested but is not a known revision — the
   * selection fell back to latest so a stale deep link renders SOMETHING with
   * a polite note, never a 404.
   */
  readonly degraded: boolean;
  readonly previous: DbTimelinePoint | undefined;
  readonly next: DbTimelinePoint | undefined;
}

function toPoint(revision: RevisionSummary): DbTimelinePoint {
  return {
    headSha: revision.headSha,
    baseSha: revision.baseSha,
    headIndex: revision.headIndex,
    ...(revision.generatedAt === undefined
      ? {}
      : { generatedAt: revision.generatedAt }),
    comparisons: revision.comparisons,
  };
}

/**
 * Resolve the browsable timeline and the selected point for a requested span.
 *
 * A head SHA is NOT unique in `revisions[]`: a retarget re-brief writes a
 * second row for the same head with a different base (the brief natural key
 * is `(pr, base, head)`). Selection identity is therefore the ARRAY POSITION
 * of a point, and resolution prefers span identity:
 *
 * - `undefined` return: no revisions (no brief yet) — the caller keeps its
 *   existing wait/empty flow, there is no head to select.
 * - head + base given → the exact `(base, head)` revision when one exists.
 * - bare head (or a base matching no row) → the HIGHEST-index row with that
 *   head — the same current-entry choice the backend's `at(-1)` makes for
 *   duplicate heads, so the two sides agree on which duplicate is "the" one.
 * - head unknown → latest, with `degraded: true` (the note case).
 * - nothing requested → latest (the default view).
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
  // so `selected` is defined — the guard is TypeScript narrowing only.
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
