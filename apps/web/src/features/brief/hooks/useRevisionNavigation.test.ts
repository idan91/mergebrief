// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { findJumpTarget, useRevisionNavigation } from "./useRevisionNavigation";

describe("findJumpTarget", () => {
  const rails = ["a", "b", "c"];

  it("jumps forward to the first rail past the reading line", () => {
    expect(findJumpTarget(rails, [0, 200, 400], 1, 100)).toBe("b");
  });

  it("wraps to the first rail when none is past the reading line going forward", () => {
    expect(findJumpTarget(rails, [0, 10, 20], 1, 100)).toBe("a");
  });

  it("jumps backward to the nearest rail before the reading line", () => {
    expect(findJumpTarget(rails, [0, 50, 400], -1, 100)).toBe("b");
  });

  it("wraps to the last rail when none is before the reading line going backward", () => {
    expect(findJumpTarget(rails, [200, 300, 400], -1, 100)).toBe("c");
  });

  it("returns undefined for no rails", () => {
    expect(findJumpTarget([], [], 1, 100)).toBeUndefined();
  });
});

/**
 * Exercises the real DOM query end-to-end: a class selector here would match
 * zero elements, since CSS-module hashing never emits the authored classname.
 */
function renderRails(): HTMLButtonElement[] {
  document.body.innerHTML = `
    <main>
      <table class="diff">
        <button data-jump-target aria-label="first"></button>
        <button data-jump-target aria-label="second"></button>
      </table>
    </main>
  `;
  return [
    ...document.querySelectorAll<HTMLButtonElement>("[data-jump-target]"),
  ];
}

describe("useRevisionNavigation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("jumpNext focuses a rendered rail via the data attribute", () => {
    const rails = renderRails();
    for (const rail of rails) {
      rail.scrollIntoView = vi.fn();
    }
    const { result } = renderHook(() => useRevisionNavigation());

    result.current.jumpNext();

    expect(document.activeElement).toBe(rails[0]);
  });

  it("jumpPrev focuses a rendered rail via the data attribute", () => {
    const rails = renderRails();
    for (const rail of rails) {
      rail.scrollIntoView = vi.fn();
    }
    const { result } = renderHook(() => useRevisionNavigation());

    result.current.jumpPrev();

    expect(document.activeElement).toBe(rails[rails.length - 1]);
  });

  it("does nothing when no rails are rendered", () => {
    document.body.innerHTML = "<main></main>";
    const { result } = renderHook(() => useRevisionNavigation());
    expect(() => result.current.jumpNext()).not.toThrow();
  });
});
