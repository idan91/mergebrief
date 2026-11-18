// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { AnchorWarnings } from "brief-core/types";

import { CALLOUT_HOVER_DELAY_MS } from "@web/components/Callout/consts";
import { appI18n } from "@web/i18n/I18nProvider";
import { startColdCalloutTimers } from "@web/test/callouts";
import type { Brief } from "../../../../../model/types";
import { computeConcernShares } from "../../Masthead/utils";
import { BriefDetailsPanel } from ".";

const baseBrief: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 7,
    title: "t",
    url: "https://example.com/pr/7",
    sha: "a".repeat(40),
    description: "",
  },
  summary: "s",
  index: 3,
  commitRange: {
    base: "b".repeat(40),
    head: "a".repeat(40),
    commitCount: 2,
  },
  generation: {
    provider: "anthropic",
    model: "claude-opus-4-8",
    effort: "high",
  },
  generationWarnings: ["⚠ salvaged brief: dropped 1 entry"],
  changeGroups: [],
  chunks: [],
  concernView: [],
};

const TWO_CONCERN_SHARES = computeConcernShares(
  [
    { concern: "implementation", added: 40, deleted: 10 },
    { concern: "test", added: 30, deleted: 0 },
  ],
  { added: 20, deleted: 0 },
);

const {
  index: _index,
  commitRange: _commitRange,
  ...briefWithoutRange
} = baseBrief;

const deltaBrief: Brief = {
  ...briefWithoutRange,
  artifactKind: "delta",
  baselineSha: "c".repeat(40),
  headSha: "a".repeat(40),
  baselineIndex: 2,
  headIndex: 3,
};

function renderPanel(
  brief: Brief = baseBrief,
  repoConfig?: Parameters<typeof BriefDetailsPanel>[0]["repoConfig"],
) {
  render(
    <BriefDetailsPanel
      brief={brief}
      repoConfig={repoConfig}
      shares={TWO_CONCERN_SHARES}
      totalAdded={137}
      totalDeleted={76}
      totalCoreAdded={104}
      totalCoreDeleted={41}
    />,
  );
}

const infoTrigger = () => screen.getByRole("button", { name: "Brief details" });
const warningsChip = () =>
  screen.getByRole("button", { name: /generation warning/ });
const warningsNote = () => document.querySelector("[data-details-warnings]");
const panelId = () => infoTrigger().getAttribute("aria-controls");

afterEach(() => {
  vi.restoreAllMocks();
});

/** The span around a trigger that owns its hover preview. */
function getHoverArea(trigger: HTMLElement): HTMLElement {
  const hoverArea = trigger.parentElement;
  if (hoverArea === null) {
    throw new Error("the trigger has no hover area");
  }
  return hoverArea;
}

/** A mouse entering the hover area that wraps a trigger. */
function hoverWithMouse(trigger: HTMLElement) {
  fireEvent.pointerEnter(getHoverArea(trigger), { pointerType: "mouse" });
}

/** Every callout scroller reports content taller than its zero-height box. */
function stubOverflowingCallout() {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(
    function measure(this: Element) {
      return this.parentElement?.hasAttribute("data-callout") ? 900 : 0;
    },
  );
}

describe("BriefDetailsPanel disclosure semantics", () => {
  it("click opens, aria-expanded/controls track, click again closes", () => {
    renderPanel();
    const trigger = infoTrigger();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const id = panelId();
    expect(id).toBeTruthy();
    expect(document.getElementById(id ?? "")).toBeTruthy();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(warningsNote()).toBeNull();
  });

  it("Escape closes at capture and never reaches page shortcuts", () => {
    renderPanel();
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    fireEvent.click(infoTrigger());
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(warningsNote()).toBeNull();
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    // Once closed, the claim is released.
    fireEvent.keyDown(document.body, { key: "z" });
    expect(onWindowKeyDown).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("Escape closes a focused copy label first, then the panel", () => {
    renderPanel();
    fireEvent.click(infoTrigger());
    const copy = screen.getByRole("button", { name: /^Copy full SHA a/ });
    vi.spyOn(copy, "matches").mockImplementation(
      (selector) => selector === ":focus-visible",
    );
    act(() => copy.focus());
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.keyDown(copy, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(infoTrigger().getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(copy, { key: "Escape" });
    expect(infoTrigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(infoTrigger());
  });

  it("Escape from the scrolling content returns focus to the trigger", () => {
    stubOverflowingCallout();
    renderPanel();
    fireEvent.click(infoTrigger());
    const content = document.querySelector<HTMLElement>(
      "[data-callout] > [tabindex='0']",
    );
    expect(content).not.toBeNull();
    content?.focus();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(warningsNote()).toBeNull();
    expect(document.activeElement).toBe(infoTrigger());
  });
});

describe("warnings-chip trigger", () => {
  it("opens the panel landed on the focused warnings note", () => {
    renderPanel();
    fireEvent.click(warningsChip());
    const note = warningsNote();
    expect(note?.getAttribute("role")).toBe("region");
    expect(note?.getAttribute("aria-label")).toBe("Generation warnings");
    expect(note?.textContent).toContain("salvaged brief");
    expect(document.activeElement).toBe(note);
    expect(warningsChip().getAttribute("aria-expanded")).toBe("true");
  });

  it("a second chip click COLLAPSES and returns focus to the chip", () => {
    renderPanel();
    fireEvent.click(warningsChip());
    expect(document.activeElement).toBe(warningsNote());
    fireEvent.click(warningsChip());
    // aria-expanded promised a disclosure: activation must collapse, and
    // focus must not be dumped on <body> by the portal unmount.
    expect(warningsNote()).toBeNull();
    expect(warningsChip().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(warningsChip());
  });

  it("Escape after a chip landing returns focus to the chip, not <body>", () => {
    renderPanel();
    fireEvent.click(warningsChip());
    expect(document.activeElement).toBe(warningsNote());
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(warningsNote()).toBeNull();
    expect(document.activeElement).toBe(warningsChip());
  });

  it("a press outside the chip and the panel closes it", () => {
    renderPanel();
    fireEvent.click(warningsChip());

    fireEvent.pointerDown(document.body);

    expect(warningsNote()).toBeNull();
    expect(warningsChip().getAttribute("aria-expanded")).toBe("false");
  });

  it("a press outside returns focus to the chip without scrolling", () => {
    renderPanel();
    fireEvent.click(warningsChip());
    expect(document.activeElement).toBe(warningsNote());
    const focusChip = vi.spyOn(warningsChip(), "focus");

    fireEvent.pointerDown(document.body);

    expect(focusChip).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(warningsChip());
  });

  it("a press on the panel or the chip keeps it open", () => {
    renderPanel();
    fireEvent.click(warningsChip());

    fireEvent.pointerDown(warningsNote() ?? document.body);
    fireEvent.pointerDown(warningsChip());

    expect(warningsNote()).not.toBeNull();
  });

  it("opens only the warnings, swapping out an open facts panel", () => {
    renderPanel();
    fireEvent.click(infoTrigger());
    expect(warningsNote()).toBeNull();
    expect(
      document.querySelector('[data-details-section="artifact"]'),
    ).not.toBeNull();

    fireEvent.click(warningsChip());

    expect(document.activeElement).toBe(warningsNote());
    expect(document.querySelector("[data-details-section]")).toBeNull();
    expect(infoTrigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("a mouse on the chip previews the warnings and leaves focus put", () => {
    renderPanel();

    hoverWithMouse(warningsChip());

    expect(warningsNote()).not.toBeNull();
    expect(document.activeElement).not.toBe(warningsNote());
    expect(warningsChip().getAttribute("aria-expanded")).toBe("true");
  });

  it("a touch on the chip opens nothing before its tap", () => {
    renderPanel();

    fireEvent.pointerEnter(getHoverArea(warningsChip()), {
      pointerType: "touch",
    });

    expect(warningsNote()).toBeNull();
  });

  it("hovering the chip leaves an open facts panel in place", () => {
    renderPanel();
    fireEvent.click(infoTrigger());

    hoverWithMouse(warningsChip());

    expect(warningsNote()).toBeNull();
    expect(infoTrigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("a click on a hovered chip pins the warnings and lands focus in them", () => {
    renderPanel();
    hoverWithMouse(warningsChip());

    fireEvent.click(warningsChip());

    expect(warningsNote()).not.toBeNull();
    expect(document.activeElement).toBe(warningsNote());
    expect(warningsChip().getAttribute("aria-expanded")).toBe("true");
  });

  it("a click on a chip pinned after a hover collapses the warnings", () => {
    renderPanel();
    hoverWithMouse(warningsChip());
    fireEvent.click(warningsChip());

    fireEvent.click(warningsChip());

    expect(warningsNote()).toBeNull();
    expect(warningsChip().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(warningsChip());
  });

  it("sliding from the ⓘ preview onto the chip previews the warnings", () => {
    renderPanel();
    hoverWithMouse(infoTrigger());

    hoverWithMouse(warningsChip());

    expect(warningsNote()).not.toBeNull();
    expect(infoTrigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).not.toBe(warningsNote());
  });

  it("sliding from the chip preview onto the ⓘ previews the facts", () => {
    renderPanel();
    hoverWithMouse(warningsChip());

    hoverWithMouse(infoTrigger());

    expect(warningsNote()).toBeNull();
    expect(infoTrigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("hovering the ⓘ leaves pinned warnings in place", () => {
    renderPanel();
    fireEvent.click(warningsChip());

    hoverWithMouse(infoTrigger());

    expect(warningsNote()).not.toBeNull();
    expect(infoTrigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("closing via the ⓘ trigger keeps focus off <body> too", () => {
    renderPanel();
    fireEvent.click(warningsChip());
    fireEvent.click(infoTrigger());
    expect(warningsNote()).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("renders no chip on a clean generation", () => {
    renderPanel({ ...baseBrief, generationWarnings: [] });
    expect(
      document.querySelector("[data-generation-warnings-chip]"),
    ).toBeNull();
  });

  it("counts unique warnings and singularizes one", () => {
    renderPanel({
      ...baseBrief,
      generationWarnings: ["⚠ a", "⚠ a"],
    });
    expect(
      screen.getByRole("button", { name: /1 generation warning$/ }),
    ).toBeTruthy();
  });
});

describe("BriefDetailsPanel sections for a full brief", () => {
  it("Artifact: kind, short SHAs with copy, count and the LOC caveat", () => {
    renderPanel();
    fireEvent.click(infoTrigger());
    const artifact = document.querySelector(
      '[data-details-section="artifact"]',
    );
    const text = artifact?.textContent ?? "";
    expect(text).toContain("Brief");
    expect(text).not.toContain("_3");
    expect(text).not.toContain("b".repeat(40));
    expect(text).toContain("b".repeat(7));
    expect(text).toContain("a".repeat(7));
    expect(text).toContain("2 commits");
    expect(
      screen.getByRole("button", { name: `Copy full SHA ${"a".repeat(7)}` }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `Copy full SHA ${"b".repeat(7)}` }),
    ).toBeTruthy();
    expect(text).toContain("+137");
    expect(text).toContain("−76");
    expect(text).toContain("Core lines");
    expect(text).toContain("+104");
    expect(text).toContain("−41");
    expect(text).toContain("Counts are derived from the diff.");
    expect(text).toContain("reported as unattributed");
  });

  it("Generation: provider, model and effort, never the warnings", () => {
    renderPanel();
    fireEvent.click(infoTrigger());
    const generation = document.querySelector(
      '[data-details-section="generation"]',
    );
    const text = generation?.textContent ?? "";
    expect(text).toContain("anthropic");
    expect(text).toContain("claude-opus-4-8");
    expect(text).toContain("high");
    expect(text).not.toContain("salvaged brief");
  });

  it("keeps a multi-line warning in one list item inside a tab stop", () => {
    const warning = "⚠ loc coverage issues:\nfirst issue\nsecond issue";
    renderPanel({ ...baseBrief, generationWarnings: [warning] });
    fireEvent.click(warningsChip());

    const note = warningsNote();
    const items = note?.querySelectorAll("li") ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toBe(warning);
    expect(note?.getAttribute("tabindex")).toBe("0");
  });

  it("lists each warning as its own item", () => {
    const warnings = ["⚠ first long warning", "⚠ second long warning"];
    renderPanel({ ...baseBrief, generationWarnings: warnings });
    fireEvent.click(warningsChip());

    const region = screen.getByRole("region", { name: /warnings/i });
    const items = within(region).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(warnings);
    expect(within(region).getByRole("list").getAttribute("role")).toBe("list");
  });

  it("shows an anchor warning as its own counted line", () => {
    renderPanel({
      ...baseBrief,
      generationWarnings: [],
      anchorWarnings: [AnchorWarnings.SPAN_UNAVAILABLE],
    });
    fireEvent.click(warningsChip());

    const region = screen.getByRole("region", { name: /warnings/i });
    expect(warningsChip().textContent).toBe("1 generation warning");
    expect(
      within(region)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([appI18n.t("brief.details.anchorWarning.spanUnavailable")]);
  });

  it("lists anchor warnings before the pipeline's warning lines", () => {
    renderPanel({
      ...baseBrief,
      anchorWarnings: [AnchorWarnings.HUNKS_UNPAIRED],
    });
    fireEvent.click(warningsChip());

    const region = screen.getByRole("region", { name: /warnings/i });
    expect(warningsChip().textContent).toBe("2 generation warnings");
    expect(
      within(region)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      appI18n.t("brief.details.anchorWarning.hunksUnpaired"),
      "⚠ salvaged brief: dropped 1 entry",
    ]);
  });

  it("Repo config: reports no-config when no snapshot is present", () => {
    renderPanel();
    fireEvent.click(infoTrigger());
    expect(
      document.querySelector('[data-details-section="repo-config"]')
        ?.textContent,
    ).toContain("No .mergebrief configuration");
  });

  it("Repo config rows show a bidi override in a path as an escape", () => {
    renderPanel(baseBrief, {
      files: [
        {
          path: ".mergebrief/\u202Edm.instructions",
          blobSha: "a1",
          outcome: "applied",
        },
      ],
      collisions: [],
      policy: null,
    });
    fireEvent.click(infoTrigger());

    expect(
      screen.getByText(".mergebrief/[U+202E]dm.instructions"),
    ).toBeTruthy();
  });

  it("Repo config rows show file, applied and warning, never bytes or sha", () => {
    renderPanel(baseBrief, {
      files: [
        {
          path: ".mergebrief/instructions.md",
          blobSha: "a1b2c3d4e5f6",
          outcome: "applied",
          bytesUsed: 900,
          bytesBudget: 4096,
        },
        {
          path: ".mergebrief/policy.yaml",
          blobSha: "p1",
          outcome: "invalid",
          warning: "1 de-emphasis rule dropped",
        },
        {
          path: ".mergebrief/settings.yaml",
          blobSha: null,
          outcome: "absent",
        },
      ],
      collisions: ["touches-auth"],
      policy: null,
    });
    fireEvent.click(infoTrigger());
    const section = document.querySelector(
      '[data-details-section="repo-config"]',
    );
    const text = section?.textContent ?? "";
    expect(text).toContain(".mergebrief/instructions.md");
    expect(text).toContain("Applied");
    expect(text).toContain("Not applied");
    expect(text).toContain("1 de-emphasis rule dropped");
    expect(text).toContain("touches-auth");
    // Slimmed on purpose: bytes-of-budget and per-file blob SHAs dropped.
    expect(text).not.toContain("900");
    expect(text).not.toContain("a1b2c3d");
    // Absent files don't earn rows.
    expect(text).not.toContain("settings.yaml");
  });
});

describe("BriefDetailsPanel sections for a delta artifact", () => {
  it("Artifact: span with short SHAs and no commit range", () => {
    renderPanel(deltaBrief);
    fireEvent.click(infoTrigger());
    const artifact = document.querySelector(
      '[data-details-section="artifact"]',
    );
    const text = artifact?.textContent ?? "";
    expect(text).toContain("Delta brief");
    expect(text).not.toContain("_2");
    expect(text).toContain("c".repeat(7));
    expect(text).toContain("a".repeat(7));
    const spanArrow = artifact?.querySelector('[data-icon="arrow-up"]');
    expect(spanArrow?.getAttribute("data-rotation")).toBe("90");
    expect(text).not.toContain("c".repeat(40));
    expect(text).not.toContain(appI18n.t("brief.details.commitRange"));
  });
});

describe("BriefDetailsPanel split section", () => {
  it("keeps each share's lines and percent behind the trigger", () => {
    renderPanel();
    fireEvent.click(infoTrigger());

    const section = screen.getByTestId("details-split").textContent;
    expect(section).toContain("Implementation");
    expect(section).toContain("+40");
    expect(section).toContain("50%");
    expect(section).toContain("Unattributed");
  });
});

describe("BriefDetailsPanel SHA copy labels", () => {
  it.each([
    ["commit range", baseBrief],
    ["delta span", deltaBrief],
  ])("keeps the facts open on each %s SHA's copy label", (_kind, brief) => {
    startColdCalloutTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    renderPanel(brief);
    fireEvent.click(infoTrigger());
    const shaButtons = screen.getAllByRole("button", { name: /Copy full SHA/ });
    expect(shaButtons).toHaveLength(2);

    for (const shaButton of shaButtons) {
      const label = shaButton.getAttribute("aria-label") ?? "";
      const panel = shaButton.closest("[data-callout]");
      fireEvent.pointerEnter(shaButton, { pointerType: "mouse" });
      act(() => {
        vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
      });
      const tip = screen.getByText(label).closest("[data-callout]");
      if (panel === null || tip === null) {
        throw new Error("the SHA or its label sits outside a callout");
      }
      expect(panel.contains(tip)).toBe(false);

      fireEvent.mouseLeave(panel, { relatedTarget: tip, clientX: 50 });
      expect(infoTrigger().getAttribute("aria-expanded")).toBe("true");
    }
  });
});

describe("BriefDetailsPanel focus leaving the facts", () => {
  const pageControl = document.createElement("button");

  afterEach(() => {
    pageControl.remove();
  });

  function renderFocusedOnSha(): HTMLElement | undefined {
    document.body.append(pageControl);
    renderPanel();
    fireEvent.click(infoTrigger());
    const [firstSha] = screen.getAllByRole("button", { name: /Copy full SHA/ });
    firstSha?.focus();
    return firstSha;
  }

  it("closes when focus moves from the facts to a page control", async () => {
    renderFocusedOnSha();

    await act(async () => {
      pageControl.focus();
      await Promise.resolve();
    });

    expect(infoTrigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(pageControl);
  });

  it("stays open when the window loses focus", async () => {
    const firstSha = renderFocusedOnSha();

    await act(async () => {
      firstSha?.blur();
      await Promise.resolve();
    });

    expect(infoTrigger().getAttribute("aria-expanded")).toBe("true");
  });
});

describe("BriefDetailsPanel warnings opened by a click", () => {
  it("close when focus moves out to a page control", async () => {
    const pageControl = document.createElement("button");
    document.body.append(pageControl);
    onTestFinished(() => pageControl.remove());
    renderPanel();
    fireEvent.click(warningsChip());

    await act(async () => {
      pageControl.focus();
      await Promise.resolve();
    });

    expect(warningsNote()).toBeNull();
    expect(document.activeElement).toBe(pageControl);
  });
});

/** Longer than safePolygon's 40ms close timer, so a stale close has fired. */
const PAST_CLOSE_TIMER_MS = 80;

async function waitPastCloseTimer() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, PAST_CLOSE_TIMER_MS));
  });
}

/**
 * One mousemove from one trigger onto the next: the pointer events land
 * before the mouseleave that ends the first surface's hover.
 */
async function slideInOneMove(from: HTMLElement, to: HTMLElement) {
  act(() => {
    fireEvent.pointerLeave(getHoverArea(from), { pointerType: "mouse" });
    fireEvent.pointerEnter(getHoverArea(to), { pointerType: "mouse" });
    fireEvent.mouseLeave(from, { relatedTarget: to, clientX: 5, clientY: 10 });
  });
  await waitPastCloseTimer();
}

/** Leave one trigger for open page, let its surface close, then enter the next. */
async function slideWithPause(from: HTMLElement, to: HTMLElement) {
  act(() => {
    fireEvent.pointerLeave(getHoverArea(from), { pointerType: "mouse" });
    fireEvent.mouseLeave(from, { relatedTarget: document.body, clientY: 0 });
  });
  await waitPastCloseTimer();
  hoverWithMouse(to);
}

const SLIDES = [
  ["in one move", slideInOneMove],
  ["with a pause", slideWithPause],
] as const;

/** A mouse resting on the chip with its warnings open, pinned or previewed. */
function openWarningsUnderMouse(pinned: boolean) {
  hoverWithMouse(warningsChip());
  if (pinned) {
    fireEvent.click(warningsChip());
  }
}

/** A mouse resting on the ⓘ with the facts open, pinned or previewed. */
function openFactsUnderMouse(pinned: boolean) {
  if (pinned) {
    fireEvent.click(infoTrigger());
  }
  hoverWithMouse(infoTrigger());
}

describe("BriefDetailsPanel sliding between the chip and the ⓘ", () => {
  it.each(SLIDES)("chip preview to ⓘ %s shows the facts", async (_, slide) => {
    renderPanel();
    openWarningsUnderMouse(false);

    await slide(warningsChip(), infoTrigger());

    expect(infoTrigger().getAttribute("aria-expanded")).toBe("true");
    expect(warningsNote()).toBeNull();
  });

  it.each([
    ["in one move", slideInOneMove, infoTrigger],
    ["with a pause", slideWithPause, warningsChip],
  ] as const)("pinned chip to ⓘ %s shows the facts", async (_, slide, home) => {
    renderPanel();
    openWarningsUnderMouse(true);
    expect(document.activeElement).toBe(warningsNote());

    await slide(warningsChip(), infoTrigger());

    expect(infoTrigger().getAttribute("aria-expanded")).toBe("true");
    expect(warningsNote()).toBeNull();
    expect(document.activeElement).toBe(home());
  });

  it.each(SLIDES)(
    "ⓘ preview to chip %s shows the warnings",
    async (_, slide) => {
      renderPanel();
      openFactsUnderMouse(false);

      await slide(infoTrigger(), warningsChip());

      expect(warningsChip().getAttribute("aria-expanded")).toBe("true");
      expect(infoTrigger().getAttribute("aria-expanded")).toBe("false");
    },
  );

  it.each(SLIDES)(
    "pinned ⓘ to chip %s shows the warnings",
    async (_, slide) => {
      renderPanel();
      openFactsUnderMouse(true);

      await slide(infoTrigger(), warningsChip());

      expect(warningsChip().getAttribute("aria-expanded")).toBe("true");
      expect(infoTrigger().getAttribute("aria-expanded")).toBe("false");
    },
  );

  it.each([false, true])(
    "leaving the chip for the page closes all",
    async (pinned) => {
      renderPanel();
      openWarningsUnderMouse(pinned);

      act(() => {
        fireEvent.pointerLeave(getHoverArea(warningsChip()), {
          pointerType: "mouse",
        });
        fireEvent.mouseLeave(warningsChip(), {
          relatedTarget: document.body,
          clientY: 0,
        });
      });
      await waitPastCloseTimer();

      expect(warningsNote()).toBeNull();
      expect(infoTrigger().getAttribute("aria-expanded")).toBe("false");
    },
  );

  it("Escape with the mouse on the ⓘ opens nothing in place", () => {
    renderPanel();
    openWarningsUnderMouse(true);
    hoverWithMouse(infoTrigger());

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(warningsNote()).toBeNull();
    expect(infoTrigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(warningsChip());
  });

  it("a leave after Escape in the facts opens no stale facts", async () => {
    renderPanel();
    openFactsUnderMouse(false);
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(warningsChip());

    act(() => {
      fireEvent.mouseLeave(warningsChip(), {
        relatedTarget: document.body,
        clientY: 0,
      });
    });
    await waitPastCloseTimer();

    expect(warningsNote()).toBeNull();
    expect(infoTrigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("a tap on the ⓘ swaps tapped warnings for the facts", () => {
    renderPanel();
    fireEvent.pointerEnter(getHoverArea(warningsChip()), {
      pointerType: "touch",
    });
    fireEvent.click(warningsChip());
    fireEvent.pointerEnter(getHoverArea(infoTrigger()), {
      pointerType: "touch",
    });

    fireEvent.click(infoTrigger());

    expect(warningsNote()).toBeNull();
    expect(infoTrigger().getAttribute("aria-expanded")).toBe("true");
  });
});

describe("BriefDetailsPanel clicking the other trigger over a pinned surface", () => {
  /** A press that focuses its target first, as Chrome's mousedown does. */
  async function pressWithMouse(trigger: HTMLElement) {
    await act(async () => {
      trigger.focus();
      await Promise.resolve();
    });
    await waitPastCloseTimer();
    fireEvent.click(trigger);
  }

  it("a click on the ⓘ over keyboard-pinned warnings opens the facts", async () => {
    renderPanel();
    fireEvent.click(warningsChip());
    expect(document.activeElement).toBe(warningsNote());
    hoverWithMouse(infoTrigger());

    await pressWithMouse(infoTrigger());

    expect(infoTrigger().getAttribute("aria-expanded")).toBe("true");
    expect(warningsNote()).toBeNull();
  });

  it("a click on the chip over keyboard-pinned facts opens the warnings", async () => {
    renderPanel();
    await pressWithMouse(infoTrigger());
    expect(document.activeElement).toBe(infoTrigger());
    hoverWithMouse(warningsChip());

    await pressWithMouse(warningsChip());

    expect(warningsChip().getAttribute("aria-expanded")).toBe("true");
    expect(infoTrigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(warningsNote());
  });
});
