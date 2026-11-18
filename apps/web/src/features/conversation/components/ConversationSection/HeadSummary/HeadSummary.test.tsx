// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { HeadSummaryPart } from "../utils";
import { HeadSummary } from ".";

const PARTS: readonly HeadSummaryPart[] = [
  { i18nKey: "conversation.summaryReviews", count: 2 },
  { i18nKey: "conversation.summaryComments", count: 1 },
  { i18nKey: "conversation.summaryThreadsCounted", count: 3, open: 1 },
];

function readCounts(part: Element): (string | null)[] {
  return [...part.querySelectorAll("b")].map((count) => count.textContent);
}

describe("HeadSummary", () => {
  afterEach(cleanup);

  it("sets every count apart from its noun, part by part", () => {
    const { container } = render(<HeadSummary parts={PARTS} />);

    const parts = [...(container.firstElementChild?.children ?? [])];
    const counts = parts.map(readCounts);
    expect(parts.map((part) => part.textContent)).toEqual([
      "2 reviews",
      "1 comment",
      "3 threads · 1 open",
    ]);
    expect(counts).toEqual([["2"], ["1"], ["3", "1"]]);
  });

  it("prints a zero open count instead of dropping it", () => {
    const { container } = render(
      <HeadSummary
        parts={[
          { i18nKey: "conversation.summaryThreadsCounted", count: 3, open: 0 },
        ]}
      />,
    );

    expect(container.textContent).toBe("3 threads · 0 open");
  });
});
