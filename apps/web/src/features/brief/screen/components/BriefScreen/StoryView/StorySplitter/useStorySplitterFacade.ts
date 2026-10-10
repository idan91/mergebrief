import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

import type { SidebarLayout } from "../../utils";
import {
  STORY_CARD_FLOOR_PX,
  STORY_CARD_KEYBOARD_STEP_PX,
  STORY_CARD_TRACK_PROPERTY,
  STORY_CHUNKS_ATTR,
  STORY_DRAG_ATTR,
  STORY_DRAG_SLOP_PX,
} from "./consts";
import type { GroupMeasure, StoryDrag } from "./types";
import {
  deriveCardCeiling,
  deriveTrackFromPointer,
  hasMovedPastSlop,
  isSameMeasure,
  readEntryWidth,
  readServerStacked,
  readStacked,
  releaseCapture,
  resolveStackedQuery,
  resolveTextDirection,
  restoreTrack,
  stepTrack,
} from "./utils";

export interface UseStorySplitterFacadeInput {
  sidebar: SidebarLayout | undefined;
  setTrack: (px: number) => void;
  resetTrack: () => void;
}

const UNMEASURED: GroupMeasure = { column: 0, chunks: 0, card: 0 };

function useStacked(sidebar: SidebarLayout | undefined): boolean {
  const query = resolveStackedQuery(sidebar);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = useCallback(() => readStacked(query), [query]);

  return useSyncExternalStore(subscribe, read, readServerStacked);
}

interface MeasuredGroup {
  measure: GroupMeasure;
  /** The newest observation; state only follows it outside a drag. */
  latestRef: RefObject<GroupMeasure>;
  flush: () => void;
}

/**
 * Integer px of the group, its diff column and its card. Every card changes
 * width on every pointer move of any handle, so while `.main` carries the
 * drag attribute the observation lands in a ref and the state update waits
 * for the attribute to drop: one commit per drag per group, not per frame.
 */
function useGroupMeasure(handle: HTMLElement | null): MeasuredGroup {
  const [measure, setMeasure] = useState<GroupMeasure>(UNMEASURED);
  const latestRef = useRef<GroupMeasure>(UNMEASURED);

  const flush = useCallback(() => {
    const latest = latestRef.current;
    setMeasure((previous) =>
      isSameMeasure(latest, previous) ? previous : latest,
    );
  }, []);

  useEffect(() => {
    const group = handle?.parentElement;
    const chunks = group?.querySelector(`:scope > [${STORY_CHUNKS_ATTR}]`);
    const card = group?.querySelector(":scope > article");
    const main = group?.closest(".main");
    const observable =
      group && chunks && card && main && typeof ResizeObserver !== "undefined";
    if (!observable) {
      return;
    }

    const sizes = new ResizeObserver((entries) => {
      const next = { ...latestRef.current };
      for (const entry of entries) {
        if (entry.target === group) {
          next.column = readEntryWidth(entry);
        }
        if (entry.target === chunks) {
          next.chunks = readEntryWidth(entry);
        }
        if (entry.target === card) {
          next.card = readEntryWidth(entry);
        }
      }
      latestRef.current = next;
      if (!main.hasAttribute(STORY_DRAG_ATTR)) {
        flush();
      }
    });
    sizes.observe(group);
    sizes.observe(chunks);
    sizes.observe(card);

    const release = new MutationObserver(() => {
      if (!main.hasAttribute(STORY_DRAG_ATTR)) {
        flush();
      }
    });
    release.observe(main, { attributeFilter: [STORY_DRAG_ATTR] });

    return () => {
      sizes.disconnect();
      release.disconnect();
    };
  }, [flush, handle]);

  return { measure, latestRef, flush };
}

export function useStorySplitterFacade({
  sidebar,
  setTrack,
  resetTrack,
}: UseStorySplitterFacadeInput) {
  const [handle, setHandle] = useState<HTMLElement | null>(null);
  const stacked = useStacked(sidebar);
  const dragRef = useRef<StoryDrag | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const { measure, latestRef, flush } = useGroupMeasure(handle);

  const measured = measure.column > 0 && measure.card > 0;
  const gap = Math.max(0, measure.column - measure.chunks - measure.card);
  const floor = STORY_CARD_FLOOR_PX;
  const ceiling = deriveCardCeiling(measure.column, gap);

  const clamp = useCallback(
    (px: number) => Math.min(ceiling, Math.max(floor, Math.round(px))),
    [ceiling, floor],
  );

  const endDrag = useCallback((): StoryDrag | undefined => {
    const drag = dragRef.current;
    if (drag === undefined) {
      return undefined;
    }

    dragRef.current = undefined;
    drag.main.removeAttribute(STORY_DRAG_ATTR);
    setDragging(false);
    flush();
    return drag;
  }, [flush]);

  // A revision swap or a stack-down can remove the handle mid-drag; the
  // attribute would otherwise outlive it and freeze every group's measure.
  // Keyed on the handle so a null ref ends the drag too.
  useEffect(
    () => () => {
      const drag = endDrag();
      if (drag !== undefined) {
        restoreTrack(drag);
      }
    },
    [endDrag, handle],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const direction = resolveTextDirection(event.currentTarget);
    const next = stepTrack(latestRef.current.card, event.key, direction, {
      step: STORY_CARD_KEYBOARD_STEP_PX,
      floor,
      ceiling,
    });
    if (next === undefined) {
      return;
    }

    event.preventDefault();
    // Key repeat outruns the observer; the next press steps from this commit
    // and the observer corrects it once layout settles.
    latestRef.current = { ...latestRef.current, card: next };
    setTrack(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || dragRef.current !== undefined) {
      return;
    }
    const main = event.currentTarget.closest<HTMLElement>(".main");
    if (main === null) {
      return;
    }

    // Cancelling pointerdown suppresses the mouse events that would start a
    // text selection, and with them the focus move; focus is done by hand.
    event.preventDefault();
    event.currentTarget.focus();
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    main.setAttribute(STORY_DRAG_ATTR, "");
    setDragging(true);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startTrack: latestRef.current.card,
      main,
      priorTrack: main.style.getPropertyValue(STORY_CARD_TRACK_PROPERTY),
      moved: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag === undefined || drag.pointerId !== event.pointerId) {
      return;
    }
    if (!hasMovedPastSlop(drag, event.clientX, STORY_DRAG_SLOP_PX)) {
      return;
    }

    const direction = resolveTextDirection(event.currentTarget);
    const next = deriveTrackFromPointer(
      drag.startTrack,
      drag.startX,
      event.clientX,
      direction,
    );
    drag.moved = true;
    drag.main.style.setProperty(STORY_CARD_TRACK_PROPERTY, `${next}px`);
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    const drag = endDrag();
    releaseCapture(event.currentTarget, event.pointerId);
    if (drag === undefined || !drag.moved) {
      return;
    }

    const direction = resolveTextDirection(event.currentTarget);
    const raw = deriveTrackFromPointer(
      drag.startTrack,
      drag.startX,
      event.clientX,
      direction,
    );
    const committed = clamp(raw);
    drag.main.style.setProperty(STORY_CARD_TRACK_PROPERTY, `${committed}px`);
    setTrack(committed);
  };

  const onPointerCancel = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    const drag = endDrag();
    releaseCapture(event.currentTarget, event.pointerId);
    if (drag !== undefined) {
      restoreTrack(drag);
    }
  };

  return {
    setHandle,
    stacked,
    dragging,
    measured,
    floor,
    ceiling,
    cardWidth: measure.card,
    onKeyDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture: onPointerCancel,
    onDoubleClick: resetTrack,
  };
}
