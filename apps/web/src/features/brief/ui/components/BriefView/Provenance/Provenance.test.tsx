// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Brief } from "../../../../model/types";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import { briefFixture } from "../../../../test-utils/fixtures";
import { Provenance, type ProvenanceProps } from ".";

const brief: Brief = {
  ...briefFixture,
  generation: { provider: "anthropic", model: "m-1", effort: "high" },
};

function renderProvenance(overrides: Partial<ProvenanceProps> = {}) {
  const props: ProvenanceProps = {
    brief,
    model: buildBriefViewModel(overrides.brief ?? brief),
    ...overrides,
  };
  return render(<Provenance {...props} />);
}

describe("Provenance", () => {
  it("renders the keycap origin badge", () => {
    renderProvenance();
    const badge = document.querySelector("[data-provider-badge]");
    expect(badge?.textContent).toContain("m-1 · high");
    expect(badge?.textContent).toContain("API");
    expect(document.querySelector("[data-origin]")).toBeNull();
  });
});

describe("generation warnings chip", () => {
  const warned = {
    ...brief,
    generationWarnings: [
      "⚠ salvaged brief: dropped 1 invalid tags entry",
      "warning: requested model m-1 but modelUsage reports m-2 — origin stamp stays the declaration",
      // Duplicate - the chip counts unique events.
      "⚠ salvaged brief: dropped 1 invalid tags entry",
    ],
  };

  it("opens the Brief-details panel LANDED on the warnings text", () => {
    renderProvenance({ brief: warned });
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

  it("Escape closes the panel without reaching page shortcuts", () => {
    renderProvenance({ brief: warned });
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

  it("singularizes a single warning", () => {
    renderProvenance({
      brief: { ...brief, generationWarnings: ["⚠ salvaged brief"] },
    });
    expect(
      screen.getByRole("button", { name: /1 generation warning$/ }),
    ).toBeTruthy();
  });

  it("renders no chip on a clean generation", () => {
    renderProvenance();
    expect(
      document.querySelector("[data-generation-warnings-chip]"),
    ).toBeNull();
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

  it("renders no chip in the ok state", () => {
    renderProvenance({ repoConfig: APPLIED });
    expect(document.querySelector("[data-repo-config-chip]")).toBeNull();
    // The panel's Repo config section carries the ok-state instead.
    fireEvent.click(screen.getByRole("button", { name: "Brief details" }));
    const section = document.querySelector(
      '[data-details-section="repo-config"]',
    );
    expect(section?.textContent).toContain(".mergebrief/instructions.md");
    expect(section?.textContent).toContain("applied");
  });

  it("keeps the warning chip, with the applied sha in its label", () => {
    renderProvenance({
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

  it("flips to the warning state on any error outcome", () => {
    renderProvenance({
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
    renderProvenance({
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
    renderProvenance({});
    expect(document.querySelector("[data-repo-config-chip]")).toBeNull();
  });
});

describe("repo-config chip flips to warning when an applied file warns", () => {
  it("a warning on an applied file is a config error the author must see", () => {
    renderProvenance({
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
