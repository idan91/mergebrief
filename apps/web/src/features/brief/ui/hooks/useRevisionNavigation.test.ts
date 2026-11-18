// @vitest-environment jsdom
import type { DiffLine } from "@web/utils/diffTokens/types";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollToTarget } from "../components/BriefView/scroll-to-target";
import type { ComparisonMarkFiles } from "../../model/comparison/runs";
import type { BriefChunk } from "../../model/types";
import {
  pickRevisionStep,
  useRevisionNavigation,
} from "./useRevisionNavigation";

describe("pickRevisionStep", () => {
  const mounted = [
    { index: 0, top: 0 },
    { index: 1, top: 200 },
    { index: 2, top: 400 },
  ];

  it("jumps forward to the first mounted rail below the band", () => {
    expect(
      pickRevisionStep({
        targetCount: 3,
        mounted,
        direction: 1,
        band: { top: 100, middle: 150, bottom: 200 },
        fallbackAnchor: -1,
      }),
    ).toEqual({ index: 1, wrapped: false });
  });

  it("steps to the UNMOUNTED next target when every mounted rail is above", () => {
    // Mounted rails cover model indexes 0-2 of 6; the band is below them all;
    // the next target exists but has no DOM yet.
    expect(
      pickRevisionStep({
        targetCount: 6,
        mounted,
        direction: 1,
        band: { top: 500, middle: 600, bottom: 700 },
        fallbackAnchor: -1,
      }),
    ).toEqual({ index: 3, wrapped: false });
  });

  it("wraps forward from the last target", () => {
    expect(
      pickRevisionStep({
        targetCount: 3,
        mounted,
        direction: 1,
        band: { top: 500, middle: 600, bottom: 700 },
        fallbackAnchor: -1,
      }),
    ).toEqual({ index: 0, wrapped: true });
  });

  it("jumps backward to the nearest mounted rail above the band", () => {
    expect(
      pickRevisionStep({
        targetCount: 3,
        mounted,
        direction: -1,
        band: { top: 300, middle: 350, bottom: 400 },
        fallbackAnchor: -1,
      }),
    ).toEqual({ index: 1, wrapped: false });
  });

  it("steps to the unmounted previous target when mounted rails sit below", () => {
    const deepMounted = [
      { index: 3, top: 1000 },
      { index: 4, top: 1200 },
    ];
    expect(
      pickRevisionStep({
        targetCount: 6,
        mounted: deepMounted,
        direction: -1,
        band: { top: 500, middle: 600, bottom: 700 },
        fallbackAnchor: -1,
      }),
    ).toEqual({ index: 2, wrapped: false });
  });

  it("wraps backward from the first target", () => {
    expect(
      pickRevisionStep({
        targetCount: 3,
        mounted,
        direction: -1,
        band: { top: -100, middle: -50, bottom: 0 },
        fallbackAnchor: -1,
      }),
    ).toEqual({ index: 2, wrapped: true });
  });

  it("anchors on the fallback when nothing is mounted", () => {
    const band = { top: 100, middle: 150, bottom: 200 };
    expect(
      pickRevisionStep({
        targetCount: 6,
        mounted: [],
        direction: 1,
        band,
        fallbackAnchor: 2,
      }),
    ).toEqual({ index: 3, wrapped: false });
    expect(
      pickRevisionStep({
        targetCount: 6,
        mounted: [],
        direction: -1,
        band,
        fallbackAnchor: 2,
      }),
    ).toEqual({ index: 1, wrapped: false });
  });

  it("returns undefined with no targets at all", () => {
    expect(
      pickRevisionStep({
        targetCount: 0,
        mounted: [],
        direction: 1,
        band: { top: 100, middle: 150, bottom: 200 },
        fallbackAnchor: -1,
      }),
    ).toBeUndefined();
  });

  describe("with a rail resting in the reading band", () => {
    // An 800px viewport under a 110px stack: the band's middle is 455, and a
    // landed rail may rest anywhere from 110 down to it.
    const band = { top: 110, middle: 455, bottom: 800 };
    const landed = [
      { index: 0, top: 0 },
      { index: 1, top: 440 },
      { index: 2, top: 900 },
    ];

    it("steps forward past the rail in the band", () => {
      expect(
        pickRevisionStep({
          targetCount: 3,
          mounted: landed,
          direction: 1,
          band,
          fallbackAnchor: -1,
        }),
      ).toEqual({ index: 2, wrapped: false });
    });

    it("steps back to the rail before the one in the band", () => {
      expect(
        pickRevisionStep({
          targetCount: 3,
          mounted: landed,
          direction: -1,
          band,
          fallbackAnchor: -1,
        }),
      ).toEqual({ index: 0, wrapped: false });
    });

    it("reports a wrap forward from the last rail in the band", () => {
      expect(
        pickRevisionStep({
          targetCount: 2,
          mounted: landed.slice(0, 2),
          direction: 1,
          band,
          fallbackAnchor: -1,
        }),
      ).toEqual({ index: 0, wrapped: true });
    });

    it("reports a wrap back from the first rail in the band", () => {
      expect(
        pickRevisionStep({
          targetCount: 3,
          mounted: [{ index: 0, top: 200 }],
          direction: -1,
          band,
          fallbackAnchor: -1,
        }),
      ).toEqual({ index: 2, wrapped: true });
    });
  });

  describe("with the rail the last step landed on", () => {
    const band = { top: 110, middle: 455, bottom: 800 };

    it("wraps forward from a last rail held below the band at max scroll", () => {
      // The page cannot scroll the last rail up into the band.
      expect(
        pickRevisionStep({
          targetCount: 3,
          mounted: [
            { index: 0, top: -500 },
            { index: 1, top: 50 },
            { index: 2, top: 600 },
          ],
          direction: 1,
          band,
          landedIndex: 2,
          fallbackAnchor: -1,
        }),
      ).toEqual({ index: 0, wrapped: true });
    });

    describe("when two rails share the band", () => {
      // The resting line is 340: the rail before the landed one sits nearer.
      const dense = [
        { index: 0, top: 0 },
        { index: 1, top: 345 },
        { index: 2, top: 389 },
        { index: 3, top: 900 },
      ];

      it("steps forward past the landed rail", () => {
        expect(
          pickRevisionStep({
            targetCount: 4,
            mounted: dense,
            direction: 1,
            band,
            landedIndex: 2,
            fallbackAnchor: -1,
          }),
        ).toEqual({ index: 3, wrapped: false });
      });

      it("steps back exactly one from the landed rail", () => {
        expect(
          pickRevisionStep({
            targetCount: 4,
            mounted: dense,
            direction: -1,
            band,
            landedIndex: 2,
            fallbackAnchor: -1,
          }),
        ).toEqual({ index: 1, wrapped: false });
      });
    });

    it("decides by position once the landed rail is scrolled off screen", () => {
      expect(
        pickRevisionStep({
          targetCount: 3,
          mounted: [
            { index: 0, top: -500 },
            { index: 1, top: 300 },
            { index: 2, top: 900 },
          ],
          direction: 1,
          band,
          landedIndex: 0,
          fallbackAnchor: -1,
        }),
      ).toEqual({ index: 2, wrapped: false });
    });
  });
});

/**
 * Exercises the real DOM query end-to-end: a class selector here would match
 * zero elements, since CSS-module hashing never emits the authored classname.
 * Rails carry their model rail keys, matching the gutter's rendering.
 */
function renderRails(): HTMLButtonElement[] {
  document.body.innerHTML = `
    <main>
      <table class="diff">
        <button data-jump-target="src/a.ts#c1:0" aria-label="first"></button>
        <button data-jump-target="src/b.ts#c2:4" aria-label="second"></button>
      </table>
    </main>
  `;
  return [
    ...document.querySelectorAll<HTMLButtonElement>("[data-jump-target]"),
  ];
}

/** One marked run per chunk, its rail at diff-row `railRow` (rail keys are
 * `file#chunkId:<firstRowIndex>`, matching the DOM fixture above). */
function chunkWithRail(
  id: string,
  file: string,
  railRow: number,
  markedLine: number,
): BriefChunk {
  const diff: DiffLine[] = Array.from({ length: railRow }, (_, index) => ({
    kind: "ctx",
    content: "unchanged",
    newLine: index + 1,
  }));
  diff.push({ kind: "add", content: "changed", newLine: markedLine });
  return {
    id,
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "core",
    loc: { added: 1, deleted: 0 },
    addedRanges: [{ start: markedLine, end: markedLine }],
    removedRanges: [],
    riskSurface: [],
    diff,
  };
}

// Derives to rail keys src/a.ts#c1:0, src/b.ts#c2:4, src/c.ts#c3:2.
function ignoreEnd(): void {}

const CHUNKS = [
  chunkWithRail("c1", "src/a.ts", 0, 100),
  chunkWithRail("c2", "src/b.ts", 4, 200),
  chunkWithRail("c3", "src/c.ts", 2, 300),
];
const MARKS: ComparisonMarkFiles = {
  files: [
    {
      file: "src/a.ts",
      addedRanges: [{ start: 100, end: 100 }],
      removedRanges: [],
    },
    {
      file: "src/b.ts",
      addedRanges: [{ start: 200, end: 200 }],
      removedRanges: [],
    },
    {
      file: "src/c.ts",
      addedRanges: [{ start: 300, end: 300 }],
      removedRanges: [],
    },
  ],
};

interface NavigationHost {
  chunks?: readonly BriefChunk[];
  marks?: ComparisonMarkFiles | null;
  getActiveChunkId?: () => string | null;
}

/** The hook scrolls through the real scroll-to-target module, over stubbed windows. */
function renderNavigation(
  scrollTowardChunk = vi.fn(() => true),
  openChunk = vi.fn(),
  host: NavigationHost = {},
) {
  const chunkWindows = {
    scrollToChunk: scrollTowardChunk,
    beginSmoothScroll: () => ignoreEnd,
  };
  return {
    scrollTowardChunk,
    openChunk,
    ...renderHook(
      (current: NavigationHost) => {
        const {
          chunks = CHUNKS,
          marks = MARKS,
          getActiveChunkId = () => null,
        } = current;
        const { scrollToTarget } = useScrollToTarget({
          briefId: "brief-a",
          chunkWindows,
          openChunk,
          inChangesScope: false,
          exitChangesScope: undefined,
        });
        return useRevisionNavigation({
          chunks,
          marks,
          getActiveChunkId,
          scrollToTarget,
        });
      },
      { initialProps: host },
    ),
  };
}

/** jsdom rects are all 0, which is inside the band at scroll 0. */
function placeAboveBand(rail: HTMLButtonElement) {
  rail.getBoundingClientRect = () => ({ top: -100 }) as DOMRect;
}

function jump(step: () => unknown) {
  act(() => {
    step();
    vi.advanceTimersByTime(1);
  });
}

describe("useRevisionNavigation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no CSS namespace; the quoted rail keys need no escaping.
    vi.stubGlobal("CSS", { escape: (value: string) => value });
  });

  afterEach(() => {
    // Unmount first: the scroll's frames must stop before the environment
    // tears down.
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("jumpNext steps past the mounted rails to the next model target", () => {
    // Both mounted rails sit above the band: the anchor is the deeper one
    // (model index 1) and next resolves to the UNMOUNTED third target via
    // the chunk jump.
    const rails = renderRails();
    for (const rail of rails) {
      rail.scrollIntoView = vi.fn();
      placeAboveBand(rail);
    }
    const scrollTowardChunk = vi.fn(() => true);
    const { result } = renderNavigation(scrollTowardChunk);

    jump(() => result.current.jumpNext());

    expect(scrollTowardChunk).toHaveBeenCalledWith("c3");
  });

  it("jumpPrev focuses the nearest mounted rail above the band", () => {
    const rails = renderRails();
    for (const rail of rails) {
      rail.scrollIntoView = vi.fn();
      placeAboveBand(rail);
    }
    const { result } = renderNavigation();

    jump(() => result.current.jumpPrev());

    expect(document.activeElement).toBe(rails[1]);
    expect(rails[1]?.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "center" }),
    );
  });

  it("jumpNext steps on from the rail it landed on", () => {
    // jsdom rests both rails at one top in the band, the first by index
    // nearer; only the landed rail tells them apart.
    const rails = renderRails();
    for (const rail of rails) {
      rail.scrollIntoView = vi.fn();
    }
    const scrollTowardChunk = vi.fn(() => true);
    const { result } = renderNavigation(scrollTowardChunk);

    jump(() => result.current.jumpNext());
    expect(document.activeElement).toBe(rails[1]);

    jump(() => result.current.jumpNext());
    expect(scrollTowardChunk).toHaveBeenCalledWith("c3");
  });

  it("forgets the landed rail when the comparison marks change", () => {
    const rails = renderRails();
    for (const rail of rails) {
      rail.scrollIntoView = vi.fn();
    }
    const scrollTowardChunk = vi.fn(() => true);
    const { result, rerender } = renderNavigation(scrollTowardChunk);
    jump(() => result.current.jumpNext());

    rerender({ marks: { files: [...MARKS.files] } });
    jump(() => result.current.jumpNext());

    expect(document.activeElement).toBe(rails[1]);
    expect(scrollTowardChunk).not.toHaveBeenCalled();
  });

  it("routes an unmounted target through the window scroll, opening it first", () => {
    document.body.innerHTML = "<main></main>";
    const scrollTowardChunk = vi.fn(() => true);
    const openChunk = vi.fn();
    const { result } = renderNavigation(scrollTowardChunk, openChunk);

    jump(() => result.current.jumpNext());

    // Rails are rows: a collapsed card has no rail to scroll to.
    expect(openChunk).toHaveBeenCalledWith("c1");
    expect(scrollTowardChunk).toHaveBeenCalledWith("c1");
  });

  it("reads the active chunk at jump time, not at bind time", () => {
    // The getter exists so a position change never re-renders the host;
    // which only holds if each jump reads it fresh for the fallback anchor.
    document.body.innerHTML = "<main></main>";
    const scrollTowardChunk = vi.fn(() => true);
    let active: string | null = null;
    const { result } = renderNavigation(scrollTowardChunk, vi.fn(), {
      getActiveChunkId: () => active,
    });
    jump(() => result.current.jumpNext());
    expect(scrollTowardChunk).toHaveBeenLastCalledWith("c1");
    active = "c2";
    jump(() => result.current.jumpNext());
    expect(scrollTowardChunk).toHaveBeenLastCalledWith("c3");
  });
});
