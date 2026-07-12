// @vitest-environment jsdom
// BRIEF-28: the busy header regrouped — one merged context line, a single
// stats group, and the rare actions behind a More-actions menu with proper
// menu-button semantics.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Brief } from "../../types";
import { buildBriefViewModel } from "../../viewModel";
import { Header, type HeaderProps } from "./Header";

afterEach(cleanup);

const brief: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 7,
    title: "Tighten the cross-param leak",
    url: "https://example.com/pr/7",
    sha: "headabc1234",
    description: "",
  },
  summary: "s",
  index: 3,
  commitRange: { base: "basebase", head: "headhead", commitCount: 2 },
  generation: { provider: "anthropic", model: "m-1", effort: "high" },
  changeGroups: [
    {
      id: "g1",
      title: "g",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "chunk-a",
      changeGroupId: "g1",
      file: "src/a.ts",
      concern: "implementation",
      role: "carrier",
      loc: { added: 3, deleted: 1 },
      addedRanges: [],
      removedRanges: [],
      riskSurface: [],
      diff: [{ kind: "add", content: "a();", newLine: 11 }],
    },
  ],
  concernView: [],
};

function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const clearDrafts = vi.fn();
  const openSummaryPreviewDrawer = vi.fn();
  const openReceipt = vi.fn();
  const props: HeaderProps = {
    brief,
    briefId: "test-brief",
    timeline: { points: [], selectedPoint: undefined },
    model: buildBriefViewModel(brief),
    totals: {
      playbookChecked: 0,
      playbookTotal: 0,
      reviewed: 1,
      chunkTotal: 2,
      flagsResolved: 0,
      flagTotal: 1,
    },
    progress: 50,
    locOpen: false,
    reviewMode: "author",
    viewMode: "story",
    setViewMode: vi.fn(),
    setLocOpen: vi.fn(),
    openReceipt,
    clearDrafts,
    availability: { previousBrief: false, lastReview: false },
    compareState: { view: "full", compare: "off" },
    // The drawer variant avoids a router dependency; the local Link
    // variant (href/params) is asserted in briefScreen.test.tsx, which
    // mounts the real local route.
    openSummaryPreviewDrawer,
    controlsSlot: <div data-testid="controls-slot" />,
    ...overrides,
  };
  render(<Header {...props} />);
  return { clearDrafts, openSummaryPreviewDrawer, openReceipt };
}

describe("Header (BRIEF-28)", () => {
  it("renders one merged context line with artifact, index, range, provenance", () => {
    renderHeader();
    const sub = screen.getByText(/local brief @ headabc/).closest("div");
    const text = sub?.textContent ?? "";
    expect(text).toContain("acme/widgets");
    expect(text).toContain("#7");
    expect(text).toContain("brief _3");
    expect(text).toContain("basebase..headhead, 2 commits");
    expect(text).toContain("via anthropic/m-1 · effort high");
  });

  it("shows the progress facts", () => {
    renderHeader();
    expect(screen.getByText("chunks").textContent).toContain("1/2");
    expect(screen.getByText("flags").textContent).toContain("0/1");
    expect(screen.getByText("adjusted lines")).toBeTruthy();
  });

  it("keeps rare actions in a menu with menu-button semantics", () => {
    const { clearDrafts, openSummaryPreviewDrawer } = renderHeader();
    // Not top-level buttons anymore.
    expect(
      screen.queryByRole("button", { name: /^summary preview$/i }),
    ).toBeNull();
    const trigger = screen.getByRole("button", { name: /more actions/i });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Summary preview",
      "Clear local drafts",
    ]);
    // First item receives focus on open (menu-button pattern).
    expect(document.activeElement).toBe(items[0]);

    fireEvent.click(items[0]!);
    expect(openSummaryPreviewDrawer).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /clear local/i }));
    expect(clearDrafts).toHaveBeenCalledTimes(1);
  });

  it("closes the menu on Escape and returns focus to the trigger", () => {
    renderHeader();
    const trigger = screen.getByRole("button", { name: /more actions/i });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape works from the trigger too and never reaches the page", () => {
    renderHeader();
    const trigger = screen.getByRole("button", { name: /more actions/i });
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    fireEvent.click(trigger);
    // Shift+Tab path: focus back on the trigger, menu still open.
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("closes on Tab and stands page shortcuts down while open", () => {
    renderHeader();
    const trigger = screen.getByRole("button", { name: /more actions/i });
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    fireEvent.click(trigger);
    const [firstItem] = screen.getAllByRole("menuitem");
    // A page shortcut pressed inside the open menu must not leak out.
    fireEvent.keyDown(firstItem!, { key: "z" });
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(firstItem!, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    // Tab resumes from the trigger, never from an unmounted menuitem.
    expect(document.activeElement).toBe(trigger);
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("returns focus to the trigger when opening the summary drawer", () => {
    const { openSummaryPreviewDrawer } = renderHeader();
    const trigger = screen.getByRole("button", { name: /more actions/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /summary/i }));
    expect(openSummaryPreviewDrawer).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("moves between items with arrow keys, wrapping", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitem");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[1]);
  });

  it("closes on an outside pointerdown", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closing via the trigger returns focus to it", () => {
    renderHeader();
    const trigger = screen.getByRole("button", { name: /more actions/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    // WebKit/Firefox-macOS never focus the clicked button themselves.
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the primary CTA top-level", () => {
    const { openReceipt } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Ready for review" }));
    expect(openReceipt).toHaveBeenCalledTimes(1);
  });
});
