import { describe, expect, it } from "vitest";

import {
  formatDisplayDiffLine,
  formatDisplayPath,
  formatDisplayText,
} from "../src/hidden-chars";

describe("formatDisplayDiffLine", () => {
  it("escapes terminal controls and keeps the tab indentation", () => {
    expect(formatDisplayDiffLine("+\tcode\u001B[2K")).toBe(
      "+\tcode[U+001B][2K",
    );
  });

  it("escapes a carriage return and the bidi overrides", () => {
    expect(formatDisplayDiffLine("+a\rb‮c")).toBe("+a[U+000D]b[U+202E]c");
  });

  it("escapes what renders as nothing, so no identifier stays unseen", () => {
    expect(formatDisplayDiffLine("+aㅤb​c﻿d\u{E0041}e")).toBe(
      "+a[U+3164]b[U+200B]c[U+FEFF]d[U+E0041]e",
    );
  });

  it("escapes a joiner or selector inside a lookalike identifier", () => {
    expect(formatDisplayDiffLine("+isAd‍min isAdmin️")).toBe(
      "+isAd[U+200D]min isAdmin[U+FE0F]",
    );
  });

  it("escapes the bidi marks a line of code could reorder around", () => {
    expect(formatDisplayDiffLine("+a‎b‏c؜d")).toBe(
      "+a[U+200E]b[U+200F]c[U+061C]d",
    );
  });

  it("leaves letters of any script alone", () => {
    expect(formatDisplayDiffLine("+const שלום = 'مرحبا';")).toBe(
      "+const שלום = 'مرحبا';",
    );
  });
});

describe("formatDisplayPath", () => {
  it("shows a bidi override as a visible escape", () => {
    expect(formatDisplayPath("src/\u202Etxt.exe")).toBe("src/[U+202E]txt.exe");
  });

  it("escapes isolates, marks and the Arabic letter mark", () => {
    const path = "a\u2066b\u2069c\u200Ed\u200Fe\u061Cf";

    expect(formatDisplayPath(path)).toBe(
      "a[U+2066]b[U+2069]c[U+200E]d[U+200F]e[U+061C]f",
    );
  });

  it("escapes control and zero-width characters", () => {
    expect(formatDisplayPath("a\u001B[31mb\u200Bc\td")).toBe(
      "a[U+001B][31mb[U+200B]c[U+0009]d",
    );
  });

  it("escapes the line and paragraph separators", () => {
    expect(formatDisplayPath("a\u2028b\u2029c")).toBe("a[U+2028]b[U+2029]c");
  });

  it("leaves a plain path unchanged", () => {
    expect(formatDisplayPath("packages/kit/src/index.ts")).toBe(
      "packages/kit/src/index.ts",
    );
  });

  it("leaves Hebrew, Arabic and CJK letters unchanged", () => {
    const path = "docs/שלום/مرحبا/反应/+page.js";

    expect(formatDisplayPath(path)).toBe(path);
  });
});

describe("formatDisplayText", () => {
  it("shows overrides, isolates and controls as visible escapes", () => {
    const title =
      "Fix \u202Eexe.txt\u2066a\u2069 \u001B[2J\u009Bdone\tnow\nnext";

    expect(formatDisplayText(title)).toBe(
      "Fix [U+202E]exe.txt[U+2066]a[U+2069] [U+001B][2J[U+009B]done[U+0009]now[U+000A]next",
    );
  });

  it("leaves right-to-left text and its marks unchanged", () => {
    const title = "תיקון \u200Fשגיאה\u200E in مرحبا\u061C";

    expect(formatDisplayText(title)).toBe(title);
  });

  it("leaves an emoji sequence joined by zero-width joiners unchanged", () => {
    const title =
      "Ship it \u{1F468}\u200D\u{1F469}\u200D\u{1F467} \u2764\uFE0F";

    expect(formatDisplayText(title)).toBe(title);
  });
});
