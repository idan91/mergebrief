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

import { RowLead, type RowLeadProps } from ".";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderLead(overrides: Partial<RowLeadProps> = {}): RowLeadProps {
  const props: RowLeadProps = {
    className: undefined,
    reviewState: InboxReviewStates.UPDATED,
    title: "Alpha",
    selected: false,
    onSelect: vi.fn(),
    ...overrides,
  };
  render(<RowLead {...props} />);
  return props;
}

/** The checkbox's label sits on top of the slot, so it is what a pointer meets. */
function readPointerTarget(): HTMLElement {
  const label = screen.getByRole("checkbox").closest("label");
  if (label === null) {
    throw new Error("the row checkbox has no label");
  }
  return label;
}

function restPointer(target: HTMLElement): void {
  fireEvent.pointerEnter(target);
  act(() => {
    vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
  });
}

function focusByKeyboard(input: HTMLElement): void {
  vi.spyOn(input, "matches").mockImplementation(
    (selector) => selector === ":focus-visible",
  );
  fireEvent.focus(input);
}

describe("RowLead", () => {
  it("names the row state once the pointer rests on the slot", () => {
    startColdCalloutTimers();
    renderLead();

    fireEvent.pointerEnter(readPointerTarget());
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
    });

    expect(screen.getByRole("tooltip").textContent).toBe(
      "Updated since your review",
    );
  });

  it("names the viewer's own pull request in the callout", () => {
    startColdCalloutTimers();
    renderLead({ reviewState: undefined });

    restPointer(readPointerTarget());

    expect(screen.getByRole("tooltip").textContent).toBe(
      "Yours: you opened this pull request",
    );
  });

  it("closes the callout when the pointer leaves the slot", () => {
    startColdCalloutTimers();
    renderLead();
    const target = readPointerTarget();
    restPointer(target);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.mouseLeave(screen.getByTestId("inbox-row-lead"));
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens nothing for a pointer passing over before the delay", () => {
    startColdCalloutTimers();
    renderLead();
    const target = readPointerTarget();

    fireEvent.pointerEnter(target);
    fireEvent.pointerLeave(target);
    act(() => {
      vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens nothing for a touch on the slot", () => {
    startColdCalloutTimers();
    renderLead();

    fireEvent.pointerEnter(readPointerTarget(), { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(CALLOUT_HOVER_DELAY_MS);
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("names the row state at once on keyboard focus and closes on blur", () => {
    renderLead({ reviewState: InboxReviewStates.NEW });
    const checkbox = screen.getByRole("checkbox");

    focusByKeyboard(checkbox);
    expect(screen.getByRole("tooltip").textContent).toBe("New");

    fireEvent.blur(checkbox);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens nothing when a click focuses the checkbox", () => {
    renderLead();

    fireEvent.focus(screen.getByRole("checkbox"));

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("ticks the checkbox while the state callout is open", () => {
    startColdCalloutTimers();
    const props = renderLead();
    restPointer(readPointerTarget());

    fireEvent.click(screen.getByRole("checkbox"));

    expect(props.onSelect).toHaveBeenCalledWith(true, false);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("passes a shift-click on as a range", () => {
    const props = renderLead();

    fireEvent.click(screen.getByRole("checkbox"), { shiftKey: true });

    expect(props.onSelect).toHaveBeenCalledWith(true, true);
  });

  it("keeps the state out of the checkbox's name and description", () => {
    renderLead();
    const checkbox = screen.getByRole("checkbox", { name: "Select Alpha" });

    focusByKeyboard(checkbox);

    expect(screen.getByRole("tooltip")).toBeTruthy();
    vi.restoreAllMocks();
    expect(checkbox.getAttribute("aria-describedby")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBe(
      checkbox,
    );
  });

  it("opens no callout for an unknown review state", () => {
    startColdCalloutTimers();
    renderLead({ reviewState: UnknownValues.UNKNOWN });
    const checkbox = screen.getByRole("checkbox");

    restPointer(readPointerTarget());
    focusByKeyboard(checkbox);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
