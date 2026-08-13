import { useCallback, useEffect, useRef } from "react";

import {
  REVISION_JUMP_ATTR,
  revisionJumpSelector,
  type RevisionJumpTarget,
} from "../comparison/comparison";

/**
 * Revision-change navigation over the MODEL's target list. The DOM cannot
 * enumerate the rails anymore — windowed chunk lists only mount
 * viewport-adjacent cards, so `querySelectorAll` silently skips every rail
 * in an unmounted chunk. Mounted rails still supply the precision: the
 * reading-line anchor is measured, and a mounted target is scrolled to
 * directly; an unmounted one routes through the chunk jump and lands on the
 * rail once the card mounts.
 */
export interface RevisionNavigation {
  jumpNext: () => void;
  jumpPrev: () => void;
}

export interface UseRevisionNavigationInput {
  /** Every rail in rendered order (model-derived). */
  targets: readonly RevisionJumpTarget[];
  /** Rendered ordinal per chunk id — the coarse anchor when no rail is mounted. */
  chunkOrdinals: ReadonlyMap<string, number>;
  activeChunkId: string | null;
  /**
   * Scroll the windowed lists toward a chunk so its card mounts; false =
   * nowhere to go. Deliberately NOT the full chunk-jump pipeline: that arms
   * its own chunk-top settle-correction, which would race this hook's rail
   * landing and snap the viewport off the centered rail.
   */
  scrollTowardChunk: (chunkId: string) => boolean;
}

const RAIL_POLL_FRAMES = 90;

interface MountedRail {
  /** Index into the model target list. */
  index: number;
  top: number;
  element: HTMLButtonElement;
}

/**
 * Pick the next/prev model-target index. Mounted rails decide by measured
 * position against the reading line; with none decisive, `fallbackAnchor`
 * (from the active chunk's ordinal) stands in. Wraps at the ends. Pure for
 * unit tests — the DOM-coupled measurement happens in the caller.
 */
export function pickRevisionTargetIndex(input: {
  targetCount: number;
  mounted: readonly { index: number; top: number }[];
  direction: 1 | -1;
  readingLine: number;
  fallbackAnchor: number;
}): number | undefined {
  const { targetCount, mounted, direction, readingLine, fallbackAnchor } =
    input;
  if (targetCount === 0) return undefined;
  const last = targetCount - 1;
  if (direction === 1) {
    const below = mounted
      .filter((rail) => rail.top > readingLine + 1)
      .reduce<
        number | null
      >((min, rail) => (min === null || rail.index < min ? rail.index : min), null);
    if (below !== null) return below;
    const anchor = mounted
      .filter((rail) => rail.top <= readingLine + 1)
      .reduce<
        number | null
      >((max, rail) => (max === null || rail.index > max ? rail.index : max), null);
    const from = anchor ?? fallbackAnchor;
    return from >= last ? 0 : from + 1;
  }
  const above = mounted
    .filter((rail) => rail.top < readingLine - 1)
    .reduce<
      number | null
    >((max, rail) => (max === null || rail.index > max ? rail.index : max), null);
  if (above !== null) return above;
  const anchor = mounted
    .filter((rail) => rail.top >= readingLine - 1)
    .reduce<
      number | null
    >((min, rail) => (min === null || rail.index < min ? rail.index : min), null);
  const from = anchor ?? fallbackAnchor;
  return from <= 0 ? last : from - 1;
}

function landOnRail(element: HTMLButtonElement): void {
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.focus();
}

export function useRevisionNavigation(
  input: UseRevisionNavigationInput,
): RevisionNavigation {
  const { targets, chunkOrdinals, activeChunkId, scrollTowardChunk } = input;
  const pollFrameRef = useRef<number | null>(null);
  const cancelPoll = useCallback(() => {
    if (pollFrameRef.current !== null) {
      window.cancelAnimationFrame(pollFrameRef.current);
      pollFrameRef.current = null;
    }
  }, []);
  useEffect(() => cancelPoll, [cancelPoll]);

  const jump = useCallback(
    (direction: 1 | -1) => {
      cancelPoll();
      const keyToIndex = new Map(
        targets.map((target, index) => [target.railKey, index]),
      );
      // Hidden kept-warm trees keep their DOM — only visible rails count.
      const mounted: MountedRail[] = [
        ...document.querySelectorAll<HTMLButtonElement>(
          `main ${revisionJumpSelector()}`,
        ),
      ].flatMap((element) => {
        if (element.closest("[hidden]") !== null) return [];
        const index = keyToIndex.get(
          element.getAttribute(REVISION_JUMP_ATTR) ?? "",
        );
        if (index === undefined) return [];
        return [
          {
            index,
            top: element.getBoundingClientRect().top + window.scrollY,
            element,
          },
        ];
      });

      // Coarse anchor from the active chunk: the last target at or before it
      // in rendered order.
      const activeOrdinal =
        activeChunkId !== null ? (chunkOrdinals.get(activeChunkId) ?? -1) : -1;
      let fallbackAnchor = -1;
      if (activeOrdinal >= 0) {
        for (let i = 0; i < targets.length; i += 1) {
          const target = targets[i];
          if (target === undefined) continue;
          const ordinal = chunkOrdinals.get(target.chunkId) ?? -1;
          if (ordinal <= activeOrdinal) fallbackAnchor = i;
          else break;
        }
      }

      const targetIndex = pickRevisionTargetIndex({
        targetCount: targets.length,
        mounted,
        direction,
        readingLine: window.scrollY + 160,
        fallbackAnchor,
      });
      if (targetIndex === undefined) return;
      const target = targets[targetIndex];
      if (target === undefined) return;

      const alreadyMounted = mounted.find((rail) => rail.index === targetIndex);
      if (alreadyMounted) {
        landOnRail(alreadyMounted.element);
        return;
      }
      if (!scrollTowardChunk(target.chunkId)) return;
      let frames = 0;
      const poll = () => {
        pollFrameRef.current = null;
        const element = document.querySelector<HTMLButtonElement>(
          revisionJumpSelector(target.railKey),
        );
        if (element && element.closest("[hidden]") === null) {
          landOnRail(element);
          return;
        }
        frames += 1;
        if (frames >= RAIL_POLL_FRAMES) return;
        pollFrameRef.current = window.requestAnimationFrame(poll);
      };
      pollFrameRef.current = window.requestAnimationFrame(poll);
    },
    [activeChunkId, cancelPoll, chunkOrdinals, scrollTowardChunk, targets],
  );

  return {
    jumpNext: () => jump(1),
    jumpPrev: () => jump(-1),
  };
}
