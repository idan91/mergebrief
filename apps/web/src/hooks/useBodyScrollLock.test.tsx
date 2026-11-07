// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useBodyScrollLock } from "./useBodyScrollLock";

afterEach(() => {
  document.body.style.overflow = "";
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
});
