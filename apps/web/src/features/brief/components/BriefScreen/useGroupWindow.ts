import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultRangeExtractor,
  useWindowVirtualizer,
  type Range,
  type VirtualItem,
} from "@tanstack/react-virtual";

/** Fixed constant, never a live viewport read: server and client must
 * derive the identical initial window or hydration mismatches. */
export const SSR_VIEWPORT_RECT = {
  width: 1280,
  height: 900,
} as const;

const DEFAULT_OVERSCAN = 4;

/**
 * The attribute every windowed card wrapper carries. The NAME is fixed by
 * the virtualizer (its `indexAttribute` default drives measurement); the
 * focus-pin tracking queries it too, so it is exported rather than a bare
 * literal at the query site.
 */
export const CHUNK_WINDOW_INDEX_ATTR = "data-index";

export interface GroupWindowOptions {
  /** Ordered file-qualified chunk keys (`file#chunkId`) of this group. */
  chunkKeys: readonly string[];
  /** Estimated card height by index — the shared chunk height model. */
  estimateChunk: (index: number) => number;
  /**
   * Chunk keys that must stay mounted regardless of the window — the card
   * holding focus or an open composer. Undefined = none.
   */
  pinnedKeys?: ReadonlySet<string> | undefined;
  overscan?: number | undefined;
}

export interface GroupWindow {
  /** Attach to the group's chunk-list container. */
  listRef: (node: HTMLElement | null) => void;
  /** Attach to every rendered card (measures real height; no-ops hidden). */
  measureElement: (node: Element | null) => void;
  /** The cards to render right now (latched while the pane is hidden). */
  items: readonly VirtualItem[];
  /** Height the list container must occupy (latched while hidden). */
  totalSize: number;
  /**
   * The list's document offset. Item starts are document-relative, so a
   * card's position within the list is `item.start - scrollMargin`.
   */
  scrollMargin: number;
  /** False while a `[hidden]` ancestor keeps this list unmeasurable. */
  active: boolean;
  /** Index of a chunk key in this group, -1 when absent. */
  indexOfKey: (key: string) => number;
  /** Scroll the window toward a key; false = absent key or hidden pane. */
  scrollToKey: (key: string) => boolean;
}

/** Latest-value holders so DOM observer callbacks never close over stale renders. */
interface LiveRefs {
  virtualizer: { measurementsCache: VirtualItem[] } | null;
  active: boolean;
}

/**
 * Windows one group's chunk-card list against the page scroll.
 *
 * Hidden-pane latch: a frozen lens pane cannot receive props (the memo
 * skips the delivering render), so hiddenness is observed from the DOM.
 * While hidden the virtualizer is disabled, its measurements are
 * snapshotted (disabling wipes virtual-core's cache), and the last visible
 * items/totalSize keep being served so the kept-warm DOM never changes.
 */
export function useGroupWindow(options: GroupWindowOptions): GroupWindow {
  const { chunkKeys, estimateChunk, pinnedKeys, overscan } = options;
  const [listEl, setListEl] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(true);
  const [scrollMargin, setScrollMargin] = useState(0);
  const live = useRef<LiveRefs>({ virtualizer: null, active: true });
  const measurementsSnapshot = useRef<VirtualItem[]>([]);

  const keyIndex = useMemo(() => {
    const map = new Map<string, number>();
    chunkKeys.forEach((key, index) => map.set(key, index));
    return map;
  }, [chunkKeys]);

  // Hidden watch. The snapshot must happen HERE, before the disabling
  // render commits — after it the cache is already wiped.
  useEffect(() => {
    if (!listEl) return;

    const update = () => {
      const visible = listEl.closest("[hidden]") === null;

      if (!visible && live.current.active) {
        measurementsSnapshot.current =
          live.current.virtualizer?.measurementsCache ?? [];
      }

      live.current.active = visible;
      setActive(visible);
    };
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });

    return () => observer.disconnect();
  }, [listEl]);

  // This list's document offset, re-read when body height changes (content
  // above resizing moves every later group). Skipped while hidden — a
  // hidden list measures rect 0.
  useEffect(() => {
    if (!listEl || !active) return;

    const update = () => {
      const next = Math.round(
        listEl.getBoundingClientRect().top + window.scrollY,
      );
      setScrollMargin((current) => (current === next ? current : next));
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(document.body);

    return () => observer.disconnect();
  }, [active, listEl]);

  const rangeExtractor = useCallback(
    (range: Range) => {
      const base = defaultRangeExtractor(range);
      if (!pinnedKeys || pinnedKeys.size === 0) return base;
      const merged = new Set(base);
      for (const key of pinnedKeys) {
        const index = keyIndex.get(key);
        if (index !== undefined) merged.add(index);
      }
      return [...merged].toSorted((a, b) => a - b);
    },
    [keyIndex, pinnedKeys],
  );

  const virtualizer = useWindowVirtualizer({
    count: chunkKeys.length,
    estimateSize: estimateChunk,
    overscan: overscan ?? DEFAULT_OVERSCAN,
    scrollMargin,
    enabled: active,
    initialRect: SSR_VIEWPORT_RECT,
    initialMeasurementsCache: measurementsSnapshot.current,
    getItemKey: (index) => chunkKeys[index] ?? index,
    rangeExtractor,
  });
  live.current.virtualizer = virtualizer;

  // Latch: refs only advance while active, so a hidden pane keeps serving
  // its last visible window and the kept-warm DOM never changes shape.
  const latchedItems = useRef<readonly VirtualItem[]>([]);
  const latchedTotal = useRef(0);
  if (active) {
    latchedItems.current = virtualizer.getVirtualItems();
    latchedTotal.current = virtualizer.getTotalSize();
  }

  const measureElement = useCallback(
    (node: Element | null) => {
      // A null detach must reach the core (it prunes its element cache);
      // only hidden LIVE nodes are refused — their offsetHeight is 0.
      if (node !== null && node.closest("[hidden]") !== null) return;
      virtualizer.measureElement(node);
    },
    [virtualizer],
  );

  const indexOfKey = useCallback(
    (key: string) => keyIndex.get(key) ?? -1,
    [keyIndex],
  );

  const scrollToKey = useCallback(
    (key: string) => {
      // Live ref, not state: after an unhide the state is one render stale
      // — a jump from the same gesture would read false and die.
      if (!live.current.active) return false;
      const index = keyIndex.get(key);
      if (index === undefined) return false;
      // "instant": measurement adjustments cancel in-flight smooth scrolls,
      // and "auto" would defer to the page's smooth CSS.
      virtualizer.scrollToIndex(index, { align: "start", behavior: "instant" });
      return true;
    },
    [keyIndex, virtualizer],
  );

  return {
    listRef: setListEl,
    measureElement,
    items: latchedItems.current,
    totalSize: latchedTotal.current,
    scrollMargin,
    active,
    indexOfKey,
    scrollToKey,
  };
}
