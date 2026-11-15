// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";

import { useKeepCursorFocus } from "./useKeepCursorFocus";

interface HarnessRow {
  key: string;
  /** A new mount token remounts the row, as a re-read that moves it does. */
  mount: number;
}

interface HarnessProps {
  initial: readonly HarnessRow[];
  cursorKey: string;
  focusHeading: (options?: FocusOptions) => void;
  setCursorRow?: (index: number) => void;
}

function ignoreCursorMove(): void {}

const harness: { setRows?: (rows: readonly HarnessRow[]) => void } = {};

/** A heading, a field outside the list, and rows a test re-reads, with the cursor on `cursorKey`. */
function KeepCursorFocusHarness({
  initial,
  cursorKey,
  focusHeading,
  setCursorRow = ignoreCursorMove,
}: HarnessProps) {
  const [rows, setRows] = useState(initial);
  harness.setRows = setRows;
  const listsRef = useRef<HTMLDivElement>(null);
  const cursorRowRef = useRef<HTMLLIElement>(null);
  const cursorPresent = rows.some((row) => row.key === cursorKey);
  const { handleRowFocus, handleListsFocus, handleListsBlur } =
    useKeepCursorFocus({
      listsRef,
      cursorRowRef,
      cursorRowKey: cursorPresent ? cursorKey : rows[0]?.key,
      rowsLayout: rows
        .map((row) => `${row.key}.${String(row.mount)}`)
        .join(" "),
      setCursorRow,
      focusHeading,
    });
  const cursorRow = cursorPresent ? cursorKey : rows[0]?.key;

  return (
    <>
      <input aria-label="Outside" />
      <div onBlur={handleListsBlur} onFocus={handleListsFocus} ref={listsRef}>
        <ol>
          {rows.map((row) => (
            <li
              key={`${row.key}.${String(row.mount)}`}
              ref={row.key === cursorRow ? cursorRowRef : undefined}
            >
              <div onFocus={() => handleRowFocus(row.key)}>
                <a data-row-link="" href={`#${row.key}`}>
                  {row.key}
                </a>
                {createPortal(
                  <Button variant="secondary">{`${row.key} menu`}</Button>,
                  document.body,
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

function makeRows(...keys: string[]): HarnessRow[] {
  return keys.map((key) => ({ key, mount: 0 }));
}

function readLink(name: string): HTMLElement {
  return screen.getByRole("link", { name });
}

function rereadRows(rows: readonly HarnessRow[]): void {
  act(() => harness.setRows?.(rows));
}

afterEach(cleanup);

describe("useKeepCursorFocus", () => {
  it("moves the cursor to the row focus enters", () => {
    const setCursorRow = vi.fn();
    render(
      <KeepCursorFocusHarness
        cursorKey="a"
        focusHeading={() => {}}
        initial={makeRows("a", "b")}
        setCursorRow={setCursorRow}
      />,
    );

    act(() => readLink("b").focus());

    expect(setCursorRow).toHaveBeenCalledWith(1);
  });

  it("gives a remounted cursor row's link its focus back", () => {
    render(
      <KeepCursorFocusHarness
        cursorKey="a"
        focusHeading={() => {}}
        initial={makeRows("a", "b")}
      />,
    );
    act(() => readLink("a").focus());

    rereadRows([{ key: "a", mount: 1 }, ...makeRows("b")]);

    expect(document.activeElement).toBe(readLink("a"));
  });

  it("hands focus to the heading in place when the cursor row leaves", () => {
    const focusHeading = vi.fn();
    render(
      <KeepCursorFocusHarness
        cursorKey="a"
        focusHeading={focusHeading}
        initial={makeRows("a", "b")}
      />,
    );
    act(() => readLink("a").focus());

    rereadRows(makeRows("b"));

    expect(focusHeading).toHaveBeenCalledExactlyOnceWith({
      preventScroll: true,
    });
  });

  it("leaves focus outside the list alone", () => {
    const focusHeading = vi.fn();
    render(
      <KeepCursorFocusHarness
        cursorKey="a"
        focusHeading={focusHeading}
        initial={makeRows("a", "b")}
      />,
    );
    const outside = screen.getByRole("textbox", { name: "Outside" });
    act(() => outside.focus());

    rereadRows(makeRows("b"));

    expect(focusHeading).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
  });

  it("keeps the cursor row's focus through a window blur", () => {
    render(
      <KeepCursorFocusHarness
        cursorKey="a"
        focusHeading={() => {}}
        initial={makeRows("a", "b")}
      />,
    );
    act(() => readLink("a").focus());
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    fireEvent.focusOut(readLink("a"));
    hasFocus.mockRestore();

    rereadRows([{ key: "a", mount: 1 }, ...makeRows("b")]);

    expect(document.activeElement).toBe(readLink("a"));
  });

  it("moves nothing once focus blurred off the cursor row in the page", () => {
    const focusHeading = vi.fn();
    render(
      <KeepCursorFocusHarness
        cursorKey="a"
        focusHeading={focusHeading}
        initial={makeRows("a", "b")}
      />,
    );
    act(() => readLink("a").focus());
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    act(() => readLink("a").blur());
    hasFocus.mockRestore();

    rereadRows(makeRows("b"));

    expect(focusHeading).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("counts focus in the cursor row's portalled menu as in the row", () => {
    const focusHeading = vi.fn();
    render(
      <KeepCursorFocusHarness
        cursorKey="a"
        focusHeading={focusHeading}
        initial={makeRows("a", "b")}
      />,
    );
    act(() => screen.getByRole("button", { name: "a menu" }).focus());

    rereadRows(makeRows("b"));

    expect(focusHeading).toHaveBeenCalledExactlyOnceWith({
      preventScroll: true,
    });
  });

  it("moves no cursor for focus in a row's portalled menu", () => {
    const setCursorRow = vi.fn();
    render(
      <KeepCursorFocusHarness
        cursorKey="a"
        focusHeading={() => {}}
        initial={makeRows("a", "b")}
        setCursorRow={setCursorRow}
      />,
    );

    act(() => screen.getByRole("button", { name: "b menu" }).focus());

    expect(setCursorRow).not.toHaveBeenCalled();
  });

  it("ignores focus in another row's portalled menu", () => {
    const focusHeading = vi.fn();
    render(
      <KeepCursorFocusHarness
        cursorKey="a"
        focusHeading={focusHeading}
        initial={makeRows("a", "b")}
      />,
    );
    act(() => screen.getByRole("button", { name: "b menu" }).focus());

    rereadRows(makeRows("b"));

    expect(focusHeading).not.toHaveBeenCalled();
  });
});
