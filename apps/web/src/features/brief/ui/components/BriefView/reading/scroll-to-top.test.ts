// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createChunkWindowRegistry,
  type ChunkWindowRegistration,
} from "./chunk-windows";
import { scrollPageToTop } from "./scroll-to-top";

const SCROLLED_Y = 4_000;

function stubReducedMotion(reduced: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduced })),
  );
}

function makeRegistration(): ChunkWindowRegistration & {
  holds: boolean[];
} {
  const holds: boolean[] = [];
  return {
    holds,
    scrollToChunk: () => false,
    holdScrollCompensation: (held) => {
      holds.push(held);
    },
  };
}

function setScrollY(y: number): void {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
}

describe("scrollPageToTop", () => {
  const scrollTo = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("scrollTo", scrollTo);
    stubReducedMotion(false);
    setScrollY(SCROLLED_Y);
  });

  afterEach(() => {
    window.dispatchEvent(new Event("scrollend"));
    scrollTo.mockReset();
    vi.unstubAllGlobals();
  });

  it("holds every window's compensation and scrolls smoothly to the top", () => {
    const registry = createChunkWindowRegistry();
    const story = makeRegistration();
    const changes = makeRegistration();
    registry.register(story);
    registry.register(changes);

    scrollPageToTop(registry);

    expect(story.holds).toEqual([true]);
    expect(changes.holds).toEqual([true]);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("releases the hold once the page reaches the top", () => {
    const registry = createChunkWindowRegistry();
    const story = makeRegistration();
    registry.register(story);

    scrollPageToTop(registry);
    setScrollY(1_200);
    window.dispatchEvent(new Event("scroll"));
    expect(story.holds).toEqual([true]);

    setScrollY(0);
    window.dispatchEvent(new Event("scroll"));
    expect(story.holds).toEqual([true, false]);
  });

  it.each(["wheel", "touchstart", "keydown", "pointerdown"])(
    "releases the hold when the reader takes over with %s",
    (type) => {
      const registry = createChunkWindowRegistry();
      const story = makeRegistration();
      registry.register(story);

      scrollPageToTop(registry);
      window.dispatchEvent(new Event(type));

      expect(story.holds).toEqual([true, false]);
    },
  );

  it("finishes with a jump when the scroll ends short of the top", () => {
    const registry = createChunkWindowRegistry();
    const story = makeRegistration();
    registry.register(story);

    scrollPageToTop(registry);
    setScrollY(6);
    window.dispatchEvent(new Event("scrollend"));
    window.dispatchEvent(new Event("scrollend"));

    expect(story.holds).toEqual([true, false]);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "instant" });
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("leaves a scroll that ends far from the top where it ended", () => {
    const registry = createChunkWindowRegistry();
    const story = makeRegistration();
    registry.register(story);

    scrollPageToTop(registry);
    setScrollY(2_400);
    window.dispatchEvent(new Event("scrollend"));

    expect(story.holds).toEqual([true, false]);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("leaves the page where the reader took over", () => {
    const registry = createChunkWindowRegistry();
    registry.register(makeRegistration());

    scrollPageToTop(registry);
    setScrollY(1_200);
    window.dispatchEvent(new Event("wheel"));
    window.dispatchEvent(new Event("scrollend"));

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("jumps without a hold when the reader asks for reduced motion", () => {
    stubReducedMotion(true);
    const registry = createChunkWindowRegistry();
    const story = makeRegistration();
    registry.register(story);

    scrollPageToTop(registry);

    expect(story.holds).toEqual([]);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("does nothing at the top already", () => {
    setScrollY(0);
    const registry = createChunkWindowRegistry();
    const story = makeRegistration();
    registry.register(story);

    scrollPageToTop(registry);

    expect(story.holds).toEqual([]);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
