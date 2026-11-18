// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";

import {
  DEFAULT_CONVERSATION_FILTER,
  parseConversationFilter,
  type ConversationFilter,
} from "@web/features/conversation/utils";
import { FilterDisclosure, type FilterDisclosureProps } from ".";

afterEach(() => {
  cleanup();
  resetMediaQueries();
});

beforeEach(() => {
  setMediaQueryMatches("(prefers-reduced-motion: reduce)", true);
});

const VERDICTS = [
  { state: "APPROVED", humanCount: 2, botCount: 1 },
  { state: "CHANGES_REQUESTED", humanCount: 1, botCount: 0 },
] as const;

const REVIEWERS = [
  { login: "alice", isBot: false },
  { login: "bob", isBot: false },
] as const;

function renderDisclosure(overrides: Partial<FilterDisclosureProps> = {}) {
  const onChange = vi.fn<(next: ConversationFilter) => void>();
  const props: FilterDisclosureProps = {
    filter: DEFAULT_CONVERSATION_FILTER,
    verdicts: [...VERDICTS],
    reviewers: [...REVIEWERS],
    hiddenInlineThreads: 0,
    onChange,
    ...overrides,
  };
  const view = render(<FilterDisclosure {...props} />);
  return { onChange, view };
}

describe("FilterDisclosure trigger", () => {
  it("reads plain Filter while inactive, with no counts riding along", () => {
    renderDisclosure();
    const trigger = screen.getByRole("button", { name: /^Filter/ });
    expect(trigger.textContent).toBe("Filter");
    expect(trigger.getAttribute("data-state")).toBe("inactive");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("carries the active receipt, families then the hidden count last", () => {
    renderDisclosure({
      filter: parseConversationFilter({
        verdicts: "approved",
        reviewers: "alice,bob",
      }),
      hiddenInlineThreads: 4,
    });
    const trigger = screen.getByRole("button", { name: /Filter/ });
    expect(trigger.getAttribute("data-state")).toBe("active");
    expect(trigger.textContent).toContain("1 verdict");
    expect(trigger.textContent).toContain("2 reviewers");
    expect(trigger.textContent).toContain("4 hidden");
    // The hidden count gets a screen-reader referent, because "4 hidden" has
    // none when read from the trigger.
    expect(trigger.textContent).toContain("threads in the diff");
  });

  it("renders nothing at all when no family exists and nothing is filtered", () => {
    renderDisclosure({ verdicts: [], reviewers: [] });
    expect(screen.queryByRole("button", { name: /Filter/ })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("still renders for an active filter whose facets emptied", () => {
    // The selected state must keep a control that can unpress it.
    renderDisclosure({
      filter: parseConversationFilter({ verdicts: "commented" }),
      verdicts: [],
      reviewers: [],
    });
    expect(screen.getByRole("button", { name: /Filter/ })).not.toBeNull();
  });
});

describe("FilterDisclosure panel", () => {
  it("opens the filter panel anchored off the trigger and toggles closed", () => {
    renderDisclosure();
    const trigger = screen.getByRole("button", { name: /^Filter/ });
    expect(screen.queryByTestId("conversation-filter-panel")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).not.toBeNull();
    expect(screen.getByTestId("conversation-filter-panel")).not.toBeNull();
    fireEvent.click(trigger);
    expect(screen.queryByTestId("conversation-filter-panel")).toBeNull();
  });

  it("stays open across chip clicks because filtering is iterative", () => {
    const { onChange } = renderDisclosure();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    fireEvent.click(screen.getByRole("button", { name: /Approved/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("conversation-filter-panel")).not.toBeNull();
  });

  it("Escape closes the panel at capture and returns focus to the trigger", () => {
    // Capture-phase consumption: the same Escape must not also fire global
    // shortcuts.
    const bubbleListener = vi.fn();
    document.addEventListener("keydown", bubbleListener);
    try {
      renderDisclosure();
      const trigger = screen.getByRole("button", { name: /^Filter/ });
      // jsdom's click does not focus the button the way a browser does.
      trigger.focus();
      fireEvent.click(trigger);
      // Real keyboard events target the focused element, never document,
      // useDismiss's capture-phase claim defers to an at-target listener,
      // so the pin dispatches from the trigger (focused on open).
      fireEvent.keyDown(trigger, { key: "Escape" });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByTestId("conversation-filter-panel")).toBeNull();
      expect(document.activeElement).toBe(trigger);
      expect(bubbleListener).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", bubbleListener);
    }
  });
});

describe("FilterDisclosure live region", () => {
  it("mounts the status region always, so the first count is an update", () => {
    const { view } = renderDisclosure();
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    view.rerender(
      <FilterDisclosure
        filter={parseConversationFilter({ reviewers: "alice" })}
        verdicts={[...VERDICTS]}
        reviewers={[...REVIEWERS]}
        hiddenInlineThreads={3}
        onChange={() => {}}
      />,
    );
    expect(status.textContent).toBe("3 threads hidden in the diff");
  });

  it("speaks only while filtering actually hides inline threads", () => {
    renderDisclosure({ hiddenInlineThreads: 3 });
    // Inactive filter: the count is stale context, not an announcement.
    expect(screen.getByRole("status").textContent).toBe("");
    cleanup();
    renderDisclosure({
      filter: parseConversationFilter({ reviewers: "alice" }),
      hiddenInlineThreads: 1,
    });
    expect(screen.getByRole("status").textContent).toBe(
      "1 thread hidden in the diff",
    );
  });
});
