// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useInboxCursor } from "./useInboxCursor";

afterEach(cleanup);

function Harness({
  count,
  onOpen,
  onToggleSelect,
}: {
  count: number;
  onOpen: (i: number) => void;
  onToggleSelect?: (i: number) => void;
}) {
  const cursor = useInboxCursor(count, onOpen, onToggleSelect);
  return <output>{String(cursor)}</output>;
}

function readCursor(): string {
  return screen.getByRole("status").textContent ?? "";
}

describe("useInboxCursor", () => {
  it("starts with no cursor and j or k moves it without wrapping", () => {
    render(<Harness count={3} onOpen={vi.fn()} />);

    expect(readCursor()).toBe("-1");
    fireEvent.keyDown(window, { key: "j" });
    expect(readCursor()).toBe("0");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    expect(readCursor()).toBe("2");
    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "k" });
    expect(readCursor()).toBe("0");
  });

  it("leaves a key to the page when it would not move the cursor", () => {
    render(<Harness count={2} onOpen={vi.fn()} />);

    const upFromNowhere = fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(readCursor()).toBe("-1");
    expect(upFromNowhere).toBe(true);

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    const downPastTheEnd = fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(readCursor()).toBe("1");
    expect(downPastTheEnd).toBe(true);

    const downWithinTheRows = fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(readCursor()).toBe("0");
    expect(downWithinTheRows).toBe(false);
  });

  it("Enter opens the row under the cursor and nothing without one", () => {
    const onOpen = vi.fn();
    render(<Harness count={2} onOpen={onOpen} />);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it("x toggles the row under the cursor and nothing without one", () => {
    const onToggleSelect = vi.fn();
    render(
      <Harness count={2} onOpen={vi.fn()} onToggleSelect={onToggleSelect} />,
    );

    fireEvent.keyDown(window, { key: "x" });
    expect(onToggleSelect).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "x" });
    expect(onToggleSelect).toHaveBeenCalledWith(1);
  });

  it("ignores keys typed in a field or with a modifier", () => {
    render(
      <>
        <Harness count={2} onOpen={vi.fn()} />
        <input aria-label="Field" />
      </>,
    );
    const field = screen.getByRole("textbox", { name: "Field" });

    fireEvent.keyDown(field, { key: "j" });
    fireEvent.keyDown(window, { key: "j", metaKey: true });
    expect(readCursor()).toBe("-1");
  });

  it("a shorter list pulls the cursor back onto its last row", () => {
    const { rerender } = render(<Harness count={3} onOpen={vi.fn()} />);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    expect(readCursor()).toBe("2");

    act(() => rerender(<Harness count={1} onOpen={vi.fn()} />));

    expect(readCursor()).toBe("0");
  });
});
