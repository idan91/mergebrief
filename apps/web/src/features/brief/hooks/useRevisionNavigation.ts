import { useCallback, useEffect, useRef } from "react";

import {
  deriveRevisionJumpTargets,
  REVISION_JUMP_ATTR,
  revisionJumpSelector,
  type ComparisonMarkFiles,
} from "../comparison/comparison";
import type { BriefChunk } from "../types";

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
  /** Chunks in RENDERED order — targets and ordinals derive from this at
   * jump time (a gesture), so no per-render memo has to keep them cheap. */
  chunks: readonly BriefChunk[];
  /** The EFFECTIVE comparison marks (rails only render while they apply). */
  marks: ComparisonMarkFiles | null;
  /** Read at jump time (store `getState`) — a position change must never
   * re-render the host screen just to keep this hook current. */
  getActiveChunkId: () => string | null;
  /**
   * Scroll the windowed lists toward a chunk so its card mounts; false =
   * nowhere to go. Deliberately NOT the full chunk-jump pipeline: that arms
   * its own chunk-top settle-correction, which would race this hook's rail
   * landing and snap the viewport off the centered rail.
   */
  scrollTowardChunk: (chunkId: string) => boolean;
  /** Rails are row targets — rows only exist on an open card, so a jump
   * into a collapsed chunk must open it or the rail poll dies silently. */
  ensureChunkOpen: (chunkId: string) => void;
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
  const {
    chunks,
    marks,
    getActiveChunkId,
    scrollTowardChunk,
    ensureChunkOpen,
  } = input;
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
      // Gesture-time derivation: a jump is rare and the lists are small, so
      // deriving here beats keeping screen-level memos alive per render.
      const targets = deriveRevisionJumpTargets(chunks, marks);
      const chunkOrdinals = new Map(
        chunks.map((chunk, index) => [chunk.id, index]),
      );
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
      const activeChunkId = getActiveChunkId();
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
      ensureChunkOpen(target.chunkId);
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
    [
      cancelPoll,
      chunks,
      ensureChunkOpen,
      getActiveChunkId,
      marks,
      scrollTowardChunk,
    ],
  );

  return {
    jumpNext: () => jump(1),
    jumpPrev: () => jump(-1),
  };
}
