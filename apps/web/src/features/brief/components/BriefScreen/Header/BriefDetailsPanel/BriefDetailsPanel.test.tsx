// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Brief } from "../../../../types";
import { BriefDetailsPanel } from "./BriefDetailsPanel";

afterEach(cleanup);

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

  it("Escape closes at capture — the key never reaches page shortcuts", () => {
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
});

describe("warnings-chip trigger", () => {
  it("opens the panel landed on the warnings text (focused role=note)", () => {
    renderPanel();
    fireEvent.click(warningsChip());
    const note = warningsNote();
    expect(note?.getAttribute("role")).toBe("note");
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

  it("lands on the warnings text even when the panel is ALREADY open plain", () => {
    renderPanel();
    fireEvent.click(infoTrigger());
    expect(warningsNote()).toBeTruthy();
    expect(document.activeElement).not.toBe(warningsNote());
    fireEvent.click(warningsChip());
    expect(document.activeElement).toBe(warningsNote());
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

describe("BriefDetailsPanel sections — full brief", () => {
  it("Artifact: kind, index, commit range + count, FULL SHAs, LOC caveat", () => {
    renderPanel();
    fireEvent.click(infoTrigger());
    const artifact = document.querySelector(
      '[data-details-section="artifact"]',
    );
    const text = artifact?.textContent ?? "";
    expect(text).toContain("brief");
    expect(text).toContain("_3");
    expect(text).toContain(`${"b".repeat(8)}..${"a".repeat(8)} · 2 commits`);
    // Full SHAs — this panel is the untruncated home.
    expect(text).toContain("b".repeat(40));
    expect(text).toContain("a".repeat(40));
    expect(text).toContain("+137");
    expect(text).toContain("−76");
    expect(text).toContain("core lines");
    expect(text).toContain("+104");
    expect(text).toContain("−41");
    expect(text).toContain("Counts are derived from the diff.");
    expect(text).toContain("reported as unattributed");
  });

  it("Generation: provider, model, effort, warnings text", () => {
    renderPanel();
    fireEvent.click(infoTrigger());
    const generation = document.querySelector(
      '[data-details-section="generation"]',
    );
    const text = generation?.textContent ?? "";
    expect(text).toContain("anthropic");
    expect(text).toContain("claude-opus-4-8");
    expect(text).toContain("high");
    expect(text).toContain("salvaged brief");
  });

  it("Repo config: reports no-config when no snapshot is present", () => {
    renderPanel();
    fireEvent.click(infoTrigger());
    expect(
      document.querySelector('[data-details-section="repo-config"]')
        ?.textContent,
    ).toContain("No .mergebrief configuration");
  });

  it("Repo config: slimmed rows — file + applied-or-not + warning; no bytes, no per-file sha", () => {
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
    expect(text).toContain("applied");
    expect(text).toContain("not applied");
    expect(text).toContain("1 de-emphasis rule dropped");
    expect(text).toContain("touches-auth");
    // Slimmed on purpose: bytes-of-budget and per-file blob SHAs dropped.
    expect(text).not.toContain("900");
    expect(text).not.toContain("a1b2c3d");
    // Absent files don't earn rows.
    expect(text).not.toContain("settings.yaml");
  });
});

describe("BriefDetailsPanel sections — delta artifact", () => {
  it("Artifact: span with indices and full SHAs, no commit range", () => {
    renderPanel(deltaBrief);
    fireEvent.click(infoTrigger());
    const artifact = document.querySelector(
      '[data-details-section="artifact"]',
    );
    const text = artifact?.textContent ?? "";
    expect(text).toContain("delta");
    expect(text).toContain("_2 → _3");
    expect(text).toContain("c".repeat(40));
    expect(text).toContain("a".repeat(40));
    expect(text).not.toContain("commit range");
  });
});
