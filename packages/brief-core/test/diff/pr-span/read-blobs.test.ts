import { describe, expect, it, vi } from "vitest";
import { BetweenHeadsKinds, type PrSpanRefs } from "../../../src/diff/pr-span";
import {
  LINE_DIFF_CHARS_PER_LINE,
  SPAN_LINE_DIFF_MAX_CHARS,
  SPAN_LINE_DIFF_MAX_LINES,
} from "../../../src/diff/pr-span/consts";
import { comparePrDiffs } from "../../../src/diff/pr-span/logic/compare-patches";
import { formatBetweenHeadsPatch } from "../../../src/diff/pr-span/logic/line-diff";
import { readBetweenHeadsFiles } from "../../../src/diff/pr-span/logic/read-blobs";
import {
  makeBaseLines,
  makeDiff,
  makeFilePatch,
  makeText,
  stubSource,
} from "./helpers";

vi.mock("../../../src/diff/pr-span/logic/line-diff", async (importOriginal) => {
  const original = await importOriginal<{
    formatBetweenHeadsPatch: typeof formatBetweenHeadsPatch;
  }>();
  return {
    ...original,
    formatBetweenHeadsPatch: vi.fn(original.formatBetweenHeadsPatch),
  };
});

const REFS: PrSpanRefs = {
  prevBase: "base1",
  prevHead: "head1",
  newBase: "base1",
  newHead: "head2",
};
const FILE = "a.ts";

describe("readBetweenHeadsFiles when the work left affords no edit", () => {
  it("falls back before the line diff for a file whose lines only moved", async () => {
    const lines = makeBaseLines(12);
    const prev = makeText(lines);
    const reordered = makeText(lines.toReversed());
    const fileLines = lines.length * 2;
    const compareCost =
      prev.length + reordered.length + fileLines * LINE_DIFF_CHARS_PER_LINE;
    const source = stubSource({
      diffs: {},
      blobs: { [`head1:${FILE}`]: prev, [`head2:${FILE}`]: reordered },
    });
    const patch = makeFilePatch({ path: FILE, base: prev, head: reordered });
    const compared = comparePrDiffs(makeDiff([]), makeDiff([patch]));

    const result = await readBetweenHeadsFiles(
      source,
      REFS,
      compared,
      new AbortController().signal,
      {
        maxLines: SPAN_LINE_DIFF_MAX_LINES,
        maxChars: SPAN_LINE_DIFF_MAX_CHARS,
        maxWork: compareCost,
      },
    );

    expect(result.ok && result.value.get(FILE)?.kind).toBe(
      BetweenHeadsKinds.UNREADABLE,
    );
    expect(vi.mocked(formatBetweenHeadsPatch)).not.toHaveBeenCalled();
  });
});
