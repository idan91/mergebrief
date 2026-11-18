import { describe, expect, it } from "vitest";
import {
  buildPrSpan,
  PrSpanFailureKinds,
  readPrSpan,
  type PrSpanRefs,
} from "../../../src/diff/pr-span";
import { MAX_SPAN_CHANGED_FILES } from "../../../src/diff/pr-span/consts";
import { RemapOutcomes, remapThroughHops } from "../../../src/diff/remap";
import {
  insertAfter,
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
const SAME_BASE_REFS: PrSpanRefs = { ...REFS, newBase: "base1" };
const PREV_SPAN = "base1..head1";
const NEW_SPAN = "base2..head2";
const PREV_BLOB = `head1:${FILE}`;
const NEW_BLOB = `head2:${FILE}`;

const base = makeBaseLines(30);

interface RevisionFixture {
  readonly movedBase: readonly string[];
  readonly prevHead: readonly string[];
  readonly newHead: readonly string[];
}

function makePrPatch(
  path: string,
  from: readonly string[],
  to: readonly string[],
): string {
  return makeFilePatch({ path, base: makeText(from), head: makeText(to) });
}

function stubRevision(fixture: RevisionFixture, refs: PrSpanRefs = REFS) {
  return stubSource({
    diffs: {
      [PREV_SPAN]: {
        ok: true,
        value: makeDiff([makePrPatch(FILE, base, fixture.prevHead)]),
      },
      [`${refs.newBase}..${refs.newHead}`]: {
        ok: true,
        value: makeDiff([
          makePrPatch(FILE, fixture.movedBase, fixture.newHead),
        ]),
      },
    },
    blobs: {
      [PREV_BLOB]: makeText(fixture.prevHead),
      [NEW_BLOB]: makeText(fixture.newHead),
    },
  });
}

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("readPrSpan when the base moved under the PR change", () => {
  it("reads a run moved down the file over a moved base as changed", async () => {
    const movedBase = insertAfter(base, "b2", ["n1"]);
    const source = stubRevision({
      movedBase,
      prevHead: insertAfter(base, "b10", ["return;"]),
      newHead: insertAfter(movedBase, "b20", ["return;"]),
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    expect(result.ok).toBe(true);
    const span = result.ok ? result.value : undefined;
    expect(span?.isUnchanged).toBe(false);
    expect(span?.changedFiles).toEqual([FILE]);
    expect(span?.filteredDiff).toContain("-return;");
    expect(span?.filteredDiff).toContain("+return;");
    expect(span?.filteredDiff).not.toContain("+n1");
    expect(source.blobCalls).toHaveLength(2);
  });

  it("reads no blob for a base edit away from every run", async () => {
    const movedBase = insertAfter(base, "b2", ["n1"]);
    const source = stubRevision({
      movedBase,
      prevHead: insertAfter(base, "b20", ["p1"]),
      newHead: insertAfter(movedBase, "b20", ["p1"]),
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    expect(result.ok && result.value.isUnchanged).toBe(true);
    expect(source.blobCalls).toEqual([]);
  });

  it("reads a file as unchanged when its line diff is only base noise", async () => {
    const movedBase = replaceLine(base, "b19", ["b19x"]);
    const source = stubRevision({
      movedBase,
      prevHead: insertAfter(base, "b20", ["p1"]),
      newHead: insertAfter(movedBase, "b20", ["p1"]),
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    expect(result.ok).toBe(true);
    const span = result.ok ? result.value : undefined;
    expect(span?.isUnchanged).toBe(true);
    expect(span?.unchangedFiles).toEqual([FILE]);
    expect(span?.filteredDiff).toBe("");
    expect(span?.unfilteredDiff).toContain("+b19x");
    expect(source.blobCalls).toHaveLength(2);
    const hops = [span?.hop];
    expect(remapThroughHops(FILE, [{ start: 21, end: 21 }], hops)).toEqual({
      outcome: RemapOutcomes.REMAPPED,
      ranges: [{ start: 21, end: 21 }],
    });
    expect(remapThroughHops(FILE, [{ start: 19, end: 19 }], hops).outcome).toBe(
      RemapOutcomes.DEMOTED,
    );
  });

  it("counts escalated files against the file bound before any read", async () => {
    const movedBase = replaceLine(base, "b19", ["b19x"]);
    const paths = Array.from(
      { length: MAX_SPAN_CHANGED_FILES + 1 },
      (_unused, index) => `f${index}.ts`,
    );
    const prevHead = insertAfter(base, "b20", ["p1"]);
    const newHead = insertAfter(movedBase, "b20", ["p1"]);
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: {
          ok: true,
          value: makeDiff(
            paths.map((path) => makePrPatch(path, base, prevHead)),
          ),
        },
        [NEW_SPAN]: {
          ok: true,
          value: makeDiff(
            paths.map((path) => makePrPatch(path, movedBase, newHead)),
          ),
        },
      },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    expect(result).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.TOO_LARGE },
    });
    expect(source.blobCalls).toEqual([]);
  });
});

interface ShortMove {
  readonly title: string;
  readonly run: readonly string[];
  readonly prevAfter: string;
  readonly newAfter: string;
}

const SHORT_MOVES: readonly ShortMove[] = [
  {
    title: "one line up by one",
    run: ["return;"],
    prevAfter: "b11",
    newAfter: "b10",
  },
  {
    title: "one line down by one",
    run: ["return;"],
    prevAfter: "b10",
    newAfter: "b11",
  },
  {
    title: "two lines up by one",
    run: ["x1", "x2"],
    prevAfter: "b11",
    newAfter: "b10",
  },
  {
    title: "two lines down by one",
    run: ["x1", "x2"],
    prevAfter: "b10",
    newAfter: "b11",
  },
  {
    title: "two lines up by two",
    run: ["x1", "x2"],
    prevAfter: "b12",
    newAfter: "b10",
  },
  {
    title: "two lines down by two",
    run: ["x1", "x2"],
    prevAfter: "b10",
    newAfter: "b12",
  },
];

describe("readPrSpan when a run moves no further than its own length", () => {
  it.each(SHORT_MOVES)(
    "reads $title over a moved base as changed",
    async (move) => {
      const movedBase = insertAfter(base, "b2", ["n1"]);
      const source = stubRevision({
        movedBase,
        prevHead: insertAfter(base, move.prevAfter, move.run),
        newHead: insertAfter(movedBase, move.newAfter, move.run),
      });

      const result = await readPrSpan(source, REFS, makeSignal());

      const span = result.ok ? result.value : undefined;
      expect(span?.isUnchanged).toBe(false);
      expect(span?.changedFiles).toEqual([FILE]);
      expect(span?.filteredDiff).toContain(move.run[0]);
      expect(span?.filteredDiff).not.toContain("+n1");
    },
  );

  it.each(SHORT_MOVES)("keeps a hunk for $title on one base", async (move) => {
    const source = stubRevision(
      {
        movedBase: base,
        prevHead: insertAfter(base, move.prevAfter, move.run),
        newHead: insertAfter(base, move.newAfter, move.run),
      },
      SAME_BASE_REFS,
    );

    const result = await readPrSpan(source, SAME_BASE_REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.changedFiles).toEqual([FILE]);
    expect(span?.filteredDiff).toContain(move.run[0]);
  });
});

describe("buildPrSpan when an escalated file has no line diff", () => {
  it("reads it as changed and keeps every PR hunk", () => {
    const movedBase = insertAfter(base, "b2", ["n1"]);

    const span = buildPrSpan({
      prevPrDiff: makeDiff([
        makePrPatch(FILE, base, insertAfter(base, "b10", ["return;"])),
      ]),
      newPrDiff: makeDiff([
        makePrPatch(
          FILE,
          movedBase,
          insertAfter(movedBase, "b20", ["return;"]),
        ),
      ]),
      betweenHeads: new Map(),
    });

    expect(span.isUnchanged).toBe(false);
    expect(span.changedFiles).toEqual([FILE]);
    expect(span.unpairableFiles).toEqual([FILE]);
    expect(span.filteredDiff).toContain("+return;");
  });
});
