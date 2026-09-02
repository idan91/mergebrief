// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIDEBAR_STORAGE_KEY } from "./storage";
import { useSidebarState } from "./useSidebarState";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function stored(): unknown {
  const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe("useSidebarState", () => {
  it("starts from the stored preference without writing", () => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "this-pr" }),
    );
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const { result } = renderHook(() => useSidebarState());

    expect(result.current.expanded).toBe(true);
    expect(result.current.tab).toBe("this-pr");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("reads storage once, not on every render", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const { rerender } = renderHook(() => useSidebarState());

    rerender();
    rerender();

    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it("toggle flips expanded and writes", () => {
    const { result } = renderHook(() => useSidebarState());

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    expect(stored()).toEqual({ expanded: true, tab: "this-pr" });

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    expect(stored()).toEqual({ expanded: false, tab: "this-pr" });
  });

  it("expand and collapse are idempotent writes", () => {
    const { result } = renderHook(() => useSidebarState());

    act(() => result.current.expand());
    act(() => result.current.expand());
    expect(result.current.expanded).toBe(true);

    act(() => result.current.collapse());
    expect(result.current.expanded).toBe(false);
    expect(stored()).toEqual({ expanded: false, tab: "this-pr" });
  });

  it("selectTab keeps expanded and writes the tab", () => {
    const { result } = renderHook(() => useSidebarState());

    act(() => result.current.expand());
    act(() => result.current.selectTab("this-pr"));

    expect(stored()).toEqual({ expanded: true, tab: "this-pr" });
  });

  it("keeps working when storage is denied", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useSidebarState());

    act(() => result.current.toggle());

    expect(result.current.expanded).toBe(true);
  });
});
