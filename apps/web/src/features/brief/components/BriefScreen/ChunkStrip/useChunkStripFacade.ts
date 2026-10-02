import {
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import type { BriefChunk } from "../../../types";
import { useReadingPosition } from "../readingPosition";
import { deriveChunkMarks, findMarkIndex, moveRovingIndex } from "./utils";

export interface ChunkStripFacadeOptions {
  groupId: string;
  chunks: readonly BriefChunk[];
  jumpToChunk: (chunkId: string) => void;
}

/**
 * The strip subscribes to the reader's chunk only while it sits in this
 * group, so a scroll-spy tick re-renders the strips it touches and no other.
 */
export function useChunkStripFacade({
  groupId,
  chunks,
  jumpToChunk,
}: ChunkStripFacadeOptions) {
  const activeChunkId = useReadingPosition((state) =>
    state.activeGroupId === groupId ? state.activeChunkId : null,
  );
  // By chunk id, not place: a mark that leaves the list drops its state
  // instead of leaving the strip without a tab stop.
  const [hoverId, setHoverId] = useState<string | undefined>(undefined);
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  const [focusPeekId, setFocusPeekId] = useState<string | undefined>(undefined);
  const markRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pointerPressed = useRef(false);

  const marks = deriveChunkMarks(chunks);
  const activeIndex = marks.findIndex((mark) => mark.id === activeChunkId);
  const restingIndex = activeIndex === -1 ? 0 : activeIndex;
  const focusIndex = findMarkIndex(marks, focusId);
  const tabStop = focusIndex ?? restingIndex;
  const peekIndex =
    findMarkIndex(marks, hoverId) ?? findMarkIndex(marks, focusPeekId);
  const shownIndex = peekIndex ?? activeIndex;
  const shown = marks[shownIndex];

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const next = moveRovingIndex(event.key, tabStop, marks.length);
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    markRefs.current[next]?.focus();
  }

  function hoverMark(event: PointerEvent<HTMLButtonElement>, chunkId: string) {
    if (event.pointerType === "mouse") {
      setHoverId(chunkId);
    }
  }

  function leaveMark() {
    setHoverId(undefined);
  }

  function pressMark() {
    pointerPressed.current = true;
  }

  // A click focuses the mark too, but only keyboard focus peeks: a clicked
  // mark must not hold the caption while the reader scrolls on.
  function focusMark(chunkId: string) {
    setFocusId(chunkId);
    setFocusPeekId(pointerPressed.current ? undefined : chunkId);
    pointerPressed.current = false;
  }

  // Safari never focuses a clicked button, so the click clears the press too.
  function activateMark(chunkId: string) {
    pointerPressed.current = false;
    jumpToChunk(chunkId);
  }

  function leaveToolbar(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    const stayed = next instanceof Node && event.currentTarget.contains(next);
    if (!stayed) {
      setFocusId(undefined);
      setFocusPeekId(undefined);
    }
  }

  return {
    marks,
    activeIndex,
    tabStop,
    peekIndex,
    shown,
    markRefs,
    hoverMark,
    leaveMark,
    pressMark,
    focusMark,
    activateMark,
    moveFocus,
    leaveToolbar,
  };
}
