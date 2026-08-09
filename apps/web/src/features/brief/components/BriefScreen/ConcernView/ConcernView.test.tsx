// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseBrief } from "../../../utils/validation";
import { buildBriefViewModel } from "../../../utils/viewModel";
import { ConcernView } from "./ConcernView";

afterEach(cleanup);

function fixtureBrief() {
  const parsed = parseBrief({
    pr: {
      repo: "o/r",
      number: 1,
      title: "t",
      url: "https://github.com/o/r/pull/1",
      sha: "deadbeef",
      description: "d",
    },
    summary: "s",
    changeGroups: [
      {
        id: "g1",
        title: "t",
        summary: "s",
        dominantCategory: "new-feature",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks: [
      {
        id: "c1",
        changeGroupId: "g1",
        file: "services/billing/invoice.ts",
        concern: "implementation",
        role: "carrier",
        loc: { added: 2, deleted: 0 },
        addedRanges: [{ start: 1, end: 2 }],
        removedRanges: [],
        riskSurface: ["touches-billing", "widens-error-handling"],
      },
    ],
    concernView: [{ concern: "implementation", added: 2, deleted: 0 }],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const SNAPSHOT = {
  files: [],
  collisions: [],
  policy: {
    firedCustomAttributes: [
      { name: "touches-billing", criteria: "modifies invoicing code" },
    ],
    deEmphasize: [{ attribute: "widens-error-handling" }],
  },
};

describe("ConcernView repo-config display weight", () => {
  it("renders source-variant and de-emphasized chips with data-attrs", () => {
    const brief = fixtureBrief();
    const model = buildBriefViewModel(brief, SNAPSHOT);
    render(<ConcernView brief={brief} model={model} jumpToChunk={() => {}} />);

    const lane = screen
      .getByText("touches-billing")
      .closest("[data-concern-risk]");
    expect(lane).not.toBeNull();
    const billing = screen
      .getByText("touches-billing")
      .closest("[data-source]");
    expect(billing?.getAttribute("data-source")).toBe("repo-policy");
    const quiet = screen
      .getByText("widens-error-handling")
      .closest("[data-deemphasized]");
    expect(quiet).not.toBeNull();
  });

  it("shows the risk-details disclosure for de-emphasized-only rows (dotted state explained)", () => {
    const brief = fixtureBrief();
    const model = buildBriefViewModel(brief, {
      files: [],
      collisions: [],
      policy: {
        firedCustomAttributes: [],
        deEmphasize: [{ attribute: "widens-error-handling" }],
      },
    });
    render(<ConcernView brief={brief} model={model} jumpToChunk={() => {}} />);
    expect(screen.getByRole("button", { name: /risk details/ })).toBeTruthy();
  });

  it("without a snapshot every chip is a loud built-in", () => {
    const brief = fixtureBrief();
    const model = buildBriefViewModel(brief);
    render(<ConcernView brief={brief} model={model} jumpToChunk={() => {}} />);
    const chip = screen.getByText("touches-billing").closest("[data-source]");
    expect(chip?.getAttribute("data-source")).toBe("built-in");
    expect(
      screen.getByText("widens-error-handling").closest("[data-deemphasized]"),
    ).toBeNull();
  });
});
