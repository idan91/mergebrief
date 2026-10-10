// @vitest-environment jsdom
import type { DiffLine } from "@web/utils/diffTokens/types";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLanding } from "../components/BriefView/landing";
import type { ComparisonMarkFiles } from "../../model/comparison/runs";
import type { BriefChunk } from "../../model/types";
import {
  pickRevisionTargetIndex,
  useRevisionNavigation,
} from "./useRevisionNavigation";

describe("pickRevisionTargetIndex", () => {
  const mounted = [
    { index: 0, top: 0 },
    { index: 1, top: 200 },
    { index: 2, top: 400 },
  ];

  it("jumps forward to the first mounted rail past the reading line", () => {
    expect(
      pickRevisionTargetIndex({
        targetCount: 3,
        mounted,
        direction: 1,
        readingLine: 100,
        fallbackAnchor: -1,
      }),
    ).toBe(1);
  });

  it("steps to the UNMOUNTED next target when every mounted rail is above", () => {
    // Mounted rails cover model indexes 0-2 of 6; the reading line is below
    // them all; the next target exists but has no DOM yet.
    expect(
      pickRevisionTargetIndex({
        targetCount: 6,
        mounted,
        direction: 1,
        readingLine: 500,
        fallbackAnchor: -1,
      }),
    ).toBe(3);
  });

  it("wraps forward from the last target", () => {
    expect(
      pickRevisionTargetIndex({
        targetCount: 3,
        mounted,
        direction: 1,
        readingLine: 500,
        fallbackAnchor: -1,
      }),
    ).toBe(0);
  });

  it("jumps backward to the nearest mounted rail above the reading line", () => {
    expect(
      pickRevisionTargetIndex({
        targetCount: 3,
        mounted,
        direction: -1,
        readingLine: 300,
        fallbackAnchor: -1,
      }),
    ).toBe(1);
  });

  it("steps to the unmounted previous target when mounted rails sit below", () => {
    const deepMounted = [
      { index: 3, top: 1000 },
      { index: 4, top: 1200 },
    ];
    expect(
      pickRevisionTargetIndex({
        targetCount: 6,
        mounted: deepMounted,
        direction: -1,
        readingLine: 500,
        fallbackAnchor: -1,
      }),
    ).toBe(2);
  });

  it("wraps backward from the first target", () => {
    expect(
      pickRevisionTargetIndex({
        targetCount: 3,
        mounted,
        direction: -1,
        readingLine: -50,
        fallbackAnchor: -1,
      }),
    ).toBe(2);
  });

  it("anchors on the fallback when nothing is mounted", () => {
    expect(
      pickRevisionTargetIndex({
        targetCount: 6,
        mounted: [],
        direction: 1,
        readingLine: 100,
        fallbackAnchor: 2,
      }),
    ).toBe(3);
    expect(
      pickRevisionTargetIndex({
        targetCount: 6,
        mounted: [],
        direction: -1,
        readingLine: 100,
        fallbackAnchor: 2,
      }),
    ).toBe(1);
  });

  it("returns undefined with no targets at all", () => {
    expect(
      pickRevisionTargetIndex({
        targetCount: 0,
        mounted: [],
        direction: 1,
        readingLine: 100,
        fallbackAnchor: -1,
      }),
    ).toBeUndefined();
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

/** The hook lands through the real landing module, over stubbed windows. */
function renderNavigation(
  scrollTowardChunk = vi.fn(() => true),
  openChunk = vi.fn(),
  host: NavigationHost = {},
) {
  const chunkWindows = { scrollToChunk: scrollTowardChunk };
  const {
    chunks = CHUNKS,
    marks = MARKS,
    getActiveChunkId = () => null,
  } = host;
  return {
    scrollTowardChunk,
    openChunk,
    ...renderHook(() => {
      const { land } = useLanding({
        briefId: "brief-a",
        chunkWindows,
        openChunk,
        inChangesScope: false,
        exitChangesScope: undefined,
      });
      return useRevisionNavigation({ chunks, marks, getActiveChunkId, land });
    }),
  };
}

function jump(step: () => void) {
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
    // Unmount first: the landing's frames must stop before the environment
    // tears down.
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("jumpNext steps past the mounted rails to the next model target", () => {
    // jsdom rects are all 0, so both mounted rails sit above the reading
    // line: the anchor is the deeper one (model index 1) and next resolves
    // to the UNMOUNTED third target via the chunk jump.
    const rails = renderRails();
    for (const rail of rails) {
      rail.scrollIntoView = vi.fn();
    }
    const scrollTowardChunk = vi.fn(() => true);
    const { result } = renderNavigation(scrollTowardChunk);

    jump(() => result.current.jumpNext());

    expect(scrollTowardChunk).toHaveBeenCalledWith("c3");
  });

  it("jumpPrev focuses the nearest mounted rail above the reading line", () => {
    const rails = renderRails();
    for (const rail of rails) {
      rail.scrollIntoView = vi.fn();
    }
    const { result } = renderNavigation();

    jump(() => result.current.jumpPrev());

    expect(document.activeElement).toBe(rails[1]);
    expect(rails[1]?.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "center" }),
    );
  });

  it("routes an unmounted target through the window scroll, opening it first", () => {
    document.body.innerHTML = "<main></main>";
    const scrollTowardChunk = vi.fn(() => true);
    const openChunk = vi.fn();
    const { result } = renderNavigation(scrollTowardChunk, openChunk);

    jump(() => result.current.jumpNext());

    // Rails are rows: a collapsed card has no rail to land on.
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

  it("does nothing when the model has no targets", () => {
    document.body.innerHTML = "<main></main>";
    const scrollTowardChunk = vi.fn(() => true);
    const { result } = renderNavigation(scrollTowardChunk, vi.fn(), {
      chunks: [],
      marks: null,
    });
    expect(() => {
      jump(() => result.current.jumpNext());
    }).not.toThrow();
    expect(scrollTowardChunk).not.toHaveBeenCalled();
  });
});
