// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchField } from ".";
import { SEARCH_DEBOUNCE_MS } from "./consts";

beforeEach(() => {
  vi.useFakeTimers();
  onDropPendingSearch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const onDropPendingSearch = vi.fn();

function getField(): HTMLInputElement {
  return screen.getByRole("searchbox", {
    name: "Search briefs by title or number",
  });
}

function typeText(text: string): void {
  fireEvent.change(getField(), { target: { value: text } });
}

function waitOutPause(): void {
  act(() => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
}

describe("SearchField", () => {
  it("writes the text once the typing pauses, not on each key", () => {
    const onSearch = vi.fn();
    render(
      <SearchField
        clearCount={0}
        resultCount={0}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    typeText("anc");
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    typeText("anchor");
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });

    expect(onSearch).not.toHaveBeenCalled();
    waitOutPause();
    expect(onSearch.mock.calls).toEqual([["anchor"]]);
  });

  it("writes the text trimmed and keeps what was typed in the field", () => {
    const onSearch = vi.fn();
    render(
      <SearchField
        clearCount={0}
        resultCount={0}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    typeText("  anchor ");
    waitOutPause();

    expect(onSearch).toHaveBeenCalledWith("anchor");
    expect(getField().value).toBe("  anchor ");
  });

  it("Enter writes at once and the pause writes nothing more", () => {
    const onSearch = vi.fn();
    render(
      <SearchField
        clearCount={0}
        resultCount={0}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    typeText("anchor");
    fireEvent.keyDown(getField(), { key: "Enter" });
    waitOutPause();

    expect(onSearch.mock.calls).toEqual([["anchor"]]);
  });

  it("Escape empties the field first and leaves it second", () => {
    const onSearch = vi.fn();
    render(
      <SearchField
        clearCount={0}
        resultCount={3}
        value="anchor"
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );
    getField().focus();

    fireEvent.keyDown(getField(), { key: "Escape" });

    expect(getField().value).toBe("");
    expect(onSearch).toHaveBeenCalledWith("");
    expect(document.activeElement).toBe(getField());

    fireEvent.keyDown(getField(), { key: "Escape" });

    expect(document.activeElement).not.toBe(getField());
  });

  it("the clear button empties the field and hands focus back to it", () => {
    const onSearch = vi.fn();
    render(
      <SearchField
        clearCount={0}
        resultCount={3}
        value="anchor"
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(getField().value).toBe("");
    expect(onSearch).toHaveBeenCalledWith("");
    expect(document.activeElement).toBe(getField());
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("takes the URL's text when it moves without the field writing it", () => {
    const onSearch = vi.fn();
    const view = render(
      <SearchField
        clearCount={0}
        resultCount={3}
        value="anchor"
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    view.rerender(
      <SearchField
        clearCount={0}
        resultCount={9}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    expect(getField().value).toBe("");
  });

  it("keeps the typing when the URL catches up with an earlier write", () => {
    const onSearch = vi.fn();
    const view = render(
      <SearchField
        clearCount={0}
        resultCount={0}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    typeText("anc");
    waitOutPause();
    typeText("anchor");
    view.rerender(
      <SearchField
        clearCount={0}
        resultCount={2}
        value="anc"
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    expect(getField().value).toBe("anchor");
  });

  it("an outside change to a text the field once wrote still lands", () => {
    const onSearch = vi.fn();
    const view = render(
      <SearchField
        clearCount={0}
        resultCount={3}
        value="anchor"
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    view.rerender(
      <SearchField
        clearCount={0}
        resultCount={9}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );
    typeText("anchor");
    waitOutPause();
    view.rerender(
      <SearchField
        clearCount={0}
        resultCount={3}
        value="anchor"
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    view.rerender(
      <SearchField
        clearCount={0}
        resultCount={9}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    expect(getField().value).toBe("");
  });

  it("a keystroke drops the list still loading for older text, once", () => {
    const onSearch = vi.fn();
    render(
      <SearchField
        clearCount={0}
        resultCount={0}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );
    typeText("fo");
    expect(onDropPendingSearch).not.toHaveBeenCalled();
    waitOutPause();

    typeText("foo");
    typeText("fooo");

    expect(onDropPendingSearch).toHaveBeenCalledTimes(1);
  });

  it("a keystroke drops nothing once the write has landed", () => {
    const onSearch = vi.fn();
    const view = render(
      <SearchField
        clearCount={0}
        resultCount={0}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );
    typeText("fo");
    waitOutPause();
    view.rerender(
      <SearchField
        clearCount={0}
        resultCount={2}
        value="fo"
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    typeText("foo");

    expect(onDropPendingSearch).not.toHaveBeenCalled();
  });

  it("an outside change stops a pause from writing the older text back", () => {
    const onSearch = vi.fn();
    const view = render(
      <SearchField
        clearCount={0}
        resultCount={3}
        value="anchor"
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );
    typeText("anchor ids");

    view.rerender(
      <SearchField
        clearCount={0}
        resultCount={9}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );
    waitOutPause();

    expect(getField().value).toBe("");
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("Clear empties the field while its first search still loads", () => {
    const onSearch = vi.fn();
    const view = render(
      <SearchField
        clearCount={0}
        resultCount={9}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );
    typeText("foo");
    waitOutPause();

    view.rerender(
      <SearchField
        clearCount={1}
        resultCount={9}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    expect(getField().value).toBe("");
  });

  it("Clear inside the pause stops the text from being written", () => {
    const onSearch = vi.fn();
    const view = render(
      <SearchField
        clearCount={0}
        resultCount={9}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );
    typeText("foo");

    view.rerender(
      <SearchField
        clearCount={1}
        resultCount={9}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );
    waitOutPause();

    expect(getField().value).toBe("");
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("a dropped write is not mistaken for the field's own later", () => {
    const onSearch = vi.fn();
    const view = render(
      <SearchField
        clearCount={0}
        resultCount={3}
        value="foo"
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    typeText("foo");
    waitOutPause();

    view.rerender(
      <SearchField
        clearCount={0}
        resultCount={9}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={onSearch}
      />,
    );

    expect(getField().value).toBe("");
  });

  it("the slash key focuses the field from the page, never from a field", () => {
    render(
      <>
        <input aria-label="Other" />
        <SearchField
          clearCount={0}
          resultCount={0}
          value=""
          onDropPendingSearch={onDropPendingSearch}
          onSearch={vi.fn()}
        />
      </>,
    );
    const other = screen.getByLabelText("Other");

    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);

    other.blur();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(getField());
  });

  it("says how many rows match only while a search is on", () => {
    const view = render(
      <SearchField
        clearCount={0}
        resultCount={12}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("");

    view.rerender(
      <SearchField
        clearCount={0}
        resultCount={1}
        value="anchor"
        onDropPendingSearch={onDropPendingSearch}
        onSearch={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "1 pull request matches “anchor”",
    );
  });

  it("holds the field to the wire's length", () => {
    render(
      <SearchField
        clearCount={0}
        resultCount={0}
        value=""
        onDropPendingSearch={onDropPendingSearch}
        onSearch={vi.fn()}
      />,
    );

    expect(getField().maxLength).toBe(100);
  });
});
