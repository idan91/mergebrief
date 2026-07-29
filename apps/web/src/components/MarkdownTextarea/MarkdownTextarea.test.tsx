// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownTextarea } from "./MarkdownTextarea";

afterEach(cleanup);

function Harness({
  initial = "",
  suggestionSeed,
}: {
  initial?: string;
  suggestionSeed?: string | undefined;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownTextarea
      label="Comment"
      suggestionSeed={suggestionSeed}
      value={value}
      onChange={setValue}
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
