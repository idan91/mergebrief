import { describe, expect, it } from "vitest";

import type { DiffLine, RowTokenMap } from "@web/utils/diffTokens/types";
import { INTRA_LINE_CHARACTER_CAP, INTRA_LINE_TOKEN_CAP } from "./consts";
import { computeIntraLineEmphasis, diffPairedTokens } from "./diffPairedTokens";
import { pairSplitRows } from "./pairSplitRows";
import type { TokenSide } from "./types";

function stubSide(...texts: string[]): TokenSide {
  return {
    text: texts.join(""),
    tokens: texts.map((text) => ({ text, classId: 0 })),
  };
}

function stubTokens(...texts: string[]) {
  return texts.map((text) => ({ text, classId: 0 }));
}

describe("diffPairedTokens", () => {
  it("emphasises nothing when both sides spell the same text", () => {
    const side = stubSide("const", " ", "a", " = ", "1", ";");

    expect(diffPairedTokens(side, side)).toEqual({ left: [], right: [] });
  });

  it("emphasises one renamed identifier on each side", () => {
    const left = stubSide("const", " ", "label", " = ", "1", ";");
    const right = stubSide("const", " ", "title", " = ", "1", ";");

    expect(diffPairedTokens(left, right)).toEqual({
      left: [{ from: 6, to: 11 }],
      right: [{ from: 6, to: 11 }],
    });
  });

  it("narrows a changed token to the characters that differ", () => {
    const left = stubSide("say(", "'old value'", ")");
    const right = stubSide("say(", "'new value'", ")");

    expect(diffPairedTokens(left, right)).toEqual({
      left: [{ from: 5, to: 8 }],
      right: [{ from: 5, to: 8 }],
    });
  });

  it("keeps a changed emoji whole when narrowing a string literal", () => {
    const left = stubSide("log(", "'ok \u{1F600}'", ")");
    const right = stubSide("log(", "'ok \u{1F601}'", ")");

    expect(diffPairedTokens(left, right)).toEqual({
      left: [{ from: 8, to: 10 }],
      right: [{ from: 8, to: 10 }],
    });
  });

  it("joins two changed runs across a short punctuation token", () => {
    const left = stubSide(
      "range",
      ": ",
      "{",
      " start: ",
      "2",
      ", ",
      "end",
      "}",
    );
    const right = stubSide(
      "span",
      ": ",
      "[",
      " start: ",
      "3",
      ", ",
      "stop",
      "}",
    );

    expect(diffPairedTokens(left, right)).toEqual({
      left: [
        { from: 0, to: 8 },
        { from: 16, to: 22 },
      ],
      right: [
        { from: 0, to: 7 },
        { from: 15, to: 22 },
      ],
    });
  });

  it("keeps a ring that bridges push past the share cap", () => {
    // Five one-character edits change 5 of 12 characters; the bridged ring
    // covers 9, past the cap, and the share counts the edits, not the ring.
    const left = stubSide(
      "f(",
      "a",
      ",",
      "b",
      ",",
      "c",
      ",",
      "d",
      ",",
      "e",
      ")",
    );
    const right = stubSide(
      "f(",
      "v",
      ",",
      "w",
      ",",
      "x",
      ",",
      "y",
      ",",
      "z",
      ")",
    );

    expect(diffPairedTokens(left, right)).toEqual({
      left: [{ from: 2, to: 11 }],
      right: [{ from: 2, to: 11 }],
    });
  });

  it("keeps two runs apart across a longer unchanged token", () => {
    const left = stubSide("a", " while ", "b");
    const right = stubSide("x", " while ", "y");

    expect(diffPairedTokens(left, right)).toEqual({
      left: [
        { from: 0, to: 1 },
        { from: 8, to: 9 },
      ],
      right: [
        { from: 0, to: 1 },
        { from: 8, to: 9 },
      ],
    });
  });

  it("marks an insertion on the side that gained characters only", () => {
    const left = stubSide("call(", "a", ")");
    const right = stubSide("call(", "a, b", ")");

    expect(diffPairedTokens(left, right)).toEqual({
      left: [],
      right: [{ from: 6, to: 9 }],
    });
  });

  it("emphasises a whitespace-only change", () => {
    const left = stubSide("if", " ", "(x)");
    const right = stubSide("if", "  ", "(x)");

    expect(diffPairedTokens(left, right)).toEqual({
      left: [],
      right: [{ from: 3, to: 4 }],
    });
  });

  it("emphasises the changed run and leaves shared tokens alone", () => {
    const left = stubSide("a", " + ", "b", " + ", "c");
    const right = stubSide("a", " + ", "x", " * ", "y", " + ", "c");

    expect(diffPairedTokens(left, right)).toEqual({
      left: [{ from: 4, to: 5 }],
      right: [{ from: 4, to: 9 }],
    });
  });

  it("merges adjacent changed tokens into one range", () => {
    const left = stubSide("a", ".", "b", "(", ")");
    const right = stubSide("a", "?.", "c", "(", ")");

    expect(diffPairedTokens(left, right)).toEqual({
      left: [{ from: 1, to: 3 }],
      right: [{ from: 1, to: 4 }],
    });
  });

  it("gives up on wholly different lines", () => {
    const left = stubSide("return", " ", "null", ";");
    const right = stubSide("throw", " ", "new", " ", "Error", "()", ";");

    expect(diffPairedTokens(left, right)).toEqual({ left: [], right: [] });
  });

  it("gives up past the token cap", () => {
    const many = Array.from({ length: INTRA_LINE_TOKEN_CAP + 1 }, () => "a");
    const left = stubSide(...many);
    const right = stubSide(...many, "b");

    expect(diffPairedTokens(left, right)).toEqual({ left: [], right: [] });
  });

  it("gives up when the middles are too many to compare", () => {
    // 101 x 101 middle tokens overflow the LCS cap under the token and
    // character caps, and the shared padding keeps the middle at half the
    // line, so a lazy answer would ring every middle token.
    const pad = Array.from({ length: 49 }, () => "pad ");
    const middle = Array.from({ length: 101 }, (_unused, at) => `t${at} `);
    const left = stubSide(...pad, ...middle, ...pad);
    const right = stubSide(...pad, ...middle.toReversed(), ...pad);

    expect(diffPairedTokens(left, right)).toEqual({ left: [], right: [] });
  });

  it("gives up past the character cap", () => {
    const long = "x".repeat(INTRA_LINE_CHARACTER_CAP + 1);
    const left = { text: long, tokens: undefined };
    const right = { text: `${long}y`, tokens: stubTokens(long, "y") };

    expect(diffPairedTokens(left, right)).toEqual({ left: [], right: [] });
  });

  it("compares characters when one side has no tokens", () => {
    const left = stubSide("const", " ", "a", " = ", "1", ";");

    expect(diffPairedTokens(left, { text: "const a = 2;" })).toEqual({
      left: [{ from: 10, to: 11 }],
      right: [{ from: 10, to: 11 }],
    });
  });
});

describe("computeIntraLineEmphasis", () => {
  const diff: DiffLine[] = [
    { kind: "ctx", content: "a", oldLine: 1, newLine: 1 },
    { kind: "del", content: "const a = 1;", oldLine: 2 },
    { kind: "del", content: "gone();", oldLine: 3 },
    { kind: "add", content: "const a = 2;", newLine: 2 },
    { kind: "ctx", content: "z", oldLine: 4, newLine: 3 },
  ];

  it("keys emphasis by unified row index for paired changed rows only", () => {
    const tokens: RowTokenMap = new Map([
      [1, stubTokens("const", " ", "a", " = ", "1", ";")],
      [3, stubTokens("const", " ", "a", " = ", "2", ";")],
    ]);

    const emphasis = computeIntraLineEmphasis(pairSplitRows(diff), tokens);

    expect([...emphasis.keys()]).toEqual([1, 3]);
    expect(emphasis.get(1)).toEqual([{ from: 10, to: 11 }]);
    expect(emphasis.get(3)).toEqual([{ from: 10, to: 11 }]);
  });

  it("skips a pair whose sides share nothing", () => {
    const tokens: RowTokenMap = new Map([
      [1, stubTokens("const", " ", "a", " = ", "1", ";")],
      [3, stubTokens("wholly", " ", "other", " ", "text", "!", "!")],
    ]);

    expect(computeIntraLineEmphasis(pairSplitRows(diff), tokens).size).toBe(0);
  });

  it("returns an empty map without tokens", () => {
    expect(computeIntraLineEmphasis(pairSplitRows(diff), undefined).size).toBe(
      0,
    );
  });
});
