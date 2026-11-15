// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";
import { writeSingleKeyShortcutsOn } from "@web/utils/single-key-shortcuts";

import { useInboxCursor } from "./useInboxCursor";

const THREE_ROWS = ["a", "b", "c"];
const TWO_ROWS = ["a", "b"];
const LAST_ROW_INDEX = 2;

function Harness({
  rowKeys,
  onOpen,
  onToggleSelect,
}: {
  rowKeys: readonly string[];
  onOpen: (index: number) => void;
  onToggleSelect?: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const cursor = useInboxCursor(rowKeys, listRef, onOpen, onToggleSelect);
  return (
    <>
      <div ref={listRef}>
        <Button variant="secondary">Inside the list</Button>
      </div>
      <output>{String(cursor.index)}</output>
      <span data-testid="cursor-row">{rowKeys[cursor.index] ?? "none"}</span>
      <span data-testid="move-count">{String(cursor.moveCount)}</span>
      <Button
        variant="secondary"
        onClick={() => cursor.setCursorRow(LAST_ROW_INDEX)}
      >
        Follow focus to the last row
      </Button>
    </>
  );
}

function readCursor(): string {
  return screen.getByRole("status").textContent ?? "";
}

function readCursorRow(): string {
  return screen.getByTestId("cursor-row").textContent ?? "";
}

function readMoveCount(): string {
  return screen.getByTestId("move-count").textContent ?? "";
}

/** An arrow pressed with focus inside the list, where it steps the cursor. */
function pressInList(key: string): boolean {
  return fireEvent.keyDown(
    screen.getByRole("button", { name: "Inside the list" }),
    { key },
  );
}

function pressJ(times: number): void {
  for (let press = 0; press < times; press += 1) {
    fireEvent.keyDown(window, { key: "j" });
  }
}

describe("useInboxCursor", () => {
  it("starts with no cursor and j or k moves it without wrapping", () => {
    render(<Harness rowKeys={THREE_ROWS} onOpen={vi.fn()} />);

    expect(readCursor()).toBe("-1");
    fireEvent.keyDown(window, { key: "j" });
    expect(readCursor()).toBe("0");
    pressInList("ArrowDown");
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    expect(readCursor()).toBe("2");
    fireEvent.keyDown(window, { key: "k" });
    pressInList("ArrowUp");
    fireEvent.keyDown(window, { key: "k" });
    expect(readCursor()).toBe("0");
  });

  it("leaves a key to the page when it would not move the cursor", () => {
    render(<Harness rowKeys={TWO_ROWS} onOpen={vi.fn()} />);

    const upFromNowhere = pressInList("ArrowUp");
    expect(readCursor()).toBe("-1");
    expect(upFromNowhere).toBe(true);

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    const downPastTheEnd = pressInList("ArrowDown");
    expect(readCursor()).toBe("1");
    expect(downPastTheEnd).toBe(true);

    const downWithinTheRows = pressInList("ArrowUp");
    expect(readCursor()).toBe("0");
    expect(downWithinTheRows).toBe(false);
  });

  it("leaves the arrows to the page while focus is outside the list", () => {
    render(<Harness rowKeys={THREE_ROWS} onOpen={vi.fn()} />);

    const notPrevented = fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(notPrevented).toBe(true);
    expect(readCursor()).toBe("-1");
  });

  it("Enter opens the row under the cursor and nothing without one", () => {
    const onOpen = vi.fn();
    render(<Harness rowKeys={TWO_ROWS} onOpen={onOpen} />);

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
      <Harness
        rowKeys={TWO_ROWS}
        onOpen={vi.fn()}
        onToggleSelect={onToggleSelect}
      />,
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
        <Harness rowKeys={TWO_ROWS} onOpen={vi.fn()} />
        <input aria-label="Field" />
      </>,
    );
    const field = screen.getByRole("textbox", { name: "Field" });

    fireEvent.keyDown(field, { key: "j" });
    fireEvent.keyDown(window, { key: "j", metaKey: true });
    expect(readCursor()).toBe("-1");
  });

  it("a shorter list pulls the cursor back onto its last row", () => {
    const { rerender } = render(
      <Harness rowKeys={THREE_ROWS} onOpen={vi.fn()} />,
    );
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    expect(readCursor()).toBe("2");

    act(() => rerender(<Harness rowKeys={["a"]} onOpen={vi.fn()} />));

    expect(readCursor()).toBe("0");
  });

  it("follows its row when a row lands above it", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <Harness rowKeys={THREE_ROWS} onOpen={onOpen} />,
    );
    pressJ(2);
    expect(readCursorRow()).toBe("b");

    act(() =>
      rerender(<Harness rowKeys={["n", ...THREE_ROWS]} onOpen={onOpen} />),
    );

    expect(readCursor()).toBe("2");
    expect(readCursorRow()).toBe("b");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(2);
  });

  it("hands a removed row's cursor to the row now in its place", () => {
    const { rerender } = render(
      <Harness rowKeys={THREE_ROWS} onOpen={vi.fn()} />,
    );
    pressJ(2);

    act(() => rerender(<Harness rowKeys={["a", "c"]} onOpen={vi.fn()} />));
    expect(readCursor()).toBe("1");
    expect(readCursorRow()).toBe("c");

    act(() => rerender(<Harness rowKeys={["n", "a", "c"]} onOpen={vi.fn()} />));
    expect(readCursor()).toBe("2");
    expect(readCursorRow()).toBe("c");
  });

  it("names no row while no key has placed the cursor", () => {
    render(<Harness rowKeys={THREE_ROWS} onOpen={vi.fn()} />);

    expect(readCursorRow()).toBe("none");
  });

  it("counts key moves only, never a re-read that shifts the cursor", () => {
    const { rerender } = render(
      <Harness rowKeys={THREE_ROWS} onOpen={vi.fn()} />,
    );
    pressJ(2);
    expect(readMoveCount()).toBe("2");

    act(() =>
      rerender(<Harness rowKeys={["n", ...THREE_ROWS]} onOpen={vi.fn()} />),
    );
    act(() => rerender(<Harness rowKeys={["n", "a", "c"]} onOpen={vi.fn()} />));

    expect(readCursorRow()).toBe("c");
    expect(readMoveCount()).toBe("2");
  });

  it("a cursor that follows focus is not counted as a key move", () => {
    render(<Harness rowKeys={THREE_ROWS} onOpen={vi.fn()} />);
    pressJ(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Follow focus to the last row" }),
    );

    expect(readCursorRow()).toBe("c");
    expect(readMoveCount()).toBe("1");
  });
});

describe("useInboxCursor with single-key shortcuts off", () => {
  afterEach(() => {
    writeSingleKeyShortcutsOn(true);
  });

  it("ignores j and still moves on the arrow keys", () => {
    writeSingleKeyShortcutsOn(false);
    render(<Harness rowKeys={THREE_ROWS} onOpen={vi.fn()} />);

    pressJ(1);
    const afterLetter = readCursorRow();
    pressInList("ArrowDown");

    expect(afterLetter).toBe("none");
    expect(readCursorRow()).toBe("a");
  });
});
