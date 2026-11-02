import { describe, expect, it } from "vitest";
import {
  BetweenHeadsKinds,
  buildPrSpan,
  readPrSpan,
  type PrSpan,
  type PrSpanRefs,
} from "../../../src/diff/pr-span";
import { readGitRevisionDiffs, type RevisionHeads } from "./git-heads";
import {
  makeBaseLines,
  makeDiff,
  makeFilePatch,
  makeText,
  replaceLine,
  stubSource,
} from "./helpers";

const FILE = "src/f.ts";
const REFS: PrSpanRefs = {
  prevBase: "base1",
  prevHead: "head1",
  newBase: "base2",
  newHead: "head2",
};

const base = makeBaseLines(40);
const editedBase = replaceLine(replaceLine(base, "b10", ["b10z"]), "b30", [
  "b30x",
]);

function makePrPatch(from: readonly string[], to: readonly string[]): string {
  return makeDiff([
    makeFilePatch({ path: FILE, base: makeText(from), head: makeText(to) }),
  ]);
}

async function readJsdiffSpan(heads: RevisionHeads): Promise<PrSpan> {
  const source = stubSource({
    diffs: {
      "base1..head1": {
        ok: true,
        value: makePrPatch(heads.prevBase, heads.prevHead),
      },
      "base2..head2": {
        ok: true,
        value: makePrPatch(heads.newBase, heads.newHead),
      },
    },
    blobs: {
      [`head1:${FILE}`]: makeText(heads.prevHead),
      [`head2:${FILE}`]: makeText(heads.newHead),
    },
  });
  const result = await readPrSpan(source, REFS, new AbortController().signal);
  if (!result.ok) {
    throw new Error(`span read failed: ${result.error.kind}`);
  }
  return result.value;
}

function readGitSpan(heads: RevisionHeads): Promise<PrSpan> {
  const diffs = readGitRevisionDiffs(FILE, heads);
  const patch = diffs.betweenHeadsPatch;
  return Promise.resolve(
    buildPrSpan({
      prevPrDiff: diffs.prevPrDiff,
      newPrDiff: diffs.newPrDiff,
      betweenHeads: new Map([[FILE, { kind: BetweenHeadsKinds.PATCH, patch }]]),
    }),
  );
}

const readers = [
  { differ: "jsdiff", readSpan: readJsdiffSpan },
  { differ: "git", readSpan: readGitSpan },
];

function readChangedLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((line) => /^[+-][^+-]/.test(line))
    .map((line) => line.slice(1));
}

describe.each(readers)("a conflict rebase read by $differ", ({ readSpan }) => {
  it("sends the PR's edit over main's edit, not main's far edit", async () => {
    const span = await readSpan({
      prevBase: base,
      prevHead: replaceLine(base, "b10", ["p10"]),
      newBase: editedBase,
      newHead: replaceLine(editedBase, "b10z", ["p10"]),
    });

    expect(span.isUnchanged).toBe(false);
    expect(span.changedFiles).toEqual([FILE]);
    expect(readChangedLines(span.filteredDiff)).toEqual(["b10z", "p10"]);
  });

  it("sends the PR's deletion of a line main edited, not main's far edit", async () => {
    const span = await readSpan({
      prevBase: base,
      prevHead: replaceLine(base, "b10", []),
      newBase: editedBase,
      newHead: replaceLine(editedBase, "b10z", []),
    });

    expect(span.isUnchanged).toBe(false);
    expect(readChangedLines(span.filteredDiff)).toEqual(["b10z"]);
  });

  it("sends only the header when main absorbed a PR hunk and edited far", async () => {
    const prevHead = replaceLine(replaceLine(base, "b10", ["p10"]), "b20", [
      "p20",
    ]);
    const absorbedBase = replaceLine(replaceLine(base, "b10", ["p10"]), "b30", [
      "b30x",
    ]);

    const span = await readSpan({
      prevBase: base,
      prevHead,
      newBase: absorbedBase,
      newHead: replaceLine(absorbedBase, "b20", ["p20"]),
    });

    expect(span.isUnchanged).toBe(false);
    expect(span.changedFiles).toEqual([FILE]);
    expect(span.filteredDiff).toContain(`diff --git a/${FILE} b/${FILE}`);
    expect(readChangedLines(span.filteredDiff)).toEqual([]);
  });
});
