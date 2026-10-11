// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Brief } from "../../../../model/types";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import { briefFixture } from "../../../../test-utils/fixtures";
import { renderInRouter } from "../../../../../../test/router";
import { LargeTitle } from ".";

afterEach(cleanup);

const brief: Brief = {
  ...briefFixture,
  generation: { provider: "anthropic", model: "m-1", effort: "high" },
};

function ignoreBlock(): void {}

async function renderLargeTitle(
  ownDraft = false,
  attach: (node: HTMLDivElement | null) => void = ignoreBlock,
) {
  await renderInRouter(
    <LargeTitle
      authorLogin="mira-k"
      brief={brief}
      model={buildBriefViewModel(brief)}
      ownDraft={ownDraft}
      ref={attach}
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

    expect(within(block).getByText("Self-review — your draft")).toBeTruthy();
  });
});
