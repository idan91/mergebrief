// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
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
      role: "core",
      loc: { added: 3, deleted: 1 },
      addedRanges: [],
      removedRanges: [],
      riskSurface: [],
      diff: [{ kind: "add", content: "a();", newLine: 11 }],
    },
  ],
  concernView: [],
};

/** A full prop set keyed on the own-draft state — for rerender-based tests.
 * Router-less on purpose: safe only while the menu stays CLOSED (the
 * summary-preview menu entry is a Link and needs the renderHeader harness). */
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
    openSubmit: vi.fn(),
    clearDrafts: vi.fn(),
    availability: { previousBrief: false, lastReview: false },
    compareState: { view: "full", compare: "off" },
    ownDraft,
  };
}

// The menu's summary-preview entry is a router Link, so the harness mounts a
// two-route memory router: the header at "/" plus a stub preview route the
// Link can resolve against.
async function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const clearDrafts = vi.fn();
  const openSubmit = vi.fn();
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
    openSubmit,
    clearDrafts,
    availability: { previousBrief: false, lastReview: false },
    compareState: { view: "full", compare: "off" },
    controlsSlot: <div data-testid="controls-slot" />,
    ...overrides,
  };
  const rootRoute = createRootRoute();
  const headerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <Header {...props} />,
  });
  const previewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/briefs/$briefId/summary-preview",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([headerRoute, previewRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return { clearDrafts, openSubmit };
}

describe("Header identity row", () => {
  it("renders the one-line identity: wordmark, title, repo + PR link — no context line", async () => {
    await renderHeader();
    expect(screen.getByText("MergeBrief").textContent).toBe("MergeBrief");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Tighten the cross-param leak",
    );
    expect(screen.getByText("acme/widgets")).toBeTruthy();
    const link = screen.getByRole("link", { name: /#7/ });
    expect(link.getAttribute("href")).toBe("https://example.com/pr/7");
    expect(link.getAttribute("target")).toBe("_blank");
    // Artifact identity lives in the timeline navigator, the rest in the
    // details panel.
    expect(screen.queryByText(/local brief @/)).toBeNull();
    expect(screen.queryByText(/brief _3/)).toBeNull();
    expect(screen.queryByText(/basebase\.\.headhead/)).toBeNull();
  });

  it("renders the keycap origin badge in the riders", async () => {
    await renderHeader();
    // Full semantics are pinned in ProviderBadge.test.tsx; the header pins
    // only the wiring.
    const badge = document.querySelector("[data-provider-badge]");
    expect(badge?.textContent).toContain("m-1 · high");
    expect(badge?.textContent).toContain("API");
    expect(document.querySelector("[data-origin]")).toBeNull();
  });
});

describe("state badge", () => {
  const stamped = (
    state: "open" | "closed",
    draft: boolean,
    merged: boolean,
  ) => ({ ...brief, pr: { ...brief.pr, state, draft, merged } });

  it("renders no badge on a pre-stamping artifact (no state)", async () => {
    await renderHeader();
    expect(document.querySelector("[data-state-badge]")).toBeNull();
  });

  it("keeps the self-review chip adjacent to the Draft badge (own-draft)", async () => {
    await renderHeader({
      brief: stamped("open", true, false),
      ownDraft: { markReady: vi.fn(), pending: false },
    });
    const badge = document.querySelector("[data-state-badge]");
    expect(badge?.getAttribute("data-variant")).toBe("draft");
    // The chip must be the badge's immediate DOM sibling.
    expect(badge?.nextElementSibling?.matches("[data-self-review-chip]")).toBe(
      true,
    );
  });

  it.each([
    ["open", false, false, "open", "Open"],
    ["open", true, false, "draft", "Draft"],
    ["closed", false, false, "closed", "Closed"],
    // Draft supersedes OPEN, never closed.
    ["closed", true, false, "closed", "Closed"],
    ["closed", false, true, "merged", "Merged"],
    // Draft flag on a merged snapshot: merged still wins.
    ["closed", true, true, "merged", "Merged"],
  ] as const)(
    "state=%s draft=%s merged=%s → %s badge",
    async (state, draft, merged, variant, label) => {
      await renderHeader({ brief: stamped(state, draft, merged) });
      const badge = document.querySelector("[data-state-badge]");
      expect(badge?.getAttribute("data-variant")).toBe(variant);
      // Visible text is the state word; SR text carries the prefix.
      expect(badge?.textContent).toBe(`pull request ${label}`);
    },
  );

  it("renders from LIVE webhook state on an UNSTAMPED artifact (DB route)", async () => {
    // A DB brief generated before stamping has no pr.state — the badge must
    // come from the live pull-request row there.
    await renderHeader({ livePrState: { state: "open", draft: false } });
    const badge = document.querySelector("[data-state-badge]");
    expect(badge?.getAttribute("data-variant")).toBe("open");
  });

  it.each([
    ["open", false, "open"],
    ["open", true, "draft"],
    ["closed", false, "closed"],
    // The live DB vocabulary folds merged INTO the state.
    ["merged", false, "merged"],
    ["merged", true, "merged"],
  ] as const)(
    "live state=%s draft=%s → %s badge",
    async (state, draft, variant) => {
      await renderHeader({ livePrState: { state, draft } });
      expect(
        document
          .querySelector("[data-state-badge]")
          ?.getAttribute("data-variant"),
      ).toBe(variant);
    },
  );

  it("live state SUPERSEDES a stale artifact stamp", async () => {
    // Artifact stamped open at generation; the PR merged since. The DB
    // route shows live truth — staleness is only accepted on the local
    // file path, where no live source exists.
    await renderHeader({
      brief: stamped("open", false, false),
      livePrState: { state: "merged", draft: false },
    });
    expect(
      document
        .querySelector("[data-state-badge]")
        ?.getAttribute("data-variant"),
    ).toBe("merged");
  });
});

describe("generation warnings chip", () => {
  const warned = {
    ...brief,
    generationWarnings: [
      "⚠ salvaged brief: dropped 1 invalid tags entry",
      "warning: requested model m-1 but modelUsage reports m-2 — origin stamp stays the declaration",
      // Duplicate — the chip counts unique events.
      "⚠ salvaged brief: dropped 1 invalid tags entry",
    ],
  };

  it("opens the Brief-details panel LANDED on the warnings text", async () => {
    await renderHeader({ brief: warned });
    const chip = screen.getByRole("button", {
      name: /2 generation warnings/,
    });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    const note = document.querySelector("[data-details-warnings]");
    expect(note?.textContent).toContain("salvaged brief");
    expect(note?.textContent).toContain("modelUsage reports m-2");
    // The chip path LANDS there: focus moves to the block so a screen reader
    // announces it on arrival.
    expect(document.activeElement).toBe(note);
  });

  it("Escape closes the panel without reaching page shortcuts", async () => {
    await renderHeader({ brief: warned });
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    fireEvent.click(
      screen.getByRole("button", { name: /2 generation warnings/ }),
    );
    expect(document.querySelector("[data-details-warnings]")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.querySelector("[data-details-warnings]")).toBeNull();
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("singularizes a single warning", async () => {
    await renderHeader({
      brief: { ...brief, generationWarnings: ["⚠ salvaged brief"] },
    });
    expect(
      screen.getByRole("button", { name: /1 generation warning$/ }),
    ).toBeTruthy();
  });

  it("renders no chip on a clean generation", async () => {
    await renderHeader();
    expect(
      document.querySelector("[data-generation-warnings-chip]"),
    ).toBeNull();
  });
});

describe("Header menu and stats", () => {
  it("shows the progress facts on the lens row, LOC as the core-lines disclosure", async () => {
    await renderHeader();
    expect(screen.getByText("chunks").textContent).toContain("1/2");
    expect(screen.getByText("flags").textContent).toContain("0/1");
    // The LOC cell is the core-lines disclosure trigger — a real button.
    const loc = screen.getByTestId("core-lines-disclosure");
    expect(loc.textContent).toContain("core lines");
    expect(loc.textContent).toContain("+3");
    expect(loc.textContent).toContain("−1");
    fireEvent.click(loc);
    expect(screen.getByText("all lines")).toBeTruthy();
    expect(screen.getByText(/derived from the diff/)).toBeTruthy();
  });

  it("shows the unattributed stat with the honest caveat when a remainder exists", async () => {
    const model = buildBriefViewModel({
      ...brief,
      unattributed: [
        {
          file: "src/orphan.ts",
          addedRanges: [{ start: 1, end: 4 }],
          removedRanges: [{ start: 2, end: 3 }],
        },
      ],
    });
    await renderHeader({ model });
    const stat = screen.getByTestId("unattributed-disclosure");
    expect(stat.textContent).toContain("unattributed");
    expect(stat.textContent).toContain("+4");
    expect(stat.textContent).toContain("−2");
    fireEvent.click(stat);
    const total = model.totalAdded + model.totalDeleted;
    const attributed = total - 6;
    expect(
      screen.getByText(
        new RegExp(
          `attributed ${String(attributed)} of ${String(total)} changed lines`,
        ),
      ),
    ).toBeTruthy();
  });

  it("renders no unattributed stat without a remainder", async () => {
    await renderHeader();
    expect(screen.queryByTestId("unattributed-disclosure")).toBeNull();
    await renderHeader({
      model: buildBriefViewModel({ ...brief, unattributed: [] }),
    });
    expect(screen.queryByTestId("unattributed-disclosure")).toBeNull();
  });

  it("keeps rare actions in a menu with menu-button semantics", async () => {
    const { clearDrafts } = await renderHeader();
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
    // The local-path preview entry is a cross-route link.
    expect(items[0]!.getAttribute("href")).toBe(
      "/briefs/test-brief/summary-preview",
    );
    // First item receives focus on open (menu-button pattern).
    expect(document.activeElement).toBe(items[0]);

    fireEvent.click(items[0]!);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /clear local/i }));
    expect(clearDrafts).toHaveBeenCalledTimes(1);
  });

  it("closes the menu on Escape and returns focus to the trigger", async () => {
    await renderHeader();
    const trigger = screen.getByRole("button", { name: /more actions/i });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape works from the trigger too and never reaches the page", async () => {
    await renderHeader();
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

  it("closes on Tab and stands page shortcuts down while open", async () => {
    await renderHeader();
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

  it("offers no summary-preview entry on a DB brief", async () => {
    // The standalone preview route resolves through the local file store —
    // a db: id gets no menu entry; the submit flow is its receipt surface.
    await renderHeader({ briefId: "db:acme/widgets:7:base:head" });
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Clear local drafts",
    ]);
  });

  it("moves between items with arrow keys, wrapping", async () => {
    await renderHeader();
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

  it("closes on an outside pointerdown", async () => {
    await renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closing via the trigger returns focus to it", async () => {
    await renderHeader();
    const trigger = screen.getByRole("button", { name: /more actions/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    // WebKit/Firefox-macOS never focus the clicked button themselves.
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the primary CTA top-level", async () => {
    const { openSubmit } = await renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(openSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("Header own-draft state", () => {
  it("renders no self-review chip outside the own-draft state", async () => {
    await renderHeader();
    expect(screen.queryByText("Self-review — your draft")).toBeNull();
  });

  it("renders the non-dismissible self-review chip with its tooltip", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
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

  it("tooltip dismisses on Escape while focused without leaking the key, and re-arms (WCAG 1.4.13)", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
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

  it("Escape-dismissal sticks while EITHER hover or focus is still active", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
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

  it("tooltip dismisses on Escape while HOVERED without focus (WCAG 1.4.13)", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
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

  it("swaps the terminal-action slot: Mark ready for review replaces Receipt", async () => {
    const markReady = vi.fn();
    const { openSubmit } = await renderHeader({
      ownDraft: { markReady, pending: false },
    });
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(markReady).toHaveBeenCalledTimes(1);
    expect(openSubmit).toHaveBeenCalledTimes(0);
  });

  it("marks the CTA aria-disabled (never hard disabled) while pending — focus survives", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: true } });
    const cta = screen.getByRole("button", { name: /marking ready/i });
    // Hard `disabled` would dump keyboard focus on <body> mid-mutation; the
    // mark-ready flow's in-flight guard already no-ops repeat clicks.
    expect((cta as HTMLButtonElement).disabled).toBe(false);
    expect(cta.getAttribute("aria-disabled")).toBe("true");
    cta.focus();
    expect(document.activeElement).toBe(cta);
  });

  it("keeps the pending CTA's click live — the flow announces its own reason", async () => {
    // Caller-owned aria-disabled, not the Button `disabled` prop: a press
    // while pending/unavailable must still reach markReady, whose guard
    // no-ops repeats and announces why.
    const markReady = vi.fn();
    await renderHeader({ ownDraft: { markReady, pending: true } });
    fireEvent.click(screen.getByRole("button", { name: /marking ready/i }));
    expect(markReady).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the swapped-in Receipt CTA when the own-draft state ends on the focused slot", async () => {
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
      screen.getByRole("button", { name: "Submit" }),
    );
  });

  it("keeps slot focus continuity on the flip INTO own-draft too (symmetric)", async () => {
    const { rerender } = render(<Header {...headerProps(undefined)} />);
    screen.getByRole("button", { name: "Submit" }).focus();

    // The PR converts to draft under focus: Receipt unmounts, the mark-ready
    // CTA mounts in the same slot — focus follows.
    rerender(
      <Header {...headerProps({ markReady: vi.fn(), pending: false })} />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
  });

  it("a consumed slot-focus flag never goes stale: a later external flip must not steal focus", async () => {
    const { rerender } = render(<Header {...headerProps(undefined)} />);
    // Focus Receipt, then flip INTO own-draft (slot continuity moves focus
    // onto the CTA and consumes the flag)…
    screen.getByRole("button", { name: "Submit" }).focus();
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

  it("does NOT steal focus on the swap when the slot was not focused", async () => {
    const { rerender } = render(
      <Header {...headerProps({ markReady: vi.fn(), pending: false })} />,
    );
    // Focus never visited the terminal slot in this session.
    rerender(<Header {...headerProps(undefined)} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("shows a count-only flags stat (dispositions are unreachable in own-draft)", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    const stat = screen.getByText("flags");
    // No resolved/total fraction — it would sit at a permanent 0/N.
    expect(stat.textContent).toBe("flags1");
    expect(stat.textContent).not.toContain("/");
  });

  it("drops the Summary preview item (submit machinery) from the menu", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Clear local drafts",
    ]);
  });
});

describe("repo-config origin chip", () => {
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

  it("renders NO chip in the ok state — ok lives in the details panel", async () => {
    await renderHeader({ repoConfig: APPLIED });
    expect(document.querySelector("[data-repo-config-chip]")).toBeNull();
    // The panel's Repo config section carries the ok-state instead.
    fireEvent.click(screen.getByRole("button", { name: "Brief details" }));
    const section = document.querySelector(
      '[data-details-section="repo-config"]',
    );
    expect(section?.textContent).toContain(".mergebrief/instructions.md");
    expect(section?.textContent).toContain("applied");
  });

  it("keeps the warning chip, with the applied sha in its label", async () => {
    await renderHeader({
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
    const chip = document.querySelector("[data-repo-config-chip]");
    expect(chip?.textContent).toContain("repo config @ a1b2c3d");
  });

  it("flips to the warning state on any error outcome", async () => {
    await renderHeader({
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

  it("renders NO chip when every file is absent and nothing collided", async () => {
    await renderHeader({
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

  it("renders no chip at all without a snapshot", async () => {
    await renderHeader({});
    expect(document.querySelector("[data-repo-config-chip]")).toBeNull();
  });
});

describe("repo-config chip — applied-with-warning flips to warning state", () => {
  it("a warning on an applied file is a config error the author must see", async () => {
    await renderHeader({
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
