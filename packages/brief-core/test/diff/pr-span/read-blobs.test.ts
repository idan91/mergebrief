import { describe, expect, it } from "vitest";
import {
  BetweenHeadsKinds,
  formatLineDiffPatch,
  type LineDiffInput,
  type LineDiffRunner,
  type PrSpanRefs,
} from "../../../src/diff/pr-span";
import {
  LINE_DIFF_CHARS_PER_LINE,
  SPAN_LINE_DIFF_MAX_CHARS,
  SPAN_LINE_DIFF_MAX_LINES,
} from "../../../src/diff/pr-span/consts";
import { comparePrDiffs } from "../../../src/diff/pr-span/logic/compare-patches";
import { readBetweenHeadsFiles } from "../../../src/diff/pr-span/logic/read-blobs";
import {
  makeBaseLines,
  makeDiff,
  makeFilePatch,
  makeText,
  stubSource,
} from "./helpers";

const REFS: PrSpanRefs = {
  prevBase: "base1",
  prevHead: "head1",
  newBase: "base1",
  newHead: "head2",
};
const FILE = "a.ts";

describe("readBetweenHeadsFiles when the work left affords no edit", () => {
  it("falls back before any runner for a file whose lines only moved", async () => {
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
    const seen: LineDiffInput[] = [];
    const recordingRunner: LineDiffRunner = (input) => {
      seen.push(input);
      return Promise.resolve(formatLineDiffPatch(input));
    };

    const result = await readBetweenHeadsFiles(
      source,
      REFS,
      compared,
      new AbortController().signal,
      recordingRunner,
      {
        maxLines: SPAN_LINE_DIFF_MAX_LINES,
        maxChars: SPAN_LINE_DIFF_MAX_CHARS,
        maxWork: compareCost,
      },
    );

    expect(result.ok && result.value.get(FILE)?.kind).toBe(
      BetweenHeadsKinds.UNREADABLE,
    );
    expect(seen).toEqual([]);
  });
});
