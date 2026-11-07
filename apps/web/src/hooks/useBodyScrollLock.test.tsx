// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useBodyScrollLock } from "./useBodyScrollLock";

const CLASSIC_SCROLLBAR_PX = 15;

function stubRootWidth(scrollbarWidth: number): void {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(
    window.innerWidth - scrollbarWidth,
  );
}

afterEach(() => {
  document.body.style.overflow = "";
  document.documentElement.style.scrollbarGutter = "";
  vi.restoreAllMocks();
});

describe("useBodyScrollLock", () => {
  it("locks while active and restores the previous value after", () => {
    document.body.style.overflow = "auto";
    const { rerender, unmount } = renderHook(
      ({ active }) => useBodyScrollLock(active),
      { initialProps: { active: true } },
    );
    expect(document.body.style.overflow).toBe("hidden");

    rerender({ active: false });
    expect(document.body.style.overflow).toBe("auto");

    rerender({ active: true });
    unmount();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("frees the page only when the last of two locks lets go", () => {
    const first = renderHook(() => useBodyScrollLock(true));
    const second = renderHook(() => useBodyScrollLock(true));

    first.unmount();
    expect(document.body.style.overflow).toBe("hidden");

    second.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("leaves the body alone while inactive", () => {
    renderHook(() => useBodyScrollLock(false));
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the scrollbar's width as a gutter while locked", () => {
    stubRootWidth(CLASSIC_SCROLLBAR_PX);
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.documentElement.style.scrollbarGutter).toBe("stable");

    unmount();
    expect(document.documentElement.style.scrollbarGutter).toBe("");
  });

  it("adds no gutter to a page without a classic scrollbar", () => {
    stubRootWidth(0);
    renderHook(() => useBodyScrollLock(true));

    expect(document.documentElement.style.scrollbarGutter).toBe("");
  });

  it("keeps the gutter until the last of two locks lets go", () => {
    stubRootWidth(CLASSIC_SCROLLBAR_PX);
    const first = renderHook(() => useBodyScrollLock(true));
    const second = renderHook(() => useBodyScrollLock(true));

    first.unmount();
    expect(document.documentElement.style.scrollbarGutter).toBe("stable");

    second.unmount();
    expect(document.documentElement.style.scrollbarGutter).toBe("");
  });
});
