// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Brief } from "../../../../model/types";
import type { ProgressTotals } from "../../../utils/progress";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import { briefFixture } from "../../../../test-utils/fixtures";
import { renderInRouter } from "../../../../../../test/router";
import { LargeTitle } from ".";

const brief: Brief = {
  ...briefFixture,
  generation: { provider: "anthropic", model: "m-1", effort: "high" },
};

function ignoreBlock(): void {}

const MANY_TOTALS: ProgressTotals = {
  reviewed: 0,
  chunkTotal: 6,
  flagsResolved: 0,
  flagTotal: 2,
};

async function renderLargeTitle(
  ownDraft = false,
  attach: (node: HTMLDivElement | null) => void = ignoreBlock,
  totals: ProgressTotals = MANY_TOTALS,
) {
  await renderInRouter(
    <LargeTitle
      authorLogin="mira-k"
      brief={brief}
      model={buildBriefViewModel(brief)}
      ownDraft={ownDraft}
      ref={attach}
      totals={totals}
    />,
  );
  return screen.getByTestId("large-title");
}

describe("LargeTitle", () => {
  it("repeats the title for sight only and hands its block on", async () => {
    let attached: HTMLDivElement | null = null;
    const block = await renderLargeTitle(false, (node) => {
      attached = node;
    });

    expect(attached).toBe(block);
    expect(screen.queryByRole("heading")).toBeNull();
    const title = within(block).getByText(brief.pr.title);
    expect(title.getAttribute("aria-hidden")).toBe("true");
  });

  it("carries the PR identity and the provenance", async () => {
    const block = await renderLargeTitle();

    expect(within(block).getByTestId("author-chip").textContent).toContain(
      "mira-k",
    );
    expect(within(block).getByRole("link", { name: /#42/ })).toBeTruthy();
    expect(block.querySelector("[data-provider-badge]")).not.toBeNull();
  });

  it("labels the viewer's own draft", async () => {
    const block = await renderLargeTitle(true);

    expect(within(block).getByText("Self-review: your draft")).toBeTruthy();
  });

  it.each([
    [1, "chunk1", "flag1"],
    [6, "chunks6", "flags6"],
  ])(
    "labels %i chunks and flags in the plural they take",
    async (count, chunks, flags) => {
      const totals = { ...MANY_TOTALS, chunkTotal: count, flagTotal: count };
      const block = await renderLargeTitle(false, ignoreBlock, totals);
      const facts = within(block)
        .getAllByRole("definition")
        .map((value) => value.parentElement?.textContent);

      expect(facts.slice(0, 2)).toEqual([chunks, flags]);
    },
  );

  it("names each fact with its term ahead of its value", async () => {
    const block = await renderLargeTitle();
    const pairs = within(block)
      .getAllByRole("term")
      .map((term) => term.nextElementSibling?.tagName);

    expect(pairs).toEqual(["DD", "DD", "DD"]);
  });
});
