import { describe, expect, it } from "vitest";

import {
  buildSuggestionAdditionRows,
  parseSuggestionBlocks,
  stripSuggestionBlocks,
} from "./utils";

describe("parseSuggestionBlocks", () => {
  it("extracts every suggestion fence from comment markdown", () => {
    expect(
      parseSuggestionBlocks(
        "Looks good\n```suggestion\nreturn next;\n```\nAnd\n```suggestion\nreturn fallback;\n```",
      ),
    ).toEqual([
      { body: "return next;", index: 0 },
      { body: "return fallback;", index: 1 },
    ]);
  });

  it("removes suggestion fences from the surrounding markdown", () => {
    expect(
      stripSuggestionBlocks("Before\n```suggestion\nreturn next;\n```\nAfter"),
    ).toBe("Before\nAfter");
  });
});

describe("buildSuggestionAdditionRows", () => {
  it("turns the fence body into addition rows without line numbers", () => {
    expect(buildSuggestionAdditionRows("const a = 1;\nreturn a;")).toEqual([
      { kind: "add", content: "const a = 1;" },
      { kind: "add", content: "return a;" },
    ]);
  });

  it("renders an empty fence as one empty addition (a deletion suggestion)", () => {
    expect(buildSuggestionAdditionRows("")).toEqual([
      { kind: "add", content: "" },
    ]);
  });
});
