// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompareParams } from "../../../../model/comparison/types";
import { makeComparisonState } from "../../../../test-utils";
import { ChangeStepper } from ".";

afterEach(cleanup);

describe("ChangeStepper", () => {
  it("renders nothing with compare off", () => {
    render(
      <ChangeStepper
        comparison={makeComparisonState(CompareParams.OFF, 0)}
        jumpNext={vi.fn()}
        jumpPrev={vi.fn()}
      />,
    );

    expect(screen.queryByRole("group")).toBeNull();
  });

  it("renders nothing when the comparison found no change", () => {
    render(
      <ChangeStepper
        comparison={makeComparisonState(CompareParams.PREVIOUS_BRIEF, 0)}
        jumpNext={vi.fn()}
        jumpPrev={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Next change" })).toBeNull();
  });

  it.each([
    [1, "1 change"],
    [4, "4 changes"],
  ])("counts %i changed runs as %s", (runCount, label) => {
    render(
      <ChangeStepper
        comparison={makeComparisonState(CompareParams.PREVIOUS_BRIEF, runCount)}
        jumpNext={vi.fn()}
        jumpPrev={vi.fn()}
      />,
    );

    expect(screen.getByRole("group").textContent).toBe(label);
  });

  it.each([
    [CompareParams.LAST_REVIEW, "Jump between changes since your last review"],
    [CompareParams.PREVIOUS_BRIEF, "Jump between changes in this revision"],
  ])("names the group for the %s baseline", (compare, name) => {
    render(
      <ChangeStepper
        comparison={makeComparisonState(compare, 2)}
        jumpNext={vi.fn()}
        jumpPrev={vi.fn()}
      />,
    );

    expect(screen.getByRole("group", { name })).toBeTruthy();
  });

  it("steps each way", () => {
    const jumpNext = vi.fn();
    const jumpPrev = vi.fn();
    render(
      <ChangeStepper
        comparison={makeComparisonState(CompareParams.PREVIOUS_BRIEF, 2)}
        jumpNext={jumpNext}
        jumpPrev={jumpPrev}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next change" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous change" }));

    expect(jumpNext).toHaveBeenCalledTimes(1);
    expect(jumpPrev).toHaveBeenCalledTimes(1);
  });

  it("marks the sheet layout only where it sits in a sheet", () => {
    const comparison = makeComparisonState(CompareParams.PREVIOUS_BRIEF, 2);
    const { rerender } = render(
      <ChangeStepper
        comparison={comparison}
        jumpNext={vi.fn()}
        jumpPrev={vi.fn()}
      />,
    );
    expect(screen.getByRole("group").dataset["layout"]).toBeUndefined();

    rerender(
      <ChangeStepper
        comparison={comparison}
        jumpNext={vi.fn()}
        jumpPrev={vi.fn()}
        sheet
      />,
    );

    expect(screen.getByRole("group").dataset["layout"]).toBe("sheet");
  });
});
