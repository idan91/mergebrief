// @vitest-environment jsdom
// The conversation filter bar (BRIEF-99), which sits ABOVE the section: chips are aria-pressed toggle
// buttons carrying text, counts split human/bot, All/None act on the reviewer
// family only, and the hidden-thread pill only speaks when the diff actually
// lost something.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CONVERSATION_FILTER,
  parseConversationFilter,
  type ConversationFilter,
} from "../../utils/filter";
import {
  ConversationFilterBar,
  type ConversationFilterBarProps,
} from "./ConversationFilterBar";

afterEach(cleanup);

const VERDICTS = [
  { state: "APPROVED", humanCount: 2, botCount: 1 },
  { state: "CHANGES_REQUESTED", humanCount: 1, botCount: 0 },
] as const;

const REVIEWERS = [
  { login: "alice", isBot: false },
  { login: "bob", isBot: false },
  { login: "coderabbitai", isBot: true },
] as const;

function renderBar(overrides: Partial<ConversationFilterBarProps> = {}) {
  const onChange = vi.fn<(next: ConversationFilter) => void>();
  const props: ConversationFilterBarProps = {
    filter: DEFAULT_CONVERSATION_FILTER,
    verdicts: [...VERDICTS],
    reviewers: [...REVIEWERS],
    hiddenInlineThreads: 0,
    onChange,
    ...overrides,
  };
  render(<ConversationFilterBar {...props} />);
  return { onChange, props };
}

describe("ConversationFilterBar", () => {
  it("renders verdict chips with human counts and a bot secondary", () => {
    renderBar();
    const approved = screen.getByRole("button", { name: /approved/ });
    expect(approved.textContent).toContain("approved");
    expect(approved.textContent).toContain("2");
    expect(approved.textContent).toContain("1 bot");
    // Zero bots means no visible bot secondary — only the sr-only sentence
    // mentions bots at all.
    expect(
      screen.getByRole("button", { name: /changes requested/ }).textContent,
    ).not.toContain("0 bot;");
  });

  it("marks selection with aria-pressed, not colour alone", () => {
    const filter = parseConversationFilter({ verdicts: "approved" });
    renderBar({ filter });
    expect(
      screen
        .getByRole("button", { name: /approved/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /changes requested/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("toggles a verdict and a reviewer through onChange", () => {
    const { onChange } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: /approved/ }));
    const afterVerdict = onChange.mock.calls[0]?.[0];
    if (afterVerdict === undefined) throw new Error("no verdict change");
    expect([...afterVerdict.verdicts]).toEqual(["APPROVED"]);

    fireEvent.click(screen.getByRole("button", { name: /@alice/ }));
    const afterReviewer = onChange.mock.calls[1]?.[0];
    if (afterReviewer === undefined) throw new Error("no reviewer change");
    expect([...afterReviewer.reviewers]).toEqual(["alice"]);
  });

  it("tags bot reviewers and keeps them selectable", () => {
    const { onChange } = renderBar();
    const bot = screen.getByRole("button", { name: /@coderabbitai/ });
    expect(bot.textContent).toContain("bot");
    fireEvent.click(bot);
    const next = onChange.mock.calls[0]?.[0];
    if (next === undefined) throw new Error("no change reported");
    expect([...next.reviewers]).toEqual(["coderabbitai"]);
  });

  it("All selects every reviewer; None clears the family without emptying the digest", () => {
    const { onChange } = renderBar({
      filter: parseConversationFilter({ reviewers: "alice" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    const all = onChange.mock.calls[0]?.[0];
    if (all === undefined) throw new Error("no All change");
    expect([...all.reviewers]).toEqual(["alice", "bob", "coderabbitai"]);

    fireEvent.click(screen.getByRole("button", { name: "None" }));
    const none = onChange.mock.calls[1]?.[0];
    if (none === undefined) throw new Error("no None change");
    expect(none.reviewers.size).toBe(0);
  });

  it("marks All/None spent with aria-disabled and no-ops them, keeping focus", () => {
    // `disabled` would blur the control the moment it is used — these two
    // disable themselves ON click, so the attribute is aria-only.
    const { onChange } = renderBar();
    const none = screen.getByRole("button", { name: "None" });
    expect(none.getAttribute("aria-disabled")).toBe("true");
    expect(none.hasAttribute("disabled")).toBe(false);
    fireEvent.click(none);
    expect(onChange).not.toHaveBeenCalled();
    cleanup();

    renderBar({
      filter: parseConversationFilter({
        reviewers: "alice,bob,coderabbitai",
      }),
    });
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("keeps a selected chip when the other family zeroes its count", () => {
    // Otherwise the only control that could unpress it disappears.
    renderBar({
      filter: parseConversationFilter({ verdicts: "commented" }),
      verdicts: [],
    });
    const chip = screen.getByRole("button", { name: /^commented/ });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("checkbox", { name: /only each reviewer's latest/i }),
    ).not.toBeNull();
  });

  it("labels each row, so the two chip runs line up and say what they filter", () => {
    renderBar();
    expect(screen.getByText("Verdict")).not.toBeNull();
    expect(screen.getByText("Reviewer")).not.toBeNull();
  });

  it("drops the chip list entirely when it has no chips, leaving no dead lane", () => {
    renderBar({ verdicts: [] });
    expect(screen.queryByRole("button", { name: /^approved/ })).toBeNull();
    // The global toggle survives — it is not a verdict control.
    expect(
      screen.getByRole("checkbox", { name: /only each reviewer's latest/i }),
    ).not.toBeNull();
  });

  it("renders nothing at all when there is no activity and no filter", () => {
    renderBar({ verdicts: [], reviewers: [] });
    expect(screen.queryByTestId("conversation-filter-bar")).toBeNull();
  });

  it("defaults the recency toggle on and reports flips", () => {
    const { onChange } = renderBar();
    const toggle = screen.getByRole("checkbox", {
      name: /only each reviewer's latest/i,
    });
    if (!(toggle instanceof HTMLInputElement))
      throw new Error("not a checkbox");
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    const next = onChange.mock.calls[0]?.[0];
    if (next === undefined) throw new Error("no change reported");
    expect(next.latestOnly).toBe(false);
  });

  it("announces threads hidden from the diff only while filtering", () => {
    renderBar({ hiddenInlineThreads: 3 });
    expect(screen.queryByText(/hidden in the diff/)).toBeNull();
    cleanup();
    renderBar({
      filter: parseConversationFilter({ reviewers: "alice" }),
      hiddenInlineThreads: 3,
    });
    expect(screen.getByText(/3 threads hidden in the diff/)).not.toBeNull();
  });

  it("offers a clear link that keeps an opted-into full history", () => {
    const { onChange } = renderBar({
      filter: parseConversationFilter({ reviewers: "alice", reviews: "all" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    const next = onChange.mock.calls[0]?.[0];
    if (next === undefined) throw new Error("no change reported");
    expect(next.reviewers.size).toBe(0);
    expect(next.latestOnly).toBe(false);
  });

  it("renders no verdict row when nothing was stated", () => {
    renderBar({ verdicts: [] });
    expect(screen.queryByRole("button", { name: /approved/ })).toBeNull();
    expect(screen.getByRole("button", { name: /@alice/ })).not.toBeNull();
  });
});
