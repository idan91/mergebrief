// @vitest-environment jsdom
// BRIEF-28: the busy header regrouped — one merged context line, a single
// stats group, and the rare actions behind a More-actions menu with proper
// menu-button semantics.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Brief } from "../../../types";
import { buildBriefViewModel } from "../../../utils/viewModel";
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

/** A full prop set keyed on the own-draft plan — for rerender-based tests. */
function headerProps(ownDraft: HeaderProps["ownDraft"]): HeaderProps {
  return {
    brief,
    briefId: "test-brief",
    timeline: { points: [], selectedPoint: undefined },
    model: buildBriefViewModel(brief),
    totals: {
      reviewed: 1,
      chunkTotal: 2,
      flagsResolved: 0,
      flagTotal: 1,
    },
    progress: 50,
    locOpen: false,
    viewMode: "story",
    setViewMode: vi.fn(),
    setLocOpen: vi.fn(),
    openReceipt: vi.fn(),
    clearDrafts: vi.fn(),
    availability: { previousBrief: false, lastReview: false },
    compareState: { view: "full", compare: "off" },
    openSummaryPreviewDrawer: vi.fn(),
    ownDraft,
  };
}

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
      reviewed: 1,
      chunkTotal: 2,
      flagsResolved: 0,
      flagTotal: 1,
    },
    progress: 50,
    locOpen: false,
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
    // BRIEF-11: the adapter CLASS is part of provenance — an API/SDK run
    // reads differently from a harness-CLI run.
    expect(text).toContain("via anthropic (API)/m-1 · effort high");
  });

  it("labels harness-CLI providers distinctly from API providers", () => {
    renderHeader({
      brief: {
        ...brief,
        generation: { provider: "claude-code", model: "m-1", effort: null },
      },
    });
    const sub = screen.getByText(/local brief @ headabc/).closest("div");
    expect(sub?.textContent).toContain("via claude-code (local CLI)/m-1");
  });

  it("renders an unknown provider token without a class label", () => {
    renderHeader({
      brief: {
        ...brief,
        generation: { provider: "fake", model: "m-1", effort: null },
      },
    });
    const sub = screen.getByText(/local brief @ headabc/).closest("div");
    expect(sub?.textContent).toContain("via fake/m-1");
  });

  it("treats inherited-object tokens as unknown (no bogus class label)", () => {
    renderHeader({
      brief: {
        ...brief,
        generation: { provider: "toString", model: "m-1", effort: null },
      },
    });
    const sub = screen.getByText(/local brief @ headabc/).closest("div");
    expect(sub?.textContent).toContain("via toString/m-1");
    expect(sub?.textContent).not.toContain("via toString (");
  });

  it("surfaces generation warnings under the context line", () => {
    renderHeader({
      brief: {
        ...brief,
        generationWarnings: [
          "⚠ salvaged brief: dropped 1 invalid tags entry",
          "warning: requested model m-1 but modelUsage reports m-2 — provenance stamp stays the declaration",
        ],
      },
    });
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("salvaged brief");
    expect(note.textContent).toContain("modelUsage reports m-2");
  });

  it("renders no warning block on a clean generation", () => {
    renderHeader();
    expect(screen.queryByRole("note")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Receipt" }));
    expect(openReceipt).toHaveBeenCalledTimes(1);
  });
});

describe("Header own-draft state (BRIEF-43)", () => {
  it("renders no self-review chip outside the own-draft state", () => {
    renderHeader();
    expect(screen.queryByText("Self-review — your draft")).toBeNull();
  });

  it("renders the non-dismissible self-review chip with its tooltip", () => {
    renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    const chip = screen.getByText("Self-review — your draft");
    expect(chip).toBeTruthy();
    // Non-dismissible: the chip carries no close affordance.
    expect(
      chip
        .closest("[data-self-review-chip]")
        ?.querySelector("button[aria-label*='close' i]"),
    ).toBeNull();
    const info = screen.getByRole("button", { name: "About self-review" });
    const tooltipId = info.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    const tooltip = document.getElementById(tooltipId ?? "");
    expect(tooltip?.getAttribute("role")).toBe("tooltip");
    expect(tooltip?.textContent).toBe(
      "You're viewing your own draft PR. Review submission and the receipt unlock once it's marked ready for review.",
    );
  });

  it("tooltip dismisses on Escape while focused without leaking the key, and re-arms (WCAG 1.4.13)", () => {
    renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    const info = screen.getByRole("button", { name: "About self-review" });
    const wrap = info.parentElement;
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);

    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    fireEvent.focus(info);
    fireEvent.keyDown(info, { key: "Escape" });
    // Dismissed — and the key never reached the page (focus-mode Escape).
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKeyDown);

    // Blur re-arms it for the next focus/hover…
    fireEvent.blur(info);
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);

    // …and so does the pointer leaving after an Escape while hovering.
    if (wrap) fireEvent.mouseEnter(wrap);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);
    if (wrap) fireEvent.mouseLeave(wrap);
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);
  });

  it("Escape-dismissal sticks while EITHER hover or focus is still active", () => {
    renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    const info = screen.getByRole("button", { name: "About self-review" });
    const wrap = info.parentElement;

    // Both channels active, then Escape.
    if (wrap) fireEvent.mouseEnter(wrap);
    fireEvent.focus(info);
    fireEvent.keyDown(info, { key: "Escape" });
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);

    // Pointer drifts away while focus remains: must STAY dismissed.
    if (wrap) fireEvent.mouseLeave(wrap);
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);

    // The inverse: re-hover, then blur while the pointer stays — still
    // dismissed (focus left, hover holds).
    if (wrap) fireEvent.mouseEnter(wrap);
    fireEvent.blur(info);
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);

    // Only when BOTH channels go idle does the tooltip re-arm.
    if (wrap) fireEvent.mouseLeave(wrap);
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);
  });

  it("tooltip dismisses on Escape while HOVERED without focus (WCAG 1.4.13)", () => {
    renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    const info = screen.getByRole("button", { name: "About self-review" });
    const wrap = info.parentElement;
    expect(document.activeElement).toBe(document.body);

    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    // Pointer hover only — focus never moves off <body>.
    if (wrap) fireEvent.mouseEnter(wrap);
    fireEvent.keyDown(document.body, { key: "Escape" });
    // Dismissed, key claimed: it must NOT fall through to the page's
    // window-level shortcut listener (which would exit focus mode).
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);
    expect(onWindowKeyDown).not.toHaveBeenCalled();

    // Once the tooltip is gone, the claim is released: a second Escape
    // reaches the page as usual.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onWindowKeyDown).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("swaps the terminal-action slot: Mark ready for review replaces Receipt", () => {
    const markReady = vi.fn();
    const { openReceipt } = renderHeader({
      ownDraft: { markReady, pending: false },
    });
    expect(screen.queryByRole("button", { name: "Receipt" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(markReady).toHaveBeenCalledTimes(1);
    expect(openReceipt).toHaveBeenCalledTimes(0);
  });

  it("marks the CTA aria-disabled (never hard disabled) while pending — focus survives", () => {
    renderHeader({ ownDraft: { markReady: vi.fn(), pending: true } });
    const cta = screen.getByRole("button", { name: /marking ready/i });
    // Hard `disabled` would dump keyboard focus on <body> mid-mutation; the
    // in-flight guard in the mark-ready flow already no-ops repeat clicks.
    expect((cta as HTMLButtonElement).disabled).toBe(false);
    expect(cta.getAttribute("aria-disabled")).toBe("true");
    cta.focus();
    expect(document.activeElement).toBe(cta);
  });

  it("moves focus to the swapped-in Receipt CTA when the own-draft state ends on the focused slot", () => {
    const { rerender } = render(
      <Header {...headerProps({ markReady: vi.fn(), pending: false })} />,
    );
    const cta = screen.getByRole("button", { name: "Mark ready for review" });
    cta.focus();

    // The refreshed PrView flips draft=false: the CTA unmounts, Receipt
    // mounts in the terminal-action slot — focus follows the slot instead of
    // dropping to <body>.
    rerender(<Header {...headerProps(undefined)} />);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Receipt" }),
    );
  });

  it("keeps slot focus continuity on the flip INTO own-draft too (symmetric)", () => {
    const { rerender } = render(<Header {...headerProps(undefined)} />);
    screen.getByRole("button", { name: "Receipt" }).focus();

    // The PR converts to draft under focus: Receipt unmounts, the mark-ready
    // CTA mounts in the same slot — focus follows.
    rerender(
      <Header {...headerProps({ markReady: vi.fn(), pending: false })} />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
  });

  it("a consumed slot-focus flag never goes stale: a later external flip must not steal focus", () => {
    const { rerender } = render(<Header {...headerProps(undefined)} />);
    // Focus Receipt, then flip INTO own-draft (slot continuity moves focus
    // onto the CTA and consumes the flag)…
    screen.getByRole("button", { name: "Receipt" }).focus();
    rerender(
      <Header {...headerProps({ markReady: vi.fn(), pending: false })} />,
    );
    // …then the user moves on and works elsewhere.
    const elsewhere = screen.getByRole("button", { name: /more actions/i });
    elsewhere.focus();

    // A LATER external ready flip must leave the user's focus alone — a
    // stale `true` from the earlier swap would yank it onto Receipt.
    rerender(<Header {...headerProps(undefined)} />);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /more actions/i }),
    );
  });

  it("does NOT steal focus on the swap when the slot was not focused", () => {
    const { rerender } = render(
      <Header {...headerProps({ markReady: vi.fn(), pending: false })} />,
    );
    // Focus never visited the terminal slot in this session.
    rerender(<Header {...headerProps(undefined)} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("shows a count-only flags stat (dispositions are unreachable in own-draft)", () => {
    renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    const stat = screen.getByText("flags");
    // No resolved/total fraction — it would sit at a permanent 0/N.
    expect(stat.textContent).toBe("flags1");
    expect(stat.textContent).not.toContain("/");
  });

  it("drops the Summary preview item (submit machinery) from the menu", () => {
    renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Clear local drafts",
    ]);
  });
});

describe("repo-config provenance chip (BRIEF-52, ADR 0032 #8)", () => {
  const APPLIED = {
    files: [
      {
        path: ".mergebrief/instructions.md",
        blobSha: "a1b2c3d4e5f6",
        outcome: "applied" as const,
      },
      {
        path: ".mergebrief/settings.yaml",
        blobSha: null,
        outcome: "absent" as const,
      },
      {
        path: ".mergebrief/policy.yaml",
        blobSha: "p1p2p3p4",
        outcome: "applied" as const,
      },
    ],
    collisions: [],
    policy: null,
  };

  it("renders the understated chip with the applied sha", () => {
    renderHeader({ repoConfig: APPLIED });
    const chip = document.querySelector("[data-repo-config-chip]");
    expect(chip?.textContent).toContain("repo config @ a1b2c3d");
    expect(chip?.getAttribute("data-state")).toBe("ok");
  });

  it("flips to the warning state on any error outcome", () => {
    renderHeader({
      repoConfig: {
        ...APPLIED,
        files: [
          APPLIED.files[0]!,
          {
            path: ".mergebrief/settings.yaml",
            blobSha: "bad",
            outcome: "invalid" as const,
          },
          APPLIED.files[2]!,
        ],
      },
    });
    expect(
      document
        .querySelector("[data-repo-config-chip]")
        ?.getAttribute("data-state"),
    ).toBe("warning");
  });

  it("renders NO chip when every file is absent and nothing collided", () => {
    renderHeader({
      repoConfig: {
        files: APPLIED.files.map((file) => ({
          ...file,
          blobSha: null,
          outcome: "absent" as const,
        })),
        collisions: [],
        policy: null,
      },
    });
    expect(document.querySelector("[data-repo-config-chip]")).toBeNull();
  });

  it("renders no chip at all without a snapshot", () => {
    renderHeader({});
    expect(document.querySelector("[data-repo-config-chip]")).toBeNull();
  });
});

describe("repo-config chip — applied-with-warning flips to warning state", () => {
  it("a warning on an applied file is a config error the author must see", () => {
    renderHeader({
      repoConfig: {
        files: [
          {
            path: ".mergebrief/instructions.md",
            blobSha: null,
            outcome: "absent" as const,
          },
          {
            path: ".mergebrief/settings.yaml",
            blobSha: null,
            outcome: "absent" as const,
          },
          {
            path: ".mergebrief/policy.yaml",
            blobSha: "p1",
            outcome: "applied" as const,
            warning: "1 de-emphasis rule dropped — attribute not recognized",
          },
        ],
        collisions: [],
        policy: null,
      },
    });
    expect(
      document
        .querySelector("[data-repo-config-chip]")
        ?.getAttribute("data-state"),
    ).toBe("warning");
  });
});
