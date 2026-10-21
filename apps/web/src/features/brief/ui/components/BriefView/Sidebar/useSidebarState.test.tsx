// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ViewportBand } from "@web/hooks/useViewportBoundary";
import { SIDEBAR_STORAGE_KEY } from "./storage";
import { useSidebarState } from "./useSidebarState";

afterEach(() => {
  // Every hook here is rendered, and nothing auto-unmounts: a hook left
  // mounted past the file lets React flush scheduled work after the jsdom
  // window is gone, which surfaces as an unhandled `window is not defined`.
  cleanup();
  window.localStorage.clear();
});

function stored(): unknown {
  const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe("useSidebarState at narrow width", () => {
  it("starts collapsed whatever is stored and never writes the sheet state", () => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "this-pr" }),
    );
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useSidebarState("narrow", true));
    expect(result.current.expanded).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);

    act(() => result.current.collapse());
    expect(result.current.expanded).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("writes the tab and keeps the stored expanded value", () => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "this-pr" }),
    );
    const { result } = renderHook(() => useSidebarState("narrow", true));

    act(() => result.current.selectTab("revisions"));

    expect(stored()).toEqual({ expanded: true, tab: "revisions" });
  });

  it("crossing to narrow closes the sheet, crossing back restores the choice", () => {
    const { result, rerender } = renderHook(
      ({ band }) => useSidebarState(band, true),
      { initialProps: { band: "desktop" as ViewportBand } },
    );
    act(() => result.current.expand());
    expect(result.current.expanded).toBe(true);

    rerender({ band: "narrow" });
    expect(result.current.expanded).toBe(false);

    act(() => result.current.expand());
    expect(result.current.expanded).toBe(true);

    rerender({ band: "desktop" });
    expect(result.current.expanded).toBe(true);

    rerender({ band: "narrow" });
    expect(result.current.expanded).toBe(false);
    expect(stored()).toEqual({ expanded: true, tab: "this-pr" });
  });
});

describe("useSidebarState while the sidebar is hidden", () => {
  it("the sheet closes when the sidebar leaves and stays closed on return", () => {
    const { result, rerender } = renderHook(
      ({ visible }) => useSidebarState("narrow", visible),
      { initialProps: { visible: true } },
    );
    act(() => result.current.expand());
    expect(result.current.expanded).toBe(true);

    rerender({ visible: false });
    rerender({ visible: true });

    expect(result.current.expanded).toBe(false);
  });

  it("hiding on desktop leaves the stored preference alone", () => {
    const { result, rerender } = renderHook(
      ({ visible }) => useSidebarState("desktop", visible),
      { initialProps: { visible: true } },
    );
    act(() => result.current.expand());

    rerender({ visible: false });
    rerender({ visible: true });

    expect(result.current.expanded).toBe(true);
    expect(stored()).toEqual({ expanded: true, tab: "this-pr" });
  });
});

describe("useSidebarState", () => {
  it("starts from the stored preference without writing", () => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "this-pr" }),
    );
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const { result } = renderHook(() => useSidebarState("desktop", true));

    expect(result.current.expanded).toBe(true);
    expect(result.current.tab).toBe("this-pr");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("reads storage once, not on every render", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const { rerender } = renderHook(() => useSidebarState("desktop", true));

    rerender();
    rerender();

    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it("toggle flips expanded and writes", () => {
    const { result } = renderHook(() => useSidebarState("desktop", true));

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    expect(stored()).toEqual({ expanded: true, tab: "this-pr" });

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    expect(stored()).toEqual({ expanded: false, tab: "this-pr" });
  });

  it("expand and collapse are idempotent writes", () => {
    const { result } = renderHook(() => useSidebarState("desktop", true));

    act(() => result.current.expand());
    act(() => result.current.expand());
    expect(result.current.expanded).toBe(true);

    act(() => result.current.collapse());
    expect(result.current.expanded).toBe(false);
    expect(stored()).toEqual({ expanded: false, tab: "this-pr" });
  });

  it("selectTab keeps expanded and writes the tab", () => {
    const { result } = renderHook(() => useSidebarState("desktop", true));

    act(() => result.current.expand());
    act(() => result.current.selectTab("revisions"));

    expect(stored()).toEqual({ expanded: true, tab: "revisions" });
  });

  it("keeps working when storage is denied", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useSidebarState("desktop", true));

    act(() => result.current.toggle());

    expect(result.current.expanded).toBe(true);
  });
});
