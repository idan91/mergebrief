// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";

import { DEFAULT_CONVERSATION_FILTER } from "@web/features/conversation/utils";
import type { ComparisonOverlayState } from "../../../../model/comparison/comparison-overlay";
import type { AttributeRail } from "../../../../model/utils/view-model";
import { useRiskAttrCycle } from "../hooks/useRiskAttrCycle";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../reading/reading-position";
import { createBriefViewStore } from "../store";
import { ReadingToolbar, type ReadingToolbarProps } from ".";

afterEach(() => {
  cleanup();
  resetMediaQueries();
});

beforeEach(() => {
  setMediaQueryMatches("(prefers-reduced-motion: reduce)", true);
});

const RAIL: AttributeRail = {
  entries: [
    {
      attr: "touches-auth",
      source: "built-in",
      floor: true,
      groupIds: ["g2"],
    },
    {
      attr: "touches-billing",
      source: "repo-policy",
      floor: false,
      groupIds: ["g1", "g3"],
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

type ToolbarHostProps = Omit<ReadingToolbarProps, "riskAttrCycle">;

/** The toolbar with the per-Brief cycle owner the screen gives it. */
function ToolbarHost(props: ToolbarHostProps) {
  const [viewStore] = useState(() =>
    createBriefViewStore({ openChunkIds: [], focusMode: false }),
  );
  const riskAttrCycle = useRiskAttrCycle(viewStore, true);
  return <ReadingToolbar {...props} riskAttrCycle={riskAttrCycle} />;
}

function renderToolbar(
  overrides: Partial<ToolbarHostProps> = {},
  activeGroupId: string | null = null,
) {
  const props: ToolbarHostProps = {
    rail: RAIL,
    jumpToGroup: () => {},
    supportingCollapse: "none",
    toggleCollapseSupporting: () => {},
    comparison: comparisonState(0),
    revisionNav: { jumpNext: () => undefined, jumpPrev: () => undefined },
    ...overrides,
  };
  const store = createReadingPositionStore();
  if (activeGroupId !== null) {
    store.getState().actions.setActive(`${activeGroupId}-c1`, activeGroupId);
  }
  return render(
    <ReadingPositionProvider store={store}>
      <ToolbarHost {...props} />
    </ReadingPositionProvider>,
  );
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
  it("renders the filter disclosure when the wiring provides one", () => {
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

  it("renders no filter surface at all without the wiring", () => {
    renderToolbar();
    expect(screen.queryByRole("button", { name: /Filter/ })).toBeNull();
  });

  it("omits the Risk attrs trigger entirely when no attribute fired", () => {
    renderToolbar({ rail: EMPTY_RAIL });
    expect(
      screen.queryByRole("button", { name: /Risk attributes/ }),
    ).toBeNull();
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
  it("maps the derived state onto aria-pressed, including mixed", () => {
    const toggle = vi.fn();
    renderToolbar({
      supportingCollapse: "none",
      toggleCollapseSupporting: toggle,
    });
    const button = screen.getByRole("button", { name: /Collapse supporting/ });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
    cleanup();
    renderToolbar({ supportingCollapse: "all" });
    expect(
      screen
        .getByRole("button", { name: /Collapse supporting/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    cleanup();
    // Some supporting chunks manually expanded while collapsed: the control
    // reports the intermediate state instead of lying about either pole.
    renderToolbar({ supportingCollapse: "some" });
    expect(
      screen
        .getByRole("button", { name: /Collapse supporting/ })
        .getAttribute("aria-pressed"),
    ).toBe("mixed");
  });
});

describe("ReadingToolbar risk-attrs disclosure", () => {
  it("shows the fired-attribute count and NEVER auto-opens on floor firing", () => {
    renderToolbar();
    const trigger = screen.getByRole("button", { name: /Risk attributes/ });
    expect(trigger.textContent).toContain("2");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-attribute-jump-rail]")).toBeNull();
  });

  it("floor firing renders the emphasis dot with a screen-reader expansion", () => {
    renderToolbar();
    const trigger = screen.getByRole("button", { name: /Risk attributes/ });
    expect(trigger.querySelector("[data-emphasis-dot]")).not.toBeNull();
    expect(trigger.textContent).toContain("floor attribute fired");
    cleanup();
    renderToolbar({ rail: { ...RAIL, floorFired: false } });
    expect(
      screen
        .getByRole("button", { name: /Risk attributes/ })
        .querySelector("[data-emphasis-dot]"),
    ).toBeNull();
  });

  it("opens the anchored panel, chips cycle carrying groups in order", () => {
    const jump = vi.fn();
    renderToolbar({ jumpToGroup: jump });
    fireEvent.click(screen.getByRole("button", { name: /Risk attributes/ }));
    expect(document.querySelector("[data-attribute-jump-rail]")).not.toBeNull();
    const billing = screen.getByRole("button", { name: /Touches billing/ });
    fireEvent.click(billing);
    fireEvent.click(billing);
    fireEvent.click(billing);
    expect(jump.mock.calls.map(([id]) => id)).toEqual(["g1", "g3", "g1"]);
  });

  it("floor chip is pinned first and repo chips carry the source variant", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: /Risk attributes/ }));
    const panel = document.querySelector("[data-attribute-jump-rail]");
    const chips = [...(panel?.querySelectorAll("button") ?? [])];
    expect(chips[0]?.textContent).toContain("Touches auth");
    expect(
      screen
        .getByText(/Touches billing/)
        .closest("[data-source]")
        ?.getAttribute("data-source"),
    ).toBe("repo-policy");
  });
});

describe("ReadingToolbar read-through entry", () => {
  it("starts the read-through from the nav cluster, ahead of collapse", () => {
    const startReadThrough = vi.fn();
    renderToolbar({ startReadThrough });
    const button = screen.getByRole("button", { name: /Start read-through/ });
    const collapse = screen.getByRole("button", {
      name: /Collapse supporting/,
    });
    const precedesCollapse =
      button.compareDocumentPosition(collapse) &
      Node.DOCUMENT_POSITION_FOLLOWING;

    expect(button.parentElement).toBe(collapse.parentElement);
    expect(precedesCollapse).toBeTruthy();
    fireEvent.click(button);
    expect(startReadThrough).toHaveBeenCalledOnce();
  });

  it("offers no read-through entry when the screen withholds it", () => {
    renderToolbar();
    expect(
      screen.queryByRole("button", { name: /Start read-through/ }),
    ).toBeNull();
  });
});
