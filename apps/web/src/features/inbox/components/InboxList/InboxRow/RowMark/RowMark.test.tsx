// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { InboxReviewStates } from "types/inbox";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CALLOUT_HOVER_DELAY_MS } from "@web/components/Callout/consts";
import { startColdCalloutTimers } from "@web/test/callouts";
import { UnknownValues } from "@web/utils/open-enum/types";

import { RowMark } from ".";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function restOnMark(): HTMLElement {
  const mark = screen.getByTestId("inbox-row-mark");
  fireEvent.pointerEnter(mark);
  act(() => {
    vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
  });
  return mark;
}

describe("RowMark", () => {
  it("names its state in a callout once the pointer has rested on it", () => {
    startColdCalloutTimers();
    render(<RowMark reviewState={InboxReviewStates.UPDATED} />);

    fireEvent.pointerEnter(screen.getByTestId("inbox-row-mark"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
    });

    expect(screen.getByRole("tooltip").textContent).toBe(
      "Updated since your review",
    );
  });

  it("closes the callout when the pointer leaves the mark", () => {
    startColdCalloutTimers();
    render(<RowMark reviewState={InboxReviewStates.NEW} />);
    const mark = restOnMark();
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.mouseLeave(mark);
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows nothing when the pointer leaves before the delay", () => {
    startColdCalloutTimers();
    render(<RowMark reviewState={undefined} />);
    const mark = screen.getByTestId("inbox-row-mark");

    fireEvent.pointerEnter(mark);
    fireEvent.pointerLeave(mark);
    act(() => {
      vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(mark.getAttribute("data-review")).toBe("yours");
  });

  it("draws no mark and no callout for an unknown review state", () => {
    render(<RowMark reviewState={UnknownValues.UNKNOWN} />);
    const mark = screen.getByTestId("inbox-row-mark");

    expect(mark.getAttribute("data-review")).toBe(UnknownValues.UNKNOWN);
    expect(mark.childElementCount).toBe(0);
  });
});
