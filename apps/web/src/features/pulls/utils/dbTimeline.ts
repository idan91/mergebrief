// Timeline points represent brief heads; a Delta is a comparison.
// The selected revision's own base drives the brief GET because bases can drift.
import type { PrComparisons, RevisionSummary } from "../types";
import type { Mutable } from "types/utils";
import {
  buildRevisionTimeline,
  type RevisionPoint,
  type RevisionTimelineView,
} from "@web/features/brief/model";

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
   * True when a `?rev=` (or legacy `?head=`) was requested but is not a known
   * revision, the selection fell back to latest so a stale deep link renders
   * SOMETHING with a polite note, never a 404.
   */
  readonly degraded: boolean;
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

/** What the URL asked for: `rev` names a brief index, `head`/`base` a legacy span. */
export interface RevisionRequest {
  readonly rev?: number;
  readonly head?: string;
  readonly base?: string;
}

function findRequestedIndex(
  points: readonly DbTimelinePoint[],
  request: RevisionRequest,
): number {
  if (request.rev !== undefined) {
    return points.findIndex((point) => point.headIndex === request.rev);
  }
  if (request.head === undefined) {
    return -1;
  }
  if (request.base !== undefined) {
    const exact = points.findIndex(
      (point) =>
        point.headSha === request.head && point.baseSha === request.base,
    );
    if (exact !== -1) {
      return exact;
    }
  }
  return points.findLastIndex((point) => point.headSha === request.head);
}

/**
 * `rev` addresses a brief by its index and wins over a legacy span. A legacy
 * span prefers the exact base/head pair, then the highest-index matching
 * head, matching the backend. Anything unknown degrades to latest; absent
 * revisions return undefined.
 */
export function resolveDbTimeline(
  revisions: readonly RevisionSummary[] | undefined,
  request: RevisionRequest,
): DbTimelineSelection | undefined {
  if (revisions === undefined || revisions.length === 0) {
    return undefined;
  }
  // Stable sort: duplicate-head rows keep the server's (headIndex) order, so
  // findLastIndex above matches the backend's `at(-1)` pick.
  const points = revisions
    .map(toPoint)
    .toSorted((a, b) => a.headIndex - b.headIndex);
  const latestIndex = points.length - 1;
  const requested = request.rev !== undefined || request.head !== undefined;
  const requestedIndex = findRequestedIndex(points, request);
  const degraded = requested && requestedIndex === -1;
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
  };
}

/** A DB revision's key in the timeline: its brief index, which `rev` names. */
export function formatRevisionKey(point: DbTimelinePoint): string {
  return String(point.headIndex);
}

/** The DB route's rows; the selected revision is current, dated when known. */
export function buildRevisionTimelineViewFromDb(
  selection: DbTimelineSelection,
): RevisionTimelineView {
  const points = selection.points.map((point, position) => {
    const revision: RevisionPoint = {
      key: formatRevisionKey(point),
      ordinal: point.headIndex,
      headSha: point.headSha,
      current: position === selection.selectedIndex,
    };
    if (point.generatedAt !== undefined) {
      revision.at = point.generatedAt;
    }
    return revision;
  });
  return buildRevisionTimeline(points);
}

/** The revision a timeline row's key names; undefined for a stale key. */
export function findDbTimelinePoint(
  selection: DbTimelineSelection,
  key: string,
): DbTimelinePoint | undefined {
  return selection.points.find((point) => formatRevisionKey(point) === key);
}
