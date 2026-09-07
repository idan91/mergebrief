import { describe, expect, it } from "vitest";

import {
  activeMentionQuery,
  applyLinePrefix,
  applyLinkTemplate,
  applyMarkdownWrap,
  applyOrderedListPrefix,
  continueListOnEnter,
  indentListSelection,
  insertMention,
  replaceSelectionWithSuggestion,
} from "./utils";
import { createI18n } from "i18n";

const t = createI18n().t;

describe("applyMarkdownWrap", () => {
  it("wraps selected text with markdown markers", () => {
    expect(applyMarkdownWrap("hello world", 6, 11, "**")).toEqual({
      text: "hello **world**",
      selectionStart: 8,
      selectionEnd: 13,
    });
  });

  it("inserts an empty pair at a collapsed selection", () => {
    expect(applyMarkdownWrap("hello", 5, 5, "`")).toEqual({
      text: "hello``",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });
});

describe("applyLinePrefix", () => {
  it("prefixes every selected line and collapses the caret to the end", () => {
    expect(applyLinePrefix("one\ntwo", 0, 7, "- ")).toEqual({
      text: "- one\n- two",
      selectionStart: 11,
      selectionEnd: 11,
    });
  });

  it("inserts only the marker at a collapsed selection, no placeholder", () => {
    expect(applyLinePrefix("", 0, 0, "- [ ] ")).toEqual({
      text: "- [ ] ",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it("puts the marker at the line start when the caret sits mid-line", () => {
    expect(applyLinePrefix("note", 4, 4, "> ")).toEqual({
      text: "> note",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });
});

describe("applyLinkTemplate", () => {
  it("wraps the selection as link text", () => {
    expect(applyLinkTemplate(t, "see docs", 4, 8)).toEqual({
      text: "see [docs](https://example.com)",
      selectionStart: 5,
      selectionEnd: 9,
    });
  });
});

describe("continueListOnEnter", () => {
  it("continues a bulleted item", () => {
    const text = "- first";
    expect(continueListOnEnter(text, 7, 7)).toEqual({
      text: "- first\n- ",
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it("increments a numbered item", () => {
    const text = "1. one\n2. two";
    expect(continueListOnEnter(text, 13, 13)).toEqual({
      text: "1. one\n2. two\n3. ",
      selectionStart: 17,
      selectionEnd: 17,
    });
  });

  it("continues a task item unchecked, even from a checked one", () => {
    const text = "- [x] done";
    expect(continueListOnEnter(text, 10, 10)).toEqual({
      text: "- [x] done\n- [ ] ",
      selectionStart: 17,
      selectionEnd: 17,
    });
  });

  it("keeps the indent and splits text after the caret into the new item", () => {
    const text = "  - abcd";
    expect(continueListOnEnter(text, 6, 6)).toEqual({
      text: "  - ab\n  - cd",
      selectionStart: 11,
      selectionEnd: 11,
    });
  });

  it("terminates the list on an empty item", () => {
    const text = "- one\n- ";
    expect(continueListOnEnter(text, 8, 8)).toEqual({
      text: "- one\n",
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it("declines outside lists and on non-collapsed selections", () => {
    expect(continueListOnEnter("plain text", 5, 5)).toBeNull();
    expect(continueListOnEnter("- item", 2, 4)).toBeNull();
  });

  it("declines when the caret sits inside the marker", () => {
    expect(continueListOnEnter("- item", 1, 1)).toBeNull();
  });
});

describe("indentListSelection", () => {
  it("indents a single list line and moves the caret with it", () => {
    expect(indentListSelection("- item", 3, 3, "indent")).toEqual({
      text: "  - item",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it("outdents back to the margin", () => {
    expect(indentListSelection("  - item", 5, 5, "outdent")).toEqual({
      text: "- item",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("indents every list line in a multi-line selection", () => {
    const text = "- one\n- two";
    expect(indentListSelection(text, 0, 11, "indent")).toEqual({
      text: "  - one\n  - two",
      selectionStart: 2,
      selectionEnd: 15,
    });
  });

  it("declines when no selected line is a list item", () => {
    expect(indentListSelection("plain", 2, 2, "indent")).toBeNull();
  });

  it("declines an at-margin outdent instead of consuming a no-op", () => {
    expect(indentListSelection("- item", 3, 3, "outdent")).toBeNull();
  });

  it("excludes a line the selection only touches at column 0", () => {
    // Selection ends at the start of line 2 (shift-down selection): line 2
    // is not visibly selected, so outdent must not touch it, and line 1
    // is already at the margin, so the whole edit declines.
    expect(indentListSelection("- a\n  - b", 0, 4, "outdent")).toBeNull();
  });
});

describe("applyOrderedListPrefix", () => {
  it("starts at 1 with no numbered context", () => {
    expect(applyOrderedListPrefix("alpha", 0, 5)).toEqual({
      text: "1. alpha",
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it("inserts only the marker at a collapsed selection, no placeholder", () => {
    expect(applyOrderedListPrefix("", 0, 0)).toEqual({
      text: "1. ",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("continues numbering from the line above, collapsed caret included", () => {
    expect(applyOrderedListPrefix("1. one\ntwo", 7, 10)).toEqual({
      text: "1. one\n2. two",
      selectionStart: 13,
      selectionEnd: 13,
    });
    expect(applyOrderedListPrefix("1. one\n", 7, 7)).toEqual({
      text: "1. one\n2. ",
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it("numbers a multi-line selection sequentially", () => {
    const text = "a\nb";
    expect(applyOrderedListPrefix(text, 0, 3)).toEqual({
      text: "1. a\n2. b",
      selectionStart: 9,
      selectionEnd: 9,
    });
  });
});

describe("activeMentionQuery", () => {
  it("finds the mention being typed at the caret", () => {
    expect(activeMentionQuery("hi @al", 6)).toEqual({ start: 3, query: "al" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("requires a boundary before the @, so emails are not mentions", () => {
    expect(activeMentionQuery("mail me a@b", 11)).toBeNull();
  });

  it("declines when the caret has left the mention", () => {
    expect(activeMentionQuery("@alice done", 11)).toBeNull();
  });

  it("suppresses mentions inside an open code fence of either style", () => {
    expect(activeMentionQuery("```\n@al", 7)).toBeNull();
    expect(activeMentionQuery("~~~\n@al", 7)).toBeNull();
    expect(activeMentionQuery("```\ncode\n```\n@al", 16)).toEqual({
      start: 13,
      query: "al",
    });
  });
});

describe("insertMention", () => {
  it("replaces the typed query with the login and a trailing space", () => {
    expect(insertMention("hi @al there", 3, 6, "alice")).toEqual({
      text: "hi @alice  there",
      selectionStart: 10,
      selectionEnd: 10,
    });
  });

  it("consumes the token tail on a mid-token accept", () => {
    expect(insertMention("@albert", 0, 3, "alice")).toEqual({
      text: "@alice ",
      selectionStart: 7,
      selectionEnd: 7,
    });
  });
});

describe("replaceSelectionWithSuggestion", () => {
  it("replaces a selected range with a suggestion fence", () => {
    expect(
      replaceSelectionWithSuggestion("Before\nAfter", 7, 12, "next();"),
    ).toEqual({
      text: "Before\n```suggestion\nnext();\n```",
      selectionStart: 21,
      selectionEnd: 28,
    });
  });
});
