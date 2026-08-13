// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    // them all — the next target exists but has no DOM yet.
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

  it("steps to the UNMOUNTED previous target when every mounted rail is below", () => {
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

const TARGETS = [
  { chunkId: "c1", railKey: "src/a.ts#c1:0" },
  { chunkId: "c2", railKey: "src/b.ts#c2:4" },
  { chunkId: "c3", railKey: "src/c.ts#c3:2" },
];
const ORDINALS = new Map([
  ["c1", 0],
  ["c2", 1],
  ["c3", 2],
]);

function renderNavigation(
  scrollTowardChunk = vi.fn(() => true),
  ensureChunkOpen = vi.fn(),
) {
  return {
    scrollTowardChunk,
    ensureChunkOpen,
    ...renderHook(() =>
      useRevisionNavigation({
        targets: TARGETS,
        chunkOrdinals: ORDINALS,
        activeChunkId: null,
        scrollTowardChunk,
        ensureChunkOpen,
      }),
    ),
  };
}

describe("useRevisionNavigation", () => {
  afterEach(() => {
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

    result.current.jumpNext();

    expect(scrollTowardChunk).toHaveBeenCalledWith("c3");
  });

  it("jumpPrev focuses the nearest mounted rail above the reading line", () => {
    const rails = renderRails();
    for (const rail of rails) {
      rail.scrollIntoView = vi.fn();
    }
    const { result } = renderNavigation();

    result.current.jumpPrev();

    expect(document.activeElement).toBe(rails[1]);
  });

  it("routes an unmounted target through the window scroll, opening it first", () => {
    document.body.innerHTML = "<main></main>";
    const scrollTowardChunk = vi.fn(() => true);
    const ensureChunkOpen = vi.fn();
    const { result } = renderNavigation(scrollTowardChunk, ensureChunkOpen);

    result.current.jumpNext();

    // Rails are rows: a collapsed card has no rail to land on.
    expect(ensureChunkOpen).toHaveBeenCalledWith("c1");
    expect(scrollTowardChunk).toHaveBeenCalledWith("c1");
  });

  it("does nothing when the model has no targets", () => {
    document.body.innerHTML = "<main></main>";
    const { result } = renderHook(() =>
      useRevisionNavigation({
        targets: [],
        chunkOrdinals: new Map(),
        activeChunkId: null,
        scrollTowardChunk: vi.fn(() => true),
        ensureChunkOpen: vi.fn(),
      }),
    );
    expect(() => {
      result.current.jumpNext();
    }).not.toThrow();
  });
});
