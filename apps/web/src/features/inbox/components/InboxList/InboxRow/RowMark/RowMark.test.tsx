// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { InboxReviewStates } from "types/inbox";
import { afterEach, describe, expect, it } from "vitest";

import { UnknownValues } from "@web/utils/open-enum/types";

import { RowMark } from ".";

afterEach(cleanup);

describe("RowMark", () => {
  it("draws the review state's mark", () => {
    render(<RowMark reviewState={InboxReviewStates.UPDATED} />);
    const mark = screen.getByTestId("inbox-row-mark");

    expect(mark.getAttribute("data-review")).toBe(InboxReviewStates.UPDATED);
    expect(mark.childElementCount).toBe(1);
  });

  it("marks the viewer's own pull request as theirs", () => {
    render(<RowMark reviewState={undefined} />);

    expect(
      screen.getByTestId("inbox-row-mark").getAttribute("data-review"),
    ).toBe("yours");
  });

  it("draws no mark for an unknown review state", () => {
    render(<RowMark reviewState={UnknownValues.UNKNOWN} />);
    const mark = screen.getByTestId("inbox-row-mark");

    expect(mark.getAttribute("data-review")).toBe(UnknownValues.UNKNOWN);
    expect(mark.childElementCount).toBe(0);
  });
});
