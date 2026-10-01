import { describe, expect, it } from "vitest";

import { splitFilePath, splitInlineCode } from "./utils";

describe("splitInlineCode", () => {
  it("marks backtick spans as code and keeps the prose around them", () => {
    expect(splitInlineCode("Raises `--faint` to AA")).toEqual([
      { offset: 0, text: "Raises ", code: false },
      { offset: 7, text: "--faint", code: true },
      { offset: 16, text: " to AA", code: false },
    ]);
  });

  it("returns one prose segment when there is no code", () => {
    expect(splitInlineCode("plain")).toEqual([
      { offset: 0, text: "plain", code: false },
    ]);
  });

  it("leaves an unpaired backtick as prose", () => {
    expect(splitInlineCode("a `b")).toEqual([
      { offset: 0, text: "a `b", code: false },
    ]);
  });
});

describe("splitFilePath", () => {
  it("splits the directory into slash-ended parts and the basename", () => {
    expect(splitFilePath("apps/web/Header.tsx")).toEqual({
      directories: [
        { key: "apps/", text: "apps/" },
        { key: "apps/web/", text: "web/" },
      ],
      basename: "Header.tsx",
    });
  });

  it("has no directory parts for a root file", () => {
    expect(splitFilePath("README.md")).toEqual({
      directories: [],
      basename: "README.md",
    });
  });
});
