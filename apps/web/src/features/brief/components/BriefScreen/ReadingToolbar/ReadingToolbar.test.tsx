// @vitest-environment jsdom
// The reading toolbar (BRIEF-134): sticky control bar above the conversation
// slot. Left cluster = what's shown (Filter slot · Risk attrs · Collapse
// supporting); right cluster = where you are (group stepper · changes nav).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONVERSATION_FILTER } from "@web/features/conversation/utils/filter";
import type { ComparisonOverlayState } from "../../../comparison/comparisonOverlay";
import type { AttributeRail } from "../../../utils/viewModel";
import { ReadingToolbar, type ReadingToolbarProps } from "./ReadingToolbar";

afterEach(cleanup);

const RAIL: AttributeRail = {
  entries: [
    {
      attr: "touches-auth",
      source: "built-in",
      floor: true,
      groupIds: ["g2"],
      chunkIds: ["c2"],
    },
    {
      attr: "touches-billing",
      source: "repo-policy",
      floor: false,
      groupIds: ["g1", "g3"],
      chunkIds: ["c1", "c3"],
    },
  ],
  floorFired: true,
};

const EMPTY_RAIL: AttributeRail = { entries: [], floorFired: false };

function comparisonState(runCount: number): ComparisonOverlayState {
  return {
    compare: runCount > 0 ? "previous-brief" : "off",
    marks: null,
    source: { kind: "last-review", delta: null },
    skipReason: null,
    available: runCount > 0,
    runCount,
  };
}

function renderToolbar(overrides: Partial<ReadingToolbarProps> = {}) {
  const props: ReadingToolbarProps = {
    variant: "full",
    rail: RAIL,
    jumpToGroup: () => {},
    jumpToChunk: () => {},
    collapseSupporting: false,
    setCollapseSupporting: () => {},
    groups: [{ id: "g1" }, { id: "g2" }, { id: "g3" }],
    activeGroupId: null,
    comparison: comparisonState(0),
    ...overrides,
  };
  return render(<ReadingToolbar {...props} />);
}

describe("ReadingToolbar height publication", () => {
  it("publishes the measured height as --toolbar-h and resets it on unmount", () => {
    // ChunkCard's sticky offset rides this var: a stale value after the bar
    // unmounts (focus mode, changes view) would pin chunk headers ~45px low.
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(45);
    try {
      const { unmount } = renderToolbar();
      expect(
        document.documentElement.style.getPropertyValue("--toolbar-h"),
      ).toBe("45px");
      unmount();
      expect(
        document.documentElement.style.getPropertyValue("--toolbar-h"),
      ).toBe("0px");
    } finally {
      offsetHeight.mockRestore();
    }
  });
});

describe("ReadingToolbar clusters", () => {
  it("renders the filter disclosure when the conversation wiring provides one", () => {
    renderToolbar({
      filter: {
        filter: DEFAULT_CONVERSATION_FILTER,
        verdicts: [{ state: "APPROVED", humanCount: 2, botCount: 0 }],
        reviewers: [{ login: "alice", isBot: false }],
        hiddenInlineThreads: 0,
        onChange: () => {},
      },
    });
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
  });

  it("renders no filter surface at all without the wiring (local path)", () => {
    renderToolbar();
    expect(screen.queryByRole("button", { name: /Filter/ })).toBeNull();
  });

  it("omits the Risk attrs trigger entirely when no attribute fired", () => {
    renderToolbar({ rail: EMPTY_RAIL });
    expect(screen.queryByRole("button", { name: /Risk attrs/ })).toBeNull();
  });

  it("changes nav renders only when a comparison is active with runs", () => {
    renderToolbar({ comparison: comparisonState(0) });
    expect(screen.queryByRole("button", { name: "Next change" })).toBeNull();
    cleanup();
    renderToolbar({ comparison: comparisonState(3) });
    expect(screen.getByRole("button", { name: "Next change" })).toBeTruthy();
    expect(screen.getByText(/3 changes/)).toBeTruthy();
  });
});

describe("ReadingToolbar collapse-supporting toggle", () => {
  it("is an aria-pressed toggle button reflecting the current state", () => {
    const set = vi.fn();
    renderToolbar({ collapseSupporting: false, setCollapseSupporting: set });
    const toggle = screen.getByRole("button", { name: /Collapse supporting/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(set).toHaveBeenCalledWith(true);
    cleanup();
    renderToolbar({ collapseSupporting: true, setCollapseSupporting: set });
    expect(
      screen
        .getByRole("button", { name: /Collapse supporting/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("ReadingToolbar risk-attrs disclosure", () => {
  it("shows the fired-attribute count and NEVER auto-opens on floor firing", () => {
    renderToolbar();
    const trigger = screen.getByRole("button", { name: /Risk attrs/ });
    expect(trigger.textContent).toContain("2");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-attribute-jump-rail]")).toBeNull();
  });

  it("floor firing renders the emphasis dot with a screen-reader expansion", () => {
    renderToolbar();
    const trigger = screen.getByRole("button", { name: /Risk attrs/ });
    expect(trigger.querySelector("[data-emphasis-dot]")).not.toBeNull();
    expect(trigger.textContent).toContain("floor attribute fired");
    cleanup();
    renderToolbar({ rail: { ...RAIL, floorFired: false } });
    expect(
      screen
        .getByRole("button", { name: /Risk attrs/ })
        .querySelector("[data-emphasis-dot]"),
    ).toBeNull();
  });

  it("opens the anchored panel; chips cycle through carrying groups in story order", () => {
    const jump = vi.fn();
    renderToolbar({ jumpToGroup: jump });
    fireEvent.click(screen.getByRole("button", { name: /Risk attrs/ }));
    expect(document.querySelector("[data-attribute-jump-rail]")).not.toBeNull();
    const billing = screen.getByRole("button", { name: /touches-billing/ });
    fireEvent.click(billing);
    fireEvent.click(billing);
    fireEvent.click(billing);
    expect(jump.mock.calls.map(([id]) => id)).toEqual(["g1", "g3", "g1"]);
  });

  it("floor chip is pinned first and repo chips carry the source variant", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: /Risk attrs/ }));
    const panel = document.querySelector("[data-attribute-jump-rail]");
    const chips = [...(panel?.querySelectorAll("button") ?? [])];
    expect(chips[0]?.textContent).toContain("touches-auth");
    expect(
      screen
        .getByText(/touches-billing/)
        .closest("[data-source]")
        ?.getAttribute("data-source"),
    ).toBe("repo-policy");
  });

  it("Escape closes the panel and returns focus to the trigger", () => {
    renderToolbar();
    const trigger = screen.getByRole("button", { name: /Risk attrs/ });
    // jsdom's click does not focus the button the way a browser does.
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // Real keyboard events target the focused element, never document —
    // useDismiss's capture-phase claim defers to an at-target listener, so
    // the pin dispatches from the trigger (focused on open).
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-attribute-jump-rail]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape with the panel open never leaks to bubble-phase shortcut listeners", () => {
    // The focus-mode exit shortcut listens on window at bubble phase
    // (useKeyboardShortcuts): dismissing the panel must consume Escape so
    // closing it cannot also exit focus mode.
    const windowSpy = vi.fn();
    window.addEventListener("keydown", windowSpy);
    try {
      renderToolbar();
      const trigger = screen.getByRole("button", { name: /Risk attrs/ });
      fireEvent.click(trigger);
      fireEvent.keyDown(trigger, { key: "Escape" });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(
        windowSpy.mock.calls.filter(([event]) => event.key === "Escape"),
      ).toHaveLength(0);
      // Control: with the panel closed, Escape reaches the window again.
      fireEvent.keyDown(trigger, { key: "Escape" });
      expect(
        windowSpy.mock.calls.filter(([event]) => event.key === "Escape"),
      ).toHaveLength(1);
    } finally {
      window.removeEventListener("keydown", windowSpy);
    }
  });

  it("focus sits on the trigger when the panel opens — never moved into the panel", () => {
    // Disclosure grammar: opening must not hijack focus; Tab is the way in
    // (FloatingFocusManager initialFocus={-1} — the default steals focus
    // into the panel in a microtask).
    renderToolbar();
    const trigger = screen.getByRole("button", { name: /Risk attrs/ });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.querySelector("[data-attribute-jump-rail]")).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("clicking outside the disclosure closes the panel", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: /Risk attrs/ }));
    fireEvent.pointerDown(document.body);
    expect(document.querySelector("[data-attribute-jump-rail]")).toBeNull();
  });
});

describe("ReadingToolbar Concerns variant (mode legality, BRIEF-134 PR 4)", () => {
  it("renders Filter + Risk attrs only — no collapse toggle, no nav cluster", () => {
    renderToolbar({
      variant: "filter-and-attrs",
      filter: {
        filter: DEFAULT_CONVERSATION_FILTER,
        verdicts: [{ state: "APPROVED", humanCount: 2, botCount: 0 }],
        reviewers: [{ login: "alice", isBot: false }],
        hiddenInlineThreads: 0,
        onChange: () => {},
      },
      comparison: comparisonState(3),
      activeGroupId: "g2",
    });
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Risk attrs/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Collapse/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next group" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next change" })).toBeNull();
  });

  it("risk-attr chips cycle through carrying CHUNKS, story order", () => {
    // ADR 0032 #11: attribute-keyed targets follow the lens — groups in
    // Story, chunks in Concerns.
    const jumpChunk = vi.fn();
    const jumpGroup = vi.fn();
    renderToolbar({
      variant: "filter-and-attrs",
      jumpToChunk: jumpChunk,
      jumpToGroup: jumpGroup,
    });
    fireEvent.click(screen.getByRole("button", { name: /Risk attrs/ }));
    const billing = screen.getByRole("button", { name: /touches-billing/ });
    expect(billing.textContent).toContain("carrying chunk 1 of 2");
    fireEvent.click(billing);
    fireEvent.click(billing);
    fireEvent.click(billing);
    expect(jumpChunk.mock.calls.map(([id]) => id)).toEqual(["c1", "c3", "c1"]);
    expect(jumpGroup).not.toHaveBeenCalled();
  });
});

describe("ReadingToolbar group stepper", () => {
  it("steps to the neighbouring group without wrapping", () => {
    const jump = vi.fn();
    renderToolbar({ jumpToGroup: jump, activeGroupId: "g2" });
    expect(screen.getByText("Group 2/3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous group" }));
    expect(jump).toHaveBeenLastCalledWith("g1");
    fireEvent.click(screen.getByRole("button", { name: "Next group" }));
    expect(jump).toHaveBeenLastCalledWith("g3");
  });

  it("clamps at the ends and lands on the first group when none is active", () => {
    const jump = vi.fn();
    renderToolbar({ jumpToGroup: jump, activeGroupId: "g1" });
    fireEvent.click(screen.getByRole("button", { name: "Previous group" }));
    expect(jump).toHaveBeenLastCalledWith("g1");
    cleanup();
    const jumpAtLast = vi.fn();
    renderToolbar({ jumpToGroup: jumpAtLast, activeGroupId: "g3" });
    fireEvent.click(screen.getByRole("button", { name: "Next group" }));
    expect(jumpAtLast).toHaveBeenLastCalledWith("g3");
    cleanup();
    const jumpFromNone = vi.fn();
    renderToolbar({ jumpToGroup: jumpFromNone, activeGroupId: null });
    expect(screen.getByText("Group –/3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next group" }));
    expect(jumpFromNone).toHaveBeenLastCalledWith("g1");
  });
});
