// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "../components/Button";
import { useFocusTrap } from "./useFocusTrap";

afterEach(cleanup);

function Trap({ empty = false }: { empty?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onKeyDown = useFocusTrap(ref);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keydown is the trap under test
    <div
      aria-label="trap"
      data-testid="trap"
      ref={ref}
      role="dialog"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {empty ? null : (
        <>
          <Button>first</Button>
          <Button>last</Button>
        </>
      )}
    </div>
  );
}

describe("useFocusTrap", () => {
  it("wraps Tab from the last control to the first", () => {
    render(<Trap />);
    const last = screen.getByRole("button", { name: "last" });
    last.focus();

    fireEvent.keyDown(last, { key: "Tab" });

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "first" }),
    );
  });

  it("wraps Shift+Tab from the first control or the container to the last", () => {
    render(<Trap />);
    const first = screen.getByRole("button", { name: "first" });
    first.focus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "last" }),
    );

    const trap = screen.getByTestId("trap");
    trap.focus();
    fireEvent.keyDown(trap, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "last" }),
    );
  });

  it("swallows Tab when nothing inside is focusable", () => {
    render(<Trap empty />);
    const trap = screen.getByTestId("trap");
    trap.focus();

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    trap.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores other keys", () => {
    render(<Trap />);
    const first = screen.getByRole("button", { name: "first" });
    first.focus();

    fireEvent.keyDown(first, { key: "Enter" });

    expect(document.activeElement).toBe(first);
  });
});
