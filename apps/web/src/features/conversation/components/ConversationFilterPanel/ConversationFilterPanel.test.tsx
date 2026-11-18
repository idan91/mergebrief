// @vitest-environment jsdom
// The filter UI as anchored-panel content: chips are aria-pressed toggle
// buttons carrying text, counts split human/bot, and All/None act on the
// reviewer family only. The trigger, the hidden-thread receipt and the live
// region belong to the disclosure wrapper, not here.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CONVERSATION_FILTER,
  parseConversationFilter,
  type ConversationFilter,
} from "../../utils/filter";
import { ConversationFilterPanel, type ConversationFilterPanelProps } from ".";

const VERDICTS = [
  { state: "APPROVED", humanCount: 2, botCount: 1 },
  { state: "CHANGES_REQUESTED", humanCount: 1, botCount: 0 },
] as const;

const REVIEWERS = [
  { login: "alice", isBot: false },
  { login: "bob", isBot: false },
  { login: "checkbot", isBot: true },
] as const;

function renderPanel(overrides: Partial<ConversationFilterPanelProps> = {}) {
  const onChange = vi.fn<(next: ConversationFilter) => void>();
  const props: ConversationFilterPanelProps = {
    filter: DEFAULT_CONVERSATION_FILTER,
    verdicts: [...VERDICTS],
    reviewers: [...REVIEWERS],
    onChange,
    ...overrides,
  };
  render(<ConversationFilterPanel {...props} />);
  return { onChange, props };
}

describe("ConversationFilterPanel", () => {
  it("renders verdict chips with human counts and a bot secondary", () => {
    renderPanel();
    const approved = screen.getByRole("button", { name: /Approved/ });
    expect(approved.textContent).toContain("Approved");
    expect(approved.textContent).toContain("2");
    expect(approved.textContent).toContain("1 bot");
    // Zero bots means no visible bot secondary, only the sr-only sentence
    // mentions bots at all.
    expect(
      screen.getByRole("button", { name: /Changes requested/ }).textContent,
    ).not.toContain("0 bot;");
  });

  it("marks selection with aria-pressed, not colour alone", () => {
    const filter = parseConversationFilter({ verdicts: "approved" });
    renderPanel({ filter });
    expect(
      screen
        .getByRole("button", { name: /Approved/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /Changes requested/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("toggles a verdict and a reviewer through onChange", () => {
    const { onChange } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Approved/ }));
    const afterVerdict = onChange.mock.calls[0]?.[0];
    if (afterVerdict === undefined) {
      throw new Error("no verdict change");
    }
    expect([...afterVerdict.verdicts]).toEqual(["APPROVED"]);

    fireEvent.click(screen.getByRole("button", { name: /@alice/ }));
    const afterReviewer = onChange.mock.calls[1]?.[0];
    if (afterReviewer === undefined) {
      throw new Error("no reviewer change");
    }
    expect([...afterReviewer.reviewers]).toEqual(["alice"]);
  });

  it("tags bot reviewers and keeps them selectable", () => {
    const { onChange } = renderPanel();
    const bot = screen.getByRole("button", { name: /@checkbot/ });
    expect(bot.textContent).toContain("Bot");
    fireEvent.click(bot);
    const next = onChange.mock.calls[0]?.[0];
    if (next === undefined) {
      throw new Error("no change reported");
    }
    expect([...next.reviewers]).toEqual(["checkbot"]);
  });

  it("All selects every reviewer and None clears the family, digest kept", () => {
    const { onChange } = renderPanel({
      filter: parseConversationFilter({ reviewers: "alice" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    const all = onChange.mock.calls[0]?.[0];
    if (all === undefined) {
      throw new Error("no All change");
    }
    expect([...all.reviewers]).toEqual(["alice", "bob", "checkbot"]);

    fireEvent.click(screen.getByRole("button", { name: "None" }));
    const none = onChange.mock.calls[1]?.[0];
    if (none === undefined) {
      throw new Error("no None change");
    }
    expect(none.reviewers.size).toBe(0);
  });

  it("marks All/None spent with aria-disabled and no-ops them, keeping focus", () => {
    // `disabled` would blur the control the moment it is used: these two
    // disable themselves ON click, so the attribute is aria-only.
    const { onChange } = renderPanel();
    const none = screen.getByRole("button", { name: "None" });
    expect(none.getAttribute("aria-disabled")).toBe("true");
    expect(none.hasAttribute("disabled")).toBe(false);
    fireEvent.click(none);
    expect(onChange).not.toHaveBeenCalled();
    cleanup();

    renderPanel({
      filter: parseConversationFilter({
        reviewers: "alice,bob,checkbot",
      }),
    });
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("keeps a selected chip when the other family zeroes its count", () => {
    // Otherwise the only control that could unpress it disappears.
    renderPanel({
      filter: parseConversationFilter({ verdicts: "commented" }),
      verdicts: [],
    });
    const chip = screen.getByRole("button", { name: /^Commented/ });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("checkbox", { name: /only each reviewer's latest/i }),
    ).not.toBeNull();
  });

  it("drops the chip list entirely when it has no chips", () => {
    renderPanel({ verdicts: [] });
    expect(screen.queryByRole("button", { name: /^Approved/ })).toBeNull();
    expect(screen.getByRole("button", { name: /@alice/ })).not.toBeNull();
    // The global toggle survives: it is not a verdict control.
    expect(
      screen.getByRole("checkbox", { name: /only each reviewer's latest/i }),
    ).not.toBeNull();
  });

  it("defaults the recency toggle on and reports flips", () => {
    const { onChange } = renderPanel();
    const toggle = screen.getByRole("checkbox", {
      name: /only each reviewer's latest/i,
    });
    if (!(toggle instanceof HTMLInputElement)) {
      throw new Error("not a checkbox");
    }
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    const next = onChange.mock.calls[0]?.[0];
    if (next === undefined) {
      throw new Error("no change reported");
    }
    expect(next.latestOnly).toBe(false);
  });

  it("offers a clear control that keeps an opted-into full history", () => {
    const { onChange } = renderPanel({
      filter: parseConversationFilter({ reviewers: "alice", reviews: "all" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    const next = onChange.mock.calls[0]?.[0];
    if (next === undefined) {
      throw new Error("no change reported");
    }
    expect(next.reviewers.size).toBe(0);
    expect(next.latestOnly).toBe(false);
  });

  it("marks Clear spent with aria-disabled and no-ops it while inactive", () => {
    const { onChange } = renderPanel();
    const clear = screen.getByRole("button", { name: "Clear filters" });
    expect(clear.getAttribute("aria-disabled")).toBe("true");
    expect(clear.hasAttribute("disabled")).toBe(false);
    fireEvent.click(clear);
    expect(onChange).not.toHaveBeenCalled();
  });
});
