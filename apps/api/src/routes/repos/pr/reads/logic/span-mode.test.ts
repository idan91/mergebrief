import { describe, expect, it } from "vitest";
import { SpanReadKinds } from "../types";
import { classifySpanKey, isWholePullRequestPair } from "./span-mode";

const BASE = "b".repeat(40);
const OTHER_BASE = "e".repeat(40);
const HEAD_1 = "1".repeat(40);
const HEAD_2 = "2".repeat(40);
const CHECKPOINT = "c".repeat(40);

const BRIEF_PAIRS = [
  { base: BASE, head: HEAD_1 },
  { base: OTHER_BASE, head: HEAD_2 },
];
const CURRENT_BASE = OTHER_BASE;

describe("isWholePullRequestPair", () => {
  it("reads a Brief's own base and head as the whole PR", () => {
    const pair = { base: BASE, head: HEAD_1 };

    expect(isWholePullRequestPair(pair, BRIEF_PAIRS, CURRENT_BASE)).toBe(true);
  });

  it("reads a pair on the PR's current base as the whole PR", () => {
    const pair = { base: "f".repeat(40), head: HEAD_2 };

    expect(isWholePullRequestPair(pair, [], "f".repeat(40))).toBe(true);
  });

  it("reads a stacked base equal to a briefed head as the whole PR", () => {
    const stacked = { base: HEAD_1, head: HEAD_2 };

    expect(isWholePullRequestPair(stacked, BRIEF_PAIRS, HEAD_1)).toBe(true);
  });

  it("leaves a pair of two briefed heads to the marks row", () => {
    const pair = { base: HEAD_1, head: HEAD_2 };

    expect(isWholePullRequestPair(pair, BRIEF_PAIRS, CURRENT_BASE)).toBe(false);
  });
});

describe("classifySpanKey", () => {
  it("reads a marked key as a span on the refs its row stores", () => {
    const pair = { base: HEAD_1, head: HEAD_2 };
    const marksRefs = { prevBase: BASE, newBase: OTHER_BASE };

    const read = classifySpanKey(pair, { marksRefs, isRefused: false });

    expect(read).toEqual({
      kind: SpanReadKinds.SPAN,
      refs: {
        prevBase: BASE,
        prevHead: HEAD_1,
        newBase: OTHER_BASE,
        newHead: HEAD_2,
      },
    });
  });

  it("reads a Checkpoint key from its marks row like any other", () => {
    const pair = { base: CHECKPOINT, head: HEAD_2 };
    const marksRefs = { prevBase: OTHER_BASE, newBase: OTHER_BASE };

    const read = classifySpanKey(pair, { marksRefs, isRefused: false });

    expect(read).toMatchObject({ kind: SpanReadKinds.SPAN });
  });

  it("refuses an unmarked key whose span the worker stored as refused", () => {
    const pair = { base: HEAD_1, head: HEAD_2 };

    const read = classifySpanKey(pair, { isRefused: true });

    expect(read).toEqual({ kind: SpanReadKinds.REFUSED });
  });

  it("compares an unmarked key with no skip record", () => {
    const pair = { base: HEAD_2, head: HEAD_1 };

    const read = classifySpanKey(pair, { isRefused: false });

    expect(read).toEqual({ kind: SpanReadKinds.COMPARE });
  });
});
