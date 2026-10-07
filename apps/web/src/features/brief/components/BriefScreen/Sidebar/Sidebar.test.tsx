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
import { GroupViewKinds } from "../../../utils/remainder";
import { buildBriefViewModel } from "../../../utils/viewModel";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../readingPosition";
import { Button } from "@web/components/Button";
import type { ViewportBand } from "@web/hooks/useViewportBoundary";
import { Sidebar } from ".";
import { SIDEBAR_STORAGE_KEY } from "./storage";
import { useSidebarState } from "./useSidebarState";
import type { RevisionTimelinePlan } from "../../../types";

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
  revisions?: RevisionTimelinePlan;
  /** The screen keys the Sidebar per brief; a new key remounts it. */
  sidebarKey?: string;
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
  revisions,
  sidebarKey,
}: HarnessProps) {
  const state = useSidebarState(band, true);
  return (
    <>
      <Button data-testid="outside-toggle" onClick={state.toggle}>
        toggle
      </Button>
      <Sidebar
        key={sidebarKey}
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
        revisions={revisions}
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

function makeRevisionPlan(
  current = "a",
  selectRevision: (key: string) => void = vi.fn(),
): RevisionTimelinePlan {
  return {
    view: {
      rows: [
        {
          key: "b",
          ordinal: 2,
          shortSha: "bbbbbbb",
          current: current === "b",
          newest: true,
        },
        {
          key: "a",
          ordinal: 1,
          shortSha: "aaaaaaa",
          current: current === "a",
          newest: false,
        },
      ],
    },
    selectRevision,
  };
}

/** A sidebar the test can move to another brief, as a revision pick does. */
function renderSwitchingSidebar(band: ViewportBand) {
  const store = createReadingPositionStore();
  const selectRevision = vi.fn();
  const renderTree = (current: string, pending: boolean) => (
    <ReadingPositionProvider store={store}>
      <Harness
        band={band}
        pending={pending}
        revisions={makeRevisionPlan(current, selectRevision)}
        sidebarKey={current}
      />
    </ReadingPositionProvider>
  );
  const view = render(renderTree("a", false));
  return { view, renderTree, selectRevision };
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
    const caret = trigger.querySelector('[data-icon="caret-down"]');
    expect(caret?.getAttribute("data-rotation")).toBe("90");
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
    const caret = trigger.querySelector('[data-icon="caret-down"]');
    expect(caret?.getAttribute("data-rotation")).toBe("270");
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
    if (!listRow) {
      throw new Error("no list row");
    }

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

describe("the Revisions tab", () => {
  it("sits after This PR only when the route offers revisions", () => {
    renderSidebar({ revisions: makeRevisionPlan() });
    fireEvent.click(chevron());
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["This PR", "Revisions"]);
    cleanup();

    renderSidebar();
    fireEvent.click(chevron());
    expect(screen.queryByRole("tab", { name: "Revisions" })).toBeNull();
  });

  it("remembers the tab, and falls back to This PR where none is offered", () => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "revisions" }),
    );
    renderSidebar({ revisions: makeRevisionPlan() });
    expect(
      screen
        .getByRole("tab", { name: "Revisions" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    cleanup();

    renderSidebar();
    expect(
      screen
        .getByRole("tab", { name: "This PR" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("a row picked from the sheet selects it and closes the sheet", () => {
    const revisions = makeRevisionPlan();
    renderSidebar({ band: "narrow", revisions });
    fireEvent.click(
      within(screen.getByTestId("sidebar-bar")).getByRole("button", {
        name: /sidebar/,
      }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Revisions" }));
    fireEvent.click(screen.getByRole("button", { name: /Revision 2/ }));
    expect(revisions.selectRevision).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("focus after a revision pick", () => {
  it("returns to the new current row once the next brief is live", () => {
    const { view, renderTree, selectRevision } =
      renderSwitchingSidebar("desktop");
    fireEvent.click(chevron());
    fireEvent.click(screen.getByRole("tab", { name: "Revisions" }));
    fireEvent.click(screen.getByRole("button", { name: /Revision 2/ }));
    expect(selectRevision).toHaveBeenCalledWith("b");

    view.rerender(renderTree("b", true));
    const picked = screen.getByRole("button", { name: /Revision 2/ });
    expect(document.activeElement).not.toBe(picked);

    view.rerender(renderTree("b", false));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Revision 2/ }),
    );
  });

  it("returns to the bar chevron on the narrow band", () => {
    const { view, renderTree } = renderSwitchingSidebar("narrow");
    const bar = () => screen.getByTestId("sidebar-bar");
    fireEvent.click(within(bar()).getByRole("button", { name: /sidebar/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Revisions" }));
    fireEvent.click(screen.getByRole("button", { name: /Revision 2/ }));

    view.rerender(renderTree("b", false));
    expect(document.activeElement).toBe(
      within(bar()).getByRole("button", { name: /sidebar/ }),
    );
  });

  it("leaves focus alone when no revision was picked", () => {
    const { view, renderTree } = renderSwitchingSidebar("desktop");
    const outside = screen.getByTestId("outside-toggle");
    outside.focus();
    view.rerender(renderTree("b", false));
    expect(document.activeElement).toBe(outside);
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
    const columns = control.querySelector('[data-icon="columns"]');
    expect(columns?.getAttribute("data-rotation")).toBe("90");
  });

  it("offers the split view, upright, while unified", () => {
    renderSidebar();
    const control = screen.getByRole("button", {
      name: "Switch to split view",
    });
    expect(control.getAttribute("data-target")).toBe("split");
    const columns = control.querySelector('[data-icon="columns"]');
    expect(columns?.hasAttribute("data-rotation")).toBe(false);
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
