import { describe, expect, it } from "vitest";

import {
  applyLinePrefix,
  applyLinkTemplate,
  applyMarkdownWrap,
  replaceSelectionWithSuggestion,
} from "./utils";

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
  it("prefixes every selected line", () => {
    expect(applyLinePrefix("one\ntwo", 0, 7, "- ")).toEqual({
      text: "- one\n- two",
      selectionStart: 0,
      selectionEnd: 11,
    });
  });

  it("inserts a placeholder item at a collapsed selection", () => {
    expect(applyLinePrefix("", 0, 0, "- [ ] ")).toEqual({
      text: "- [ ] list item",
      selectionStart: 0,
      selectionEnd: 15,
    });
  });
});

describe("applyLinkTemplate", () => {
  it("wraps the selection as link text", () => {
    expect(applyLinkTemplate("see docs", 4, 8)).toEqual({
      text: "see [docs](https://example.com)",
      selectionStart: 5,
      selectionEnd: 9,
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
