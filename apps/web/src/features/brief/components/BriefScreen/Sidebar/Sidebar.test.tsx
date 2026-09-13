// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import { briefFixture } from "@web/features/brief/fixtures";
import { buildBriefViewModel, GroupViewKinds } from "../../../utils/viewModel";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../readingPosition";
import { Button } from "@web/components/Button/Button";
import type { ViewportBand } from "@web/hooks/useViewportBoundary";
import { Sidebar } from "./Sidebar";
import { SIDEBAR_STORAGE_KEY } from "./storage";
import { useSidebarState } from "./useSidebarState";

const model = buildBriefViewModel(briefFixture);
const firstGroup = model.groups[0];
if (!firstGroup || firstGroup.kind !== GroupViewKinds.ATTRIBUTED) {
  throw new Error("fixture has no attributed group");
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

interface HarnessProps {
  jumpToGroup?: (groupId: string) => void;
  jumpToGroupHeading?: (groupId: string) => void;
  toggleShortcuts?: () => void;
  conversationGroupIds?: ReadonlySet<string>;
  band?: ViewportBand;
  pending?: boolean;
  diffView?: DiffView;
  toggleDiffView?: () => void;
  /** False renders the foot without the split view control. */
  diffToggleWired?: boolean;
}

function noop(): void {}

function Harness({
  jumpToGroup = noop,
  jumpToGroupHeading = noop,
  toggleShortcuts = noop,
  conversationGroupIds,
  band = "desktop",
  pending = false,
  diffView = DiffViews.UNIFIED,
  toggleDiffView = noop,
  diffToggleWired = true,
}: HarnessProps) {
  const state = useSidebarState(band, true);
  return (
    <>
      <Button data-testid="outside-toggle" onClick={state.toggle}>
        toggle
      </Button>
      <Sidebar
        band={band}
        conversationGroupIds={conversationGroupIds}
        groups={model.groups}
        jumpToGroup={jumpToGroup}
        jumpToGroupHeading={jumpToGroupHeading}
        pending={pending}
        state={state}
        toggleShortcuts={toggleShortcuts}
        diffView={diffView}
        toggleDiffView={diffToggleWired ? toggleDiffView : undefined}
      />
    </>
  );
}

function renderSidebar(
  props: HarnessProps = {},
  activeGroupId: string | null = null,
) {
  const store = createReadingPositionStore();
  if (activeGroupId !== null) {
    const chunkId =
      model.groups.find((group) => group.id === activeGroupId)?.chunks[0]?.id ??
      "unknown";
    store.getState().actions.setActive(chunkId, activeGroupId);
  }
  return render(
    <ReadingPositionProvider store={store}>
      <Harness {...props} />
    </ReadingPositionProvider>,
  );
}

function chevron(): HTMLElement {
  return screen.getByRole("button", { name: /sidebar/ });
}

describe("Sidebar", () => {
  it("is a named complementary landmark holding the group lines", () => {
    renderSidebar();
    const aside = screen.getByRole("complementary", { name: "Sidebar" });
    expect(aside.getAttribute("data-state")).toBe("collapsed");
    expect(
      screen.getByRole("navigation", { name: "Change groups" }),
    ).toBeTruthy();
  });

  it("starts collapsed with the panel hidden and the chevron wired to it", () => {
    renderSidebar();
    const trigger = chevron();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId ?? "")?.hidden).toBe(true);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("expands from the chevron, keeps focus on it, and writes the preference", () => {
    renderSidebar();
    const trigger = chevron();
    trigger.focus();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-label")).toBe("Collapse sidebar");
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("tablist", { name: "Sidebar tabs" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "This PR" })).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    expect(
      JSON.parse(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) ?? ""),
    ).toEqual({
      expanded: true,
      tab: "this-pr",
    });
  });

  it("restores a stored expanded preference at mount", () => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "this-pr" }),
    );
    renderSidebar();
    expect(chevron().getAttribute("aria-expanded")).toBe("true");
  });

  it("Escape in the expanded sidebar collapses it and returns focus", () => {
    const windowListener = vi.fn();
    window.addEventListener("keydown", windowListener);
    renderSidebar();
    fireEvent.click(chevron());
    const tab = screen.getByRole("tab", { name: "This PR" });
    tab.focus();

    fireEvent.keyDown(tab, { key: "Escape" });

    expect(chevron().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(chevron());
    expect(windowListener).not.toHaveBeenCalled();
    window.removeEventListener("keydown", windowListener);
  });

  it("lets Escape through while collapsed", () => {
    const windowListener = vi.fn();
    window.addEventListener("keydown", windowListener);
    renderSidebar();

    fireEvent.keyDown(chevron(), { key: "Escape" });

    expect(windowListener).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", windowListener);
  });

  it("a keyboard-activated row takes the heading landing and never collapses", () => {
    const jumpToGroup = vi.fn();
    const jumpToGroupHeading = vi.fn();
    renderSidebar({ jumpToGroup, jumpToGroupHeading });
    fireEvent.click(chevron());
    const rowName = firstGroup.group.title || firstGroup.group.summary;
    const row = screen.getAllByRole("button", { name: new RegExp(rowName) });
    const listRow = row.find((candidate) => candidate.closest("li") !== null);
    if (!listRow) throw new Error("no list row");

    fireEvent.click(listRow, { detail: 0 });

    expect(jumpToGroupHeading).toHaveBeenCalledWith(firstGroup.id);
    expect(jumpToGroup).not.toHaveBeenCalled();
    expect(chevron().getAttribute("aria-expanded")).toBe("true");
  });

  it("a pointer click on a line takes the plain jump", () => {
    const jumpToGroup = vi.fn();
    const jumpToGroupHeading = vi.fn();
    renderSidebar({ jumpToGroup, jumpToGroupHeading });
    const rowName = firstGroup.group.title || firstGroup.group.summary;

    fireEvent.click(screen.getByRole("button", { name: rowName }), {
      detail: 1,
    });

    expect(jumpToGroup).toHaveBeenCalledWith(firstGroup.id);
    expect(jumpToGroupHeading).not.toHaveBeenCalled();
  });

  it("a collapse the sidebar did not start returns focus to the chevron", () => {
    renderSidebar();
    fireEvent.click(chevron());
    const tab = screen.getByRole("tab", { name: "This PR" });
    tab.focus();

    fireEvent.click(screen.getByTestId("outside-toggle"));

    expect(chevron().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(chevron());
  });

  it("a collapse with focus elsewhere leaves focus alone", () => {
    renderSidebar();
    fireEvent.click(chevron());
    const outside = screen.getByTestId("outside-toggle");
    outside.focus();

    fireEvent.click(outside);

    expect(chevron().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(outside);
  });

  it("goes inert while a revision load is pending", () => {
    renderSidebar({ pending: true });
    expect(
      screen.getByRole("complementary", { hidden: true }).hasAttribute("inert"),
    ).toBe(true);
  });

  it("marks the current group in both the lines and the list", () => {
    renderSidebar({}, firstGroup.id);
    fireEvent.click(chevron());
    const rowName = firstGroup.group.title || firstGroup.group.summary;
    const current = screen
      .getAllByRole("button", { name: new RegExp(rowName) })
      .filter((candidate) => candidate.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(2);
  });

  it("scroll-to-top scrolls the window and ? toggles the shortcuts", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const toggleShortcuts = vi.fn();
    renderSidebar({ toggleShortcuts });

    fireEvent.click(screen.getByRole("button", { name: "Scroll to top" }));
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(toggleShortcuts).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("gates its motion on a frame after mount", async () => {
    let frameCallback: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameCallback = callback;
      return 1;
    });
    renderSidebar();
    const aside = screen.getByRole("complementary");
    expect(aside.getAttribute("data-motion")).toBeNull();

    await act(async () => {
      frameCallback?.(0);
    });

    expect(aside.getAttribute("data-motion")).toBe("on");
  });
});

describe("Sidebar below the tablet breakpoint", () => {
  function chevronNarrow(): HTMLElement {
    return within(screen.getByTestId("sidebar-bar")).getByRole("button", {
      name: /sidebar/,
    });
  }

  it("renders the bar inside the landmark with no sheet", () => {
    renderSidebar({ band: "narrow" });
    const aside = screen.getByRole("complementary", { name: "Sidebar" });
    expect(aside.getAttribute("data-variant")).toBe("narrow");
    expect(screen.getByTestId("sidebar-bar")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("starts collapsed even when the stored preference is expanded", () => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "this-pr" }),
    );
    renderSidebar({ band: "narrow" });
    expect(chevronNarrow().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the chevron opens the sheet on the active tab, Escape returns focus", () => {
    const windowListener = vi.fn();
    window.addEventListener("keydown", windowListener);
    renderSidebar({ band: "narrow" });

    fireEvent.click(chevronNarrow());

    const dialog = screen.getByRole("dialog", { name: "Sidebar" });
    const tab = screen.getByRole("tab", { name: "This PR" });
    expect(document.activeElement).toBe(tab);
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(chevronNarrow());
    expect(document.body.style.overflow).toBe("");
    expect(windowListener).not.toHaveBeenCalled();
    window.removeEventListener("keydown", windowListener);
  });

  it("the scrim and the chevron close the sheet back to the chevron", () => {
    renderSidebar({ band: "narrow" });
    fireEvent.click(chevronNarrow());
    fireEvent.click(
      screen.getAllByRole("button", { name: "Collapse sidebar" })[0]!,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(chevronNarrow());

    fireEvent.click(chevronNarrow());
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(chevronNarrow());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a jump from the sheet collapses it and returns focus by input kind", () => {
    const jumpToGroup = vi.fn();
    const jumpToGroupHeading = vi.fn();
    renderSidebar({ band: "narrow", jumpToGroup, jumpToGroupHeading });
    const rowName = firstGroup.group.title || firstGroup.group.summary;

    fireEvent.click(chevronNarrow());
    fireEvent.click(screen.getByRole("button", { name: new RegExp(rowName) }), {
      detail: 1,
    });
    expect(jumpToGroup).toHaveBeenCalledWith(firstGroup.id);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(chevronNarrow());

    fireEvent.click(chevronNarrow());
    fireEvent.click(screen.getByRole("button", { name: new RegExp(rowName) }), {
      detail: 0,
    });
    expect(jumpToGroupHeading).toHaveBeenCalledWith(firstGroup.id);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a close the sidebar did not start still returns focus to the chevron", () => {
    renderSidebar({ band: "narrow" });
    fireEvent.click(chevronNarrow());
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "This PR" }),
    );

    fireEvent.click(screen.getByTestId("outside-toggle"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(chevronNarrow());
  });

  it("never writes the sheet state", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderSidebar({ band: "narrow" });
    fireEvent.click(chevronNarrow());
    fireEvent.click(chevronNarrow());
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("the split view control", () => {
  it("offers the unified view, turned a quarter, while split", () => {
    renderSidebar({ diffView: DiffViews.SPLIT });
    const control = screen.getByRole("button", {
      name: "Switch to unified view",
    });
    expect(control.getAttribute("data-target")).toBe("unified");
  });

  it("offers the split view, upright, while unified", () => {
    renderSidebar();
    const control = screen.getByRole("button", {
      name: "Switch to split view",
    });
    expect(control.getAttribute("data-target")).toBe("split");
  });

  it("asks for the other view on click", () => {
    const toggleDiffView = vi.fn();
    renderSidebar({ toggleDiffView });

    fireEvent.click(screen.getByTestId("sidebar-diff-view"));

    expect(toggleDiffView).toHaveBeenCalledTimes(1);
  });

  it("stays out of the foot where rows cannot split", () => {
    renderSidebar({ diffToggleWired: false });
    expect(screen.queryByTestId("sidebar-diff-view")).toBeNull();
  });
});
