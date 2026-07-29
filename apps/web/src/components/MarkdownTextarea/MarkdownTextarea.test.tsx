// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownTextarea } from "./MarkdownTextarea";

afterEach(cleanup);

function Harness({
  initial = "",
  label = "Comment",
  readOnly = false,
  suggestionSeed,
  onEscape,
  onSubmit,
}: {
  initial?: string;
  label?: string;
  readOnly?: boolean;
  suggestionSeed?: string | undefined;
  onEscape?: (() => void) | undefined;
  onSubmit?: (() => void) | undefined;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownTextarea
      label={label}
      readOnly={readOnly}
      suggestionSeed={suggestionSeed}
      value={value}
      onChange={setValue}
      onEscape={onEscape}
      onSubmit={onSubmit}
    />
  );
}

function textarea(): HTMLTextAreaElement {
  const element = screen.getByLabelText("Comment");
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error("expected a textarea");
  }
  return element;
}

describe("MarkdownTextarea", () => {
  it("renders a labeled textarea inside a Write tab", () => {
    render(<Harness />);
    expect(textarea()).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Write", selected: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Preview", selected: false }),
    ).toBeTruthy();
  });

  it("switches to the preview panel and renders markdown", () => {
    render(<Harness initial="**bold move**" />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(
      screen.getByRole("tab", { name: "Preview", selected: true }),
    ).toBeTruthy();
    expect(screen.getByText("bold move").tagName).toBe("STRONG");
    // The write panel (and its textarea) is hidden — one visible panel.
    expect(screen.getAllByRole("tabpanel").length).toBe(1);
  });

  it("moves between tabs with arrow keys", () => {
    render(<Harness />);
    const writeTab = screen.getByRole("tab", { name: "Write" });
    writeTab.focus();
    // Bubbles to the tablist's keydown handler.
    fireEvent.keyDown(writeTab, { key: "ArrowRight" });
    expect(
      screen.getByRole("tab", { name: "Preview", selected: true }),
    ).toBeTruthy();
  });

  it("exposes a formatting toolbar with one roving tab stop", () => {
    render(<Harness />);
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    const buttons = screen.getAllByRole("button", {
      name: /Bold|Italic|Inline code|Quote|Bulleted list|Numbered list|Task list|Link/,
    });
    expect(buttons.length).toBe(8);
    expect(buttons.filter((button) => button.tabIndex === 0).length).toBe(1);
    const bold = screen.getByRole("button", { name: "Bold" });
    bold.focus();
    fireEvent.keyDown(toolbar, { key: "ArrowRight" });
    const italic = screen.getByRole("button", { name: "Italic" });
    expect(document.activeElement).toBe(italic);
    // The tab stop roves with focus: Tab out and back must re-enter at
    // the last-focused control, not reset to the first button.
    expect(italic.tabIndex).toBe(0);
    expect(bold.tabIndex).toBe(-1);
  });

  it("wraps the selection when a formatting button is clicked", () => {
    render(<Harness initial="hello world" />);
    const input = textarea();
    input.setSelectionRange(6, 11);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(input.value).toBe("hello **world**");
  });

  it("applies formatting shortcuts from the keyboard", () => {
    render(<Harness initial="hello world" />);
    const input = textarea();
    input.setSelectionRange(0, 5);
    fireEvent.keyDown(input, { key: "b", metaKey: true });
    expect(input.value).toBe("**hello** world");
  });

  it("is inert while read-only: toolbar and shortcuts must not mutate", () => {
    render(<Harness initial="hello" readOnly />);
    const input = textarea();
    input.setSelectionRange(0, 5);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(input.value).toBe("hello");
    fireEvent.keyDown(input, { key: "b", metaKey: true });
    expect(input.value).toBe("hello");
  });

  it("scopes textarea ids per instance", () => {
    render(
      <>
        <Harness label="First" />
        <Harness label="Second" />
      </>,
    );
    const first = screen.getByLabelText("First");
    const second = screen.getByLabelText("Second");
    expect(first.id).not.toBe(second.id);
    expect(first.id.length).toBeGreaterThan(0);
  });

  it("continues a list on Enter; Shift+Enter stays a plain newline", () => {
    render(<Harness initial="- item" />);
    const input = textarea();
    input.setSelectionRange(6, 6);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("- item\n- ");
    // Shift+Enter falls through to the browser default (no marker insert).
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(input.value).toBe("- item\n- ");
  });

  it("indents and outdents list lines with Tab/Shift+Tab", () => {
    render(<Harness initial="- item" />);
    const input = textarea();
    input.setSelectionRange(3, 3);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input.value).toBe("  - item");
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(input.value).toBe("- item");
  });

  it("submits on Cmd/Ctrl+Enter", () => {
    const onSubmit = vi.fn();
    render(<Harness initial="ready" onSubmit={onSubmit} />);
    fireEvent.keyDown(textarea(), { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits on Cmd/Ctrl+Enter from the preview panel too", () => {
    const onSubmit = vi.fn();
    render(<Harness initial="ready" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    fireEvent.keyDown(screen.getByRole("tabpanel"), {
      key: "Enter",
      metaKey: true,
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("ignores keydowns that commit an IME composition", () => {
    const onSubmit = vi.fn();
    render(<Harness initial="- item" onSubmit={onSubmit} />);
    const input = textarea();
    input.setSelectionRange(6, 6);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input.value).toBe("- item");
    fireEvent.keyDown(input, {
      key: "Enter",
      metaKey: true,
      isComposing: true,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("stops Escape propagation only when a consumer hook handles it", () => {
    const windowListener = vi.fn();
    window.addEventListener("keydown", windowListener);
    try {
      const onEscape = vi.fn();
      const { unmount } = render(<Harness onEscape={onEscape} />);
      fireEvent.keyDown(textarea(), { key: "Escape" });
      expect(onEscape).toHaveBeenCalledTimes(1);
      expect(windowListener).not.toHaveBeenCalled();
      unmount();
      // Without the hook, Escape must keep bubbling (CommentComposer's
      // window-level close listener depends on it).
      render(<Harness />);
      fireEvent.keyDown(textarea(), { key: "Escape" });
      expect(windowListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", windowListener);
    }
  });

  it("wraps inline code on Cmd/Ctrl+E", () => {
    render(<Harness initial="hello world" />);
    const input = textarea();
    input.setSelectionRange(0, 5);
    fireEvent.keyDown(input, { key: "e", metaKey: true });
    expect(input.value).toBe("`hello` world");
  });

  it("toggles Write/Preview on Cmd/Ctrl+Shift+P", () => {
    render(<Harness initial="text" />);
    fireEvent.keyDown(textarea(), { key: "p", metaKey: true, shiftKey: true });
    expect(
      screen.getByRole("tab", { name: "Preview", selected: true }),
    ).toBeTruthy();
  });

  it("routes Escape to the consumer's hook", () => {
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    fireEvent.keyDown(textarea(), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("only offers Insert suggestion when seeded", () => {
    render(<Harness />);
    expect(
      screen.queryByRole("button", { name: "Insert suggestion" }),
    ).toBeNull();
    cleanup();
    render(<Harness suggestionSeed="const a = 1;" />);
    fireEvent.click(screen.getByRole("button", { name: "Insert suggestion" }));
    expect(textarea().value).toBe("```suggestion\nconst a = 1;\n```");
  });
});
