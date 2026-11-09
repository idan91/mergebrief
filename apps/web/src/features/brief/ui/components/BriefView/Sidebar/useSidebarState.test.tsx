// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ViewportBand } from "@web/hooks/useViewportBoundary";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { REDUCED_MOTION_QUERY } from "@web/utils/motion";
import { SIDEBAR_OVERLAY_QUERY } from "./consts";
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
    const { result } = renderHook(() =>
      useSidebarState("narrow", true, "brief-a"),
    );
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
    const { result } = renderHook(() =>
      useSidebarState("narrow", true, "brief-a"),
    );

    act(() => result.current.selectTab("revisions"));

    expect(stored()).toEqual({ expanded: true, tab: "revisions" });
  });

  it("crossing to narrow closes the sheet, crossing back restores the choice", () => {
    const { result, rerender } = renderHook(
      ({ band }) => useSidebarState(band, true, "brief-a"),
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

describe("useSidebarState over a brief change", () => {
  it("closes the sheet and asks the next brief's sidebar for focus", () => {
    const { result, rerender } = renderHook(
      ({ briefId }) => useSidebarState("narrow", true, briefId),
      { initialProps: { briefId: "brief-a" } },
    );
    act(() => result.current.expand());

    rerender({ briefId: "brief-b" });

    expect(result.current.expanded).toBe(false);
    let refocusDue = false;
    act(() => {
      refocusDue = result.current.takeRevisionRefocus();
    });
    expect(refocusDue).toBe(true);
    act(() => {
      refocusDue = result.current.takeRevisionRefocus();
    });
    expect(refocusDue).toBe(false);
  });

  it("returning to the earlier brief keeps the sheet closed", () => {
    const { result, rerender } = renderHook(
      ({ briefId }) => useSidebarState("narrow", true, briefId),
      { initialProps: { briefId: "brief-a" } },
    );
    act(() => result.current.expand());

    rerender({ briefId: "brief-b" });
    rerender({ briefId: "brief-a" });

    expect(result.current.expanded).toBe(false);
  });

  it("asks for no focus when the sheet was already closed", () => {
    const { result, rerender } = renderHook(
      ({ briefId }) => useSidebarState("narrow", true, briefId),
      { initialProps: { briefId: "brief-a" } },
    );

    rerender({ briefId: "brief-b" });

    let refocusDue = true;
    act(() => {
      refocusDue = result.current.takeRevisionRefocus();
    });
    expect(refocusDue).toBe(false);
  });
});

describe("useSidebarState while the sidebar is hidden", () => {
  it("the sheet closes when the sidebar leaves and stays closed on return", () => {
    const { result, rerender } = renderHook(
      ({ visible }) => useSidebarState("narrow", visible, "brief-a"),
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
      ({ visible }) => useSidebarState("desktop", visible, "brief-a"),
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

    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    expect(result.current.expanded).toBe(true);
    expect(result.current.tab).toBe("this-pr");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("reads storage once, not on every render", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const { rerender } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    rerender();
    rerender();

    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it("toggle flips expanded and writes", () => {
    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    expect(stored()).toEqual({ expanded: true, tab: "this-pr" });

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    expect(stored()).toEqual({ expanded: false, tab: "this-pr" });
  });

  it("expand and collapse are idempotent writes", () => {
    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    act(() => result.current.expand());
    act(() => result.current.expand());
    expect(result.current.expanded).toBe(true);

    act(() => result.current.collapse());
    expect(result.current.expanded).toBe(false);
    expect(stored()).toEqual({ expanded: false, tab: "this-pr" });
  });

  it("selectTab keeps expanded and writes the tab", () => {
    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    act(() => result.current.expand());
    act(() => result.current.selectTab("revisions"));

    expect(stored()).toEqual({ expanded: true, tab: "revisions" });
  });

  it("keeps working when storage is denied", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    act(() => result.current.toggle());

    expect(result.current.expanded).toBe(true);
  });
});

describe("useSidebarState on a load in the overlay range", () => {
  afterEach(resetMediaQueries);

  function storeOpen() {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "this-pr" }),
    );
  }

  it("starts collapsed at 1440px though the stored sidebar is open", () => {
    storeOpen();
    setMediaQueryMatches(SIDEBAR_OVERLAY_QUERY, true);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    expect(result.current.expanded).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(stored()).toEqual({ expanded: true, tab: "this-pr" });
  });

  it("starts open at 1700px where the stored sidebar is open", () => {
    storeOpen();
    setMediaQueryMatches(SIDEBAR_OVERLAY_QUERY, false);

    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    expect(result.current.expanded).toBe(true);
  });

  it("opens and closes on a toggle at 1440px and persists each", () => {
    storeOpen();
    setMediaQueryMatches(SIDEBAR_OVERLAY_QUERY, true);
    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    expect(stored()).toEqual({ expanded: true, tab: "this-pr" });

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    expect(stored()).toEqual({ expanded: false, tab: "this-pr" });
  });

  it("keeps the stored open sidebar when a tab is picked closed", () => {
    storeOpen();
    setMediaQueryMatches(SIDEBAR_OVERLAY_QUERY, true);
    const { result } = renderHook(() =>
      useSidebarState("narrow", true, "brief-a"),
    );

    act(() => result.current.selectTab("revisions"));

    expect(stored()).toEqual({ expanded: true, tab: "revisions" });
  });
});

describe("useSidebarState slide", () => {
  async function renderReady() {
    const rendered = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );
    await waitFor(() => expect(rendered.result.current.motionReady).toBe(true));
    return rendered;
  }

  it("marks a slide only while one runs, so a remount never slides", async () => {
    const { result } = await renderReady();
    expect(result.current.sliding).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.sliding).toBe(true);

    await waitFor(() => expect(result.current.sliding).toBe(false));
  });

  it("keeps the column's reserve until the panel has slid in", async () => {
    const { result } = await renderReady();

    act(() => result.current.toggle());

    expect(result.current.expanded).toBe(true);
    expect(result.current.columnExpanded).toBe(false);
    await waitFor(() => expect(result.current.columnExpanded).toBe(true));
  });

  it("keeps the panel shown until it has slid out", async () => {
    const { result } = await renderReady();
    act(() => result.current.toggleInstantly());

    act(() => result.current.toggle());

    expect(result.current.expanded).toBe(false);
    expect(result.current.panelShown).toBe(true);
    expect(result.current.columnExpanded).toBe(true);
    await waitFor(() => expect(result.current.panelShown).toBe(false));
    expect(result.current.columnExpanded).toBe(false);
  });

  it("moves panel and column together on a keyboard toggle", async () => {
    const { result } = await renderReady();

    act(() => result.current.toggleInstantly());

    expect(result.current.slideMotion).toBe(false);
    expect(result.current.columnExpanded).toBe(true);
    expect(result.current.panelShown).toBe(true);

    act(() => result.current.collapseInstantly());

    expect(result.current.columnExpanded).toBe(false);
    expect(result.current.panelShown).toBe(false);
  });

  it("does not slide under reduced motion", async () => {
    setMediaQueryMatches(REDUCED_MOTION_QUERY, true);
    const { result } = await renderReady();

    act(() => result.current.toggle());

    expect(result.current.columnExpanded).toBe(true);
    resetMediaQueries();
  });
});
