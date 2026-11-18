import { useCallback, useEffect, useRef } from "react";

import {
  ScrollMotions,
  ScrollPlacements,
} from "../components/BriefView/scroll-to-target/engine/types";
import { ROW_SCROLL_BAND_SHARE } from "../components/BriefView/scroll-to-target/engine/consts";
import type { ScrollReading } from "../components/BriefView/scroll-to-target/engine/types";
import { readScrollState } from "../components/BriefView/scroll-to-target/targets";
import {
  ScrollHistories,
  ScrollTargetKinds,
  type ScrollTargetOptions,
  type ScrollToTarget,
} from "../components/BriefView/scroll-to-target/types";
import {
  deriveRevisionJumpTargets,
  REVISION_JUMP_ATTR,
  revisionJumpSelector,
  type ComparisonMarkFiles,
} from "../../model/comparison/runs";
import type { BriefChunk } from "../../model/types";

/**
 * Revision-change navigation over the MODEL's target list. The DOM cannot
 * enumerate the rails anymore, windowed chunk lists only mount
 * viewport-adjacent cards, so `querySelectorAll` silently skips every rail
 * in an unmounted chunk. Mounted rails still supply the precision: the
 * reading-line anchor is measured. The scroll to target goes to a mounted rail
 * directly and routes an unmounted one through the chunk windows.
 */
export interface RevisionNavigation {
  jumpNext: () => RevisionStep | undefined;
  jumpPrev: () => RevisionStep | undefined;
}

/** One stepper move: the model target it lands on, and whether it wrapped. */
export interface RevisionStep {
  index: number;
  wrapped: boolean;
}

/**
 * The reading band's upper half in document coordinates, where a landed rail
 * rests: from the pinned stack's bottom down to the band's middle.
 */
export interface ReadingBand {
  top: number;
  middle: number;
  /** The viewport's bottom edge: a landed rail above it is still on screen. */
  bottom: number;
}

export interface UseRevisionNavigationInput {
  /** Chunks in RENDERED order; targets and ordinals derive from this at
   * jump time (a gesture), so no per-render memo has to keep them cheap. */
  chunks: readonly BriefChunk[];
  /** The EFFECTIVE comparison marks (rails only render while they apply). */
  marks: ComparisonMarkFiles | null;
  /** Read at jump time (store `getState`): a position change must never
   * re-render the host screen just to keep this hook current. */
  getActiveChunkId: () => string | null;
  /** The page's one scroll to target; never a chunk jump, whose card line would pull the rail off center. */
  scrollToTarget: ScrollToTarget["scrollToTarget"];
}

/** Rails are row targets: their card opens, and the button takes focus. */
const RAIL_SCROLL: ScrollTargetOptions = {
  motion: ScrollMotions.SMOOTH,
  history: ScrollHistories.NONE,
  open: true,
  focus: true,
  placement: ScrollPlacements.READING_BAND,
};

interface MountedRail {
  /** Index into the model target list. */
  index: number;
  top: number;
}

interface RevisionStepInput {
  targetCount: number;
  mounted: readonly MountedRail[];
  direction: 1 | -1;
  band: ReadingBand;
  /** The last step's target; it stays current while its rail is on screen. */
  landedIndex?: number | undefined;
  /** From the active chunk's ordinal; stands in when no mounted rail decides. */
  fallbackAnchor: number;
}

const BAND_EDGE_TOLERANCE_PX = 1;

function findEdgeIndex(
  rails: readonly MountedRail[],
  lowest: boolean,
): number | undefined {
  if (rails.length === 0) {
    return undefined;
  }
  const indexes = rails.map((rail) => rail.index);

  return lowest ? Math.min(...indexes) : Math.max(...indexes);
}

function isRailBetween(
  rail: MountedRail,
  upper: number,
  lower: number,
): boolean {
  const belowUpper = rail.top >= upper - BAND_EDGE_TOLERANCE_PX;
  const aboveLower = rail.top <= lower + BAND_EDGE_TOLERANCE_PX;
  const between = belowUpper && aboveLower;
  return between;
}

function compareRestingDistance(
  left: MountedRail,
  right: MountedRail,
  restingLine: number,
): number {
  const distance =
    Math.abs(left.top - restingLine) - Math.abs(right.top - restingLine);
  if (distance !== 0) {
    return distance;
  }
  const indexOrder = left.index - right.index;
  return indexOrder;
}

/** The rail in the band nearest where a landed rail rests, lower index on a tie. */
function findRailInBand(
  rails: readonly MountedRail[],
  band: ReadingBand,
): MountedRail | undefined {
  const restingLine =
    band.top + (band.middle - band.top) * 2 * ROW_SCROLL_BAND_SHARE;
  const inBand = rails.filter((rail) =>
    isRailBetween(rail, band.top, band.middle),
  );

  const nearestFirst = inBand.toSorted((left, right) =>
    compareRestingDistance(left, right, restingLine),
  );

  return nearestFirst[0];
}

/**
 * The rail the last step landed on, while it is mounted and on screen. The
 * engine can leave it anywhere readable, or below the band at max scroll, so
 * position alone can name a neighbour; a manual scroll away drops it.
 */
function findLandedRail(
  rails: readonly MountedRail[],
  band: ReadingBand,
  landedIndex: number | undefined,
): MountedRail | undefined {
  const landed = rails.find((rail) => rail.index === landedIndex);
  if (landed === undefined) {
    return undefined;
  }
  return isRailBetween(landed, band.top, band.bottom) ? landed : undefined;
}

function stepFrom(from: number, direction: 1 | -1, last: number): RevisionStep {
  if (direction === 1) {
    return from >= last
      ? { index: 0, wrapped: true }
      : { index: from + 1, wrapped: false };
  }

  return from <= 0
    ? { index: last, wrapped: true }
    : { index: from - 1, wrapped: false };
}

/**
 * Pick the next or previous model target. The rail the last step landed on,
 * else a mounted rail resting in the reading band, is the current change, and
 * the step goes by index from it.
 * Otherwise mounted rails decide by position against the band, then
 * `fallbackAnchor`. Wraps at the ends. Pure; the caller measures the DOM.
 */
export function pickRevisionStep(
  input: RevisionStepInput,
): RevisionStep | undefined {
  const { targetCount, mounted, direction, band, landedIndex, fallbackAnchor } =
    input;
  if (targetCount === 0) {
    return undefined;
  }
  const last = targetCount - 1;

  const landed = findLandedRail(mounted, band, landedIndex);
  const current = landed ?? findRailInBand(mounted, band);
  if (current !== undefined) {
    return stepFrom(current.index, direction, last);
  }

  const upperEdge = band.top - BAND_EDGE_TOLERANCE_PX;
  const lowerEdge = band.middle + BAND_EDGE_TOLERANCE_PX;
  const above = mounted.filter((rail) => rail.top < upperEdge);
  const below = mounted.filter((rail) => rail.top > lowerEdge);
  const forward = direction === 1;
  const ahead = findEdgeIndex(forward ? below : above, forward);
  if (ahead !== undefined) {
    return { index: ahead, wrapped: false };
  }
  const behind = findEdgeIndex(forward ? above : below, !forward);

  return stepFrom(behind ?? fallbackAnchor, direction, last);
}

function deriveReadingBand(reading: ScrollReading): ReadingBand {
  const top = reading.scrollY + reading.stackHeight;
  const bandHeight = reading.viewportHeight - reading.stackHeight;
  const middle = top + bandHeight / 2;
  const bottom = reading.scrollY + reading.viewportHeight;

  return { top, middle, bottom };
}

export function useRevisionNavigation(
  input: UseRevisionNavigationInput,
): RevisionNavigation {
  const { chunks, marks, getActiveChunkId, scrollToTarget } = input;
  const lastStepIndex = useRef<number | undefined>(undefined);
  useEffect(() => {
    lastStepIndex.current = undefined;
  }, [chunks, marks]);

  const jump = useCallback(
    (direction: 1 | -1) => {
      // Gesture-time derivation: a jump is rare and the lists are small, so
      // deriving here beats keeping screen-level memos alive per render.
      const targets = deriveRevisionJumpTargets(chunks, marks);
      const chunkOrdinals = new Map(
        chunks.map((chunk, index) => [chunk.id, index]),
      );
      const keyToIndex = new Map(
        targets.map((target, index) => [target.railKey, index]),
      );
      // Hidden kept-warm trees keep their DOM; only visible rails count.
      const mounted: MountedRail[] = [
        ...document.querySelectorAll<HTMLButtonElement>(
          `main ${revisionJumpSelector()}`,
        ),
      ].flatMap((element) => {
        if (element.closest("[hidden]") !== null) {
          return [];
        }
        const index = keyToIndex.get(
          element.getAttribute(REVISION_JUMP_ATTR) ?? "",
        );
        if (index === undefined) {
          return [];
        }
        return [
          {
            index,
            top: element.getBoundingClientRect().top + window.scrollY,
          },
        ];
      });

      // Coarse anchor from the active chunk: the last target at or before it
      // in rendered order.
      const activeChunkId = getActiveChunkId();
      const activeOrdinal =
        activeChunkId !== null ? (chunkOrdinals.get(activeChunkId) ?? -1) : -1;
      let fallbackAnchor = -1;
      if (activeOrdinal >= 0) {
        for (let i = 0; i < targets.length; i += 1) {
          const target = targets[i];
          if (target === undefined) {
            continue;
          }
          const ordinal = chunkOrdinals.get(target.chunkId) ?? -1;
          if (ordinal <= activeOrdinal) {
            fallbackAnchor = i;
          } else {
            break;
          }
        }
      }

      const reading = readScrollState(undefined, ScrollTargetKinds.RAIL);
      const step = pickRevisionStep({
        targetCount: targets.length,
        mounted,
        direction,
        band: deriveReadingBand(reading),
        landedIndex: lastStepIndex.current,
        fallbackAnchor,
      });
      lastStepIndex.current = step?.index;
      if (step === undefined) {
        return undefined;
      }
      const target = targets[step.index];
      if (target === undefined) {
        return undefined;
      }

      scrollToTarget(
        {
          kind: ScrollTargetKinds.RAIL,
          chunkId: target.chunkId,
          railKey: target.railKey,
        },
        RAIL_SCROLL,
      );
      return step;
    },
    [chunks, getActiveChunkId, scrollToTarget, marks],
  );

  return {
    jumpNext: () => jump(1),
    jumpPrev: () => jump(-1),
  };
}
