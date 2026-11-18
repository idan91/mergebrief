// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
    expect(section?.textContent).toContain("Applied");
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
    expect(chip?.textContent).toContain("Repo config @ a1b2c3d");
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

describe("tool-access note", () => {
  afterEach(cleanup);

  it.each(["codex", "cursor"])(
    "names %s as a CLI with tool access",
    (provider) => {
      renderProvenance({
        brief: {
          ...brief,
          generation: { provider, model: "m-1", effort: "high" },
        },
      });

      expect(screen.getByTestId("tool-access-note").textContent).toBe(
        "A local CLI that can run tools wrote this brief, so instructions in the PR could have shaped it. Check its claims against the diff.",
      );
    },
  );

  it.each(["claude-code", "anthropic"])("shows no note for %s", (provider) => {
    renderProvenance({
      brief: {
        ...brief,
        generation: { provider, model: "m-1", effort: "high" },
      },
    });

    expect(screen.queryByTestId("tool-access-note")).toBeNull();
  });
});
