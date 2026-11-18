// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubExitTransition } from "@web/test/transitions";
import { DismissModal } from ".";

const EXIT_MS = 120;
const TARGET = { flagIds: ["flag-1"], label: "Auth change in session.ts" };

function stubProps() {
  return {
    reason: "",
    warned: false,
    cancel: vi.fn(),
    confirm: vi.fn(),
    setReason: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DismissModal", () => {
  it("keeps the target label through the exit fade", () => {
    vi.useFakeTimers();
    const exitStyle = stubExitTransition(EXIT_MS);
    const props = stubProps();
    const { rerender } = render(<DismissModal {...props} target={TARGET} />);

    rerender(<DismissModal {...props} target={null} />);
    expect(screen.getByText(TARGET.label)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(EXIT_MS);
    });
    expect(screen.queryByText(TARGET.label)).toBeNull();
    exitStyle.remove();
  });

  it("ties the short-reason warning to the reason field, not as an error", () => {
    render(<DismissModal {...stubProps()} target={TARGET} warned />);
    const field = screen.getByRole("textbox", {
      name: "Dismissal reason",
    });

    expect(field.getAttribute("aria-describedby")).toBe(
      screen.getByRole("alert").id,
    );
    expect(field.hasAttribute("aria-invalid")).toBe(false);
  });

  it("drops the reason field's tie once the warning clears", () => {
    const props = stubProps();
    const { rerender } = render(
      <DismissModal {...props} target={TARGET} warned />,
    );

    rerender(<DismissModal {...props} target={TARGET} warned={false} />);

    const field = screen.getByRole("textbox", {
      name: "Dismissal reason",
    });
    expect(field.hasAttribute("aria-describedby")).toBe(false);
  });
});
