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
 * Regression coverage for the pre-existing jump-nav no-op: `useRevisionNavigation`
 * used to query `main .diff .railbtn-focus`, a class selector CSS-module
 * hashing never emits, so it silently matched zero elements. This exercises the
 * real DOM query end-to-end — it would have failed (no focus change) against
 * the old class selector.
 */
describe("useRevisionNavigation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

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
