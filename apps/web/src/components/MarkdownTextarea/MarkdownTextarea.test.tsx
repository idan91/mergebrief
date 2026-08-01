// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownTextarea } from "./MarkdownTextarea";
import type { MentionCandidate } from "./useMentionAutocomplete";

afterEach(cleanup);

function Harness({
  initial = "",
  label = "Comment",
  readOnly = false,
  suggestionSeed,
  mentionCandidates,
  onEscape,
  onSubmit,
}: {
  initial?: string;
  label?: string;
  readOnly?: boolean;
  suggestionSeed?: string | undefined;
  mentionCandidates?: readonly MentionCandidate[] | undefined;
  onEscape?: (() => void) | undefined;
  onSubmit?: (() => void) | undefined;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownTextarea
      label={label}
      mentionCandidates={mentionCandidates}
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

  describe("mention autocomplete", () => {
    const CANDIDATES: readonly MentionCandidate[] = [
      {
        login: "alice",
        name: "Alice Example",
        avatarUrl: "https://avatars.example/alice.png",
      },
      { login: "albert" },
      { login: "bob", avatarUrl: "https://avatars.example/bob.png" },
    ];

    function typeMention(text: string) {
      const input = textarea();
      fireEvent.change(input, { target: { value: text } });
      return input;
    }

    it("opens a filtered listbox while typing a mention", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      typeMention("hi @al");
      const options = screen.getAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual([
        "@aliceAlice Example",
        "@albert",
      ]);
      expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    });

    it("renders avatar and display name when the candidate carries them", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      typeMention("hi @al");
      const [alice, albert] = screen.getAllByRole("option");
      if (alice === undefined || albert === undefined) {
        throw new Error("expected two options");
      }
      // Rich candidate: avatar image + login + muted display name.
      const avatar = alice.querySelector("img");
      expect(avatar?.getAttribute("src")).toBe(
        "https://avatars.example/alice.png",
      );
      // Decorative — the option text already carries the identity.
      expect(avatar?.getAttribute("alt")).toBe("");
      expect(alice.textContent).toBe("@aliceAlice Example");
      // Login-only candidate: no img, no name, still a valid option.
      expect(albert.querySelector("img")).toBeNull();
      expect(albert.textContent).toBe("@albert");
    });

    it("renders the avatar even when the candidate has no display name", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      typeMention("@b");
      const bob = screen.getByRole("option", { name: "@bob" });
      expect(bob.querySelector("img")?.getAttribute("src")).toBe(
        "https://avatars.example/bob.png",
      );
    });

    it("stays closed with no candidate pool", () => {
      render(<Harness />);
      typeMention("hi @al");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("inserts the highlighted login on Enter and closes", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("hi @al");
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input.value).toBe("hi @albert ");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("inserts on mousedown selection", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("@b");
      fireEvent.mouseDown(screen.getByRole("option", { name: "@bob" }));
      expect(input.value).toBe("@bob ");
    });

    it("Escape dismisses the popup without firing the consumer hook", () => {
      const onEscape = vi.fn();
      render(<Harness mentionCandidates={CANDIDATES} onEscape={onEscape} />);
      const input = typeMention("@al");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(onEscape).not.toHaveBeenCalled();
      // A second Escape (popup closed) reaches the consumer hook.
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it("modified Enter belongs to the editor: Cmd+Enter submits what the user sees", () => {
      const onSubmit = vi.fn();
      render(<Harness mentionCandidates={CANDIDATES} onSubmit={onSubmit} />);
      const input = typeMention("hi @al");
      fireEvent.keyDown(input, { key: "Enter", metaKey: true });
      // No insertion — the submit captures the body exactly as displayed.
      expect(input.value).toBe("hi @al");
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("accepts with Tab too", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("@b");
      fireEvent.keyDown(input, { key: "Tab" });
      expect(input.value).toBe("@bob ");
    });

    it("stays inert while read-only", () => {
      render(<Harness initial="@al" mentionCandidates={CANDIDATES} readOnly />);
      const input = textarea();
      input.setSelectionRange(3, 3);
      fireEvent.select(input);
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("ignores keydowns from an IME composition", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("@al");
      fireEvent.keyDown(input, { key: "ArrowDown", isComposing: true });
      expect(
        screen
          .getByRole("option", { name: /@alice/ })
          .getAttribute("aria-selected"),
      ).toBe("true");
    });

    it("closes on blur and reopens on the next caret activity", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("@al");
      expect(screen.getByRole("listbox")).toBeTruthy();
      fireEvent.blur(input);
      expect(screen.queryByRole("listbox")).toBeNull();
      typeMention("@ali");
      expect(screen.getByRole("listbox")).toBeTruthy();
    });

    it("an Escape dismissal dies with the mention: retyping reopens", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("@a");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).toBeNull();
      typeMention("");
      typeMention("@b");
      expect(screen.getByRole("listbox")).toBeTruthy();
    });

    it("Enter falls through to list continuation when the popup is closed", () => {
      render(<Harness mentionCandidates={CANDIDATES} />);
      const input = typeMention("- item");
      input.setSelectionRange(6, 6);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input.value).toBe("- item\n- ");
    });
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
