// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ViewportBand } from "@web/hooks/useViewportBoundary";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { REDUCED_MOTION_QUERY } from "@web/utils/motion";
import { SIDEBAR_OVERLAY_QUERY } from "./consts";
import { clearPreferenceCookie } from "@web/utils/preference-cookie";
import {
  LEGACY_SIDEBAR_STORAGE_KEY,
  readSidebarPreference,
  SIDEBAR_COOKIE,
  SIDEBAR_OVERLAY_COOKIE,
  writeSidebarPreference,
} from "./storage";
import { useSidebarState } from "./useSidebarState";

afterEach(() => {
  // Every hook here is rendered, and nothing auto-unmounts: a hook left
  // mounted past the file lets React flush scheduled work after the jsdom
  // window is gone, which surfaces as an unhandled `window is not defined`.
  cleanup();
  clearPreferenceCookie(SIDEBAR_COOKIE);
  clearPreferenceCookie(SIDEBAR_OVERLAY_COOKIE);
  window.localStorage.clear();
});

function stored(): unknown {
  return readSidebarPreference();
}

describe("useSidebarState at narrow width", () => {
  it("starts collapsed whatever is stored and never writes the sheet state", () => {
    writeSidebarPreference({ expanded: true, tab: "this-pr" });
    const { result } = renderHook(() =>
      useSidebarState("narrow", true, "brief-a"),
    );
    expect(result.current.expanded).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);

    act(() => result.current.collapse());
    expect(result.current.expanded).toBe(false);
    expect(stored()).toEqual({ expanded: true, tab: "this-pr" });
  });

  it("writes the tab and keeps the stored expanded value", () => {
    writeSidebarPreference({ expanded: true, tab: "this-pr" });
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
    writeSidebarPreference({ expanded: true, tab: "this-pr" });
    const writes = vi.spyOn(document, "cookie", "set");

    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    expect(result.current.expanded).toBe(true);
    expect(result.current.tab).toBe("this-pr");
    const preferenceWrites = writes.mock.calls.filter(([cookie]) =>
      cookie.startsWith(`${SIDEBAR_COOKIE}=`),
    );
    expect(preferenceWrites).toEqual([]);
  });

  it("opens from the first render where the stored sidebar is open", () => {
    writeSidebarPreference({ expanded: true, tab: "revisions" });
    const renders: boolean[] = [];

    renderHook(() => {
      const state = useSidebarState("desktop", true, "brief-a");
      renders.push(state.expanded);
      return state;
    });

    expect(renders[0]).toBe(true);
  });

  it("adopts a preference stored before the cookie", () => {
    window.localStorage.setItem(
      LEGACY_SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "revisions" }),
    );

    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    expect(result.current.expanded).toBe(true);
    expect(result.current.tab).toBe("revisions");
    expect(stored()).toEqual({ expanded: true, tab: "revisions" });
    expect(window.localStorage.getItem(LEGACY_SIDEBAR_STORAGE_KEY)).toBeNull();
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
});

describe("useSidebarState on a load in the overlay range", () => {
  afterEach(resetMediaQueries);

  function storeOpen() {
    writeSidebarPreference({ expanded: true, tab: "this-pr" });
  }

  it("starts collapsed at 1440px though the stored sidebar is open", () => {
    storeOpen();
    setMediaQueryMatches(SIDEBAR_OVERLAY_QUERY, true);

    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    expect(result.current.expanded).toBe(false);
    expect(stored()).toEqual({ expanded: true, tab: "this-pr" });
  });

  it("renders closed from the first render once a load found the overlay", () => {
    storeOpen();
    setMediaQueryMatches(SIDEBAR_OVERLAY_QUERY, true);
    const first = renderHook(() => useSidebarState("desktop", true, "brief-a"));
    first.unmount();
    const renders: boolean[] = [];

    renderHook(() => {
      const state = useSidebarState("desktop", true, "brief-a");
      renders.push(state.expanded);
      return state;
    });

    expect(renders).not.toContain(true);
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
  function waitForFrame(): Promise<void> {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  // A slide is only named a frame after the stored preference is applied.
  async function renderReady() {
    const rendered = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );
    await act(waitForFrame);
    return rendered;
  }

  it("names the slide only while one runs, so a remount never slides", async () => {
    const { result } = await renderReady();
    expect(result.current.slide).toBeUndefined();

    act(() => result.current.toggle());
    expect(result.current.slide).toBe("in");

    await waitFor(() => expect(result.current.slide).toBeUndefined());
  });

  it("opens the column with the panel, in the same render", async () => {
    const { result } = await renderReady();

    act(() => result.current.toggle());

    expect(result.current.expanded).toBe(true);
    expect(result.current.panelShown).toBe(true);
    expect(result.current.slide).toBe("in");
  });

  it("keeps the panel shown until it has slid out", async () => {
    const { result } = await renderReady();
    act(() => result.current.toggleInstantly());

    act(() => result.current.toggle());

    expect(result.current.expanded).toBe(false);
    expect(result.current.slide).toBe("out");
    expect(result.current.panelShown).toBe(true);
    await waitFor(() => expect(result.current.panelShown).toBe(false));
    expect(result.current.slide).toBeUndefined();
  });

  it("never slides on a keyboard toggle", async () => {
    const { result } = await renderReady();

    act(() => result.current.toggleInstantly());

    expect(result.current.slide).toBeUndefined();
    expect(result.current.expanded).toBe(true);
    expect(result.current.panelShown).toBe(true);

    act(() => result.current.collapseInstantly());

    expect(result.current.slide).toBeUndefined();
    expect(result.current.panelShown).toBe(false);
  });

  it("does not slide before the first frame after mount", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const { result } = renderHook(() =>
      useSidebarState("desktop", true, "brief-a"),
    );

    act(() => result.current.toggle());

    expect(result.current.expanded).toBe(true);
    expect(result.current.slide).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("does not slide under reduced motion", async () => {
    setMediaQueryMatches(REDUCED_MOTION_QUERY, true);
    const { result } = await renderReady();

    act(() => result.current.toggle());

    expect(result.current.expanded).toBe(true);
    expect(result.current.slide).toBeUndefined();
    resetMediaQueries();
  });
});
