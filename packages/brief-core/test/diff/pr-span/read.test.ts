import { describe, expect, it } from "vitest";
import {
  BetweenHeadsKinds,
  BlobReadKinds,
  PrSpanFailureKinds,
  readPrSpan,
  type PrSpanRefs,
} from "../../../src/diff/pr-span";
import {
  BLOB_READ_CONCURRENCY,
  IDENTITY_SPAN,
  LINE_DIFF_CHARS_PER_LINE,
  MAX_LINE_DIFF_BYTES,
  MAX_SPAN_CHANGED_FILES,
  SPAN_LINE_DIFF_MAX_CHARS,
  SPAN_LINE_DIFF_MAX_LINES,
  SPAN_LINE_DIFF_MAX_WORK,
  WIDE_TEXT_CHAR_WEIGHT,
} from "../../../src/diff/pr-span/consts";
import { comparePrDiffs } from "../../../src/diff/pr-span/logic/compare-patches";
import {
  readBetweenHeadsFiles,
  type SpanLineDiffBounds,
} from "../../../src/diff/pr-span/logic/read-blobs";
import {
  insertAfter,
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
const PREV_SPAN = "base1..head1";
const NEW_SPAN = "base1..head2";

const base = makeBaseLines(12);
const baseText = makeText(base);
const withP1 = makeText(insertAfter(base, "b5", ["p1"]));
const withP1AndP2 = makeText(
  insertAfter(insertAfter(base, "b5", ["p1"]), "b10", ["p2"]),
);

function makeOkDiff(patches: readonly string[]): { ok: true; value: string } {
  return { ok: true, value: makeDiff(patches) };
}

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("readPrSpan", () => {
  it("diffs a file newly added to the PR against its previous-head blob", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({ path: "c.ts", base: baseText, head: withP1 }),
        ]),
      },
      blobs: { "head1:c.ts": baseText, "head2:c.ts": withP1 },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    expect(result.ok).toBe(true);
    const span = result.ok ? result.value : undefined;
    expect(span?.changedFiles).toEqual(["c.ts"]);
    expect(span?.filteredDiff).toContain("+p1");
    expect(span?.hop).toEqual([
      {
        file: "c.ts",
        hunks: [{ oldStart: 3, oldLines: 6, newStart: 3, newLines: 7 }],
      },
    ]);
  });

  it("keeps the reverting hunk of a file reverted to base", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "d.ts", base: baseText, head: withP1 }),
        ]),
        [NEW_SPAN]: makeOkDiff([]),
      },
      blobs: { "head1:d.ts": withP1, "head2:d.ts": baseText },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    expect(result.ok && result.value.filteredDiff).toContain("-p1");
  });

  it("demotes a file renamed at the new head only", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "a.ts", base: baseText, head: withP1 }),
        ]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({
            path: "b.ts",
            prePath: "a.ts",
            base: baseText,
            head: withP1,
          }),
        ]),
      },
      blobs: { "head1:a.ts": withP1, "head2:b.ts": withP1 },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.changedFiles).toEqual(["b.ts"]);
    expect(span?.hop).toEqual([{ file: "a.ts", hunks: [] }]);
    expect(span?.unpairableFiles).toEqual(["b.ts"]);
    expect(span?.filteredDiff).toContain("rename from a.ts");
    expect(span?.filteredDiff).not.toContain("/dev/null");
  });

  it("reads a rename the new head reverted as one renamed file", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({
            path: "b.ts",
            prePath: "a.ts",
            base: baseText,
            head: withP1,
          }),
        ]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({ path: "a.ts", base: baseText, head: withP1 }),
        ]),
      },
      blobs: { "head1:b.ts": withP1, "head2:a.ts": withP1 },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.changedFiles).toEqual(["a.ts"]);
    expect(span?.hop).toEqual([{ file: "b.ts", hunks: [] }]);
    expect(span?.filteredDiff).toContain("rename from b.ts");
    expect(span?.filteredDiff).not.toContain("/dev/null");
  });

  it("demotes a file the new head renamed from outside the PR", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({
            path: "b.ts",
            prePath: "a.ts",
            base: baseText,
            head: withP1,
          }),
        ]),
      },
      blobs: { "head1:a.ts": baseText, "head2:b.ts": withP1 },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.hop).toEqual([{ file: "a.ts", hunks: [] }]);
    expect(span?.filteredDiff).toContain("+p1");
  });

  it("places ranges through the same rename at both heads", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({
            path: "b.ts",
            prePath: "a.ts",
            base: baseText,
            head: withP1,
          }),
        ]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({
            path: "b.ts",
            prePath: "a.ts",
            base: baseText,
            head: withP1AndP2,
          }),
        ]),
      },
      blobs: { "head1:b.ts": withP1, "head2:b.ts": withP1AndP2 },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.changedFiles).toEqual(["b.ts"]);
    expect(span?.hop).toEqual([
      {
        file: "b.ts",
        hunks: [{ oldStart: 9, oldLines: 5, newStart: 9, newLines: 6 }],
      },
    ]);
  });

  it("keeps the content of a file deleted at the new head", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "f.ts", base: baseText, head: withP1 }),
        ]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({
            path: "f.ts",
            base: baseText,
            head: "",
            isDeleted: true,
          }),
        ]),
      },
      blobs: { "head1:f.ts": withP1 },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.changedFiles).toEqual(["f.ts"]);
    expect(span?.filteredDiff).toContain("+++ /dev/null");
    expect(span?.filteredDiff).toContain("-p1");
  });

  it("keeps the content of a file the previous head deleted", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({
            path: "f.ts",
            base: baseText,
            head: "",
            isDeleted: true,
          }),
        ]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({ path: "f.ts", base: baseText, head: withP1 }),
        ]),
      },
      blobs: { "head2:f.ts": withP1 },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.filteredDiff).toContain("--- /dev/null");
    expect(span?.filteredDiff).toContain("+p1");
  });

  it("keeps the content beside a mode change", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "f.ts", base: baseText, head: withP1 }),
        ]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({
            path: "f.ts",
            base: baseText,
            head: withP1AndP2,
            oldMode: "100644",
            mode: "100755",
          }),
        ]),
      },
      blobs: { "head1:f.ts": withP1, "head2:f.ts": withP1AndP2 },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.changedFiles).toEqual(["f.ts"]);
    expect(span?.filteredDiff).toContain("old mode 100644\nnew mode 100755");
    expect(span?.filteredDiff).toContain("+p2");
  });

  it("demotes a changed file absent at both heads", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({ path: "c.ts", base: baseText, head: withP1 }),
        ]),
      },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.hop).toEqual([{ file: "c.ts", hunks: [] }]);
    expect(span?.unpairableFiles).toEqual(["c.ts"]);
  });

  it("reads each head's PR diff against that head's own base", async () => {
    const refs: PrSpanRefs = { ...REFS, newBase: "base2" };
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "f.ts", base: baseText, head: withP1 }),
        ]),
        "base2..head2": makeOkDiff([
          makeFilePatch({ path: "f.ts", base: baseText, head: withP1 }),
          makeFilePatch({ path: "e.ts", base: baseText, head: withP1 }),
        ]),
      },
      blobs: { "head1:e.ts": baseText, "head2:e.ts": withP1 },
    });

    const result = await readPrSpan(source, refs, makeSignal());

    expect(source.diffCalls).toEqual([
      { base: "base1", head: "head1" },
      { base: "base2", head: "head2" },
    ]);
    expect(result.ok && result.value.changedFiles).toEqual(["e.ts"]);
    expect(result.ok && result.value.unchangedFiles).toEqual(["f.ts"]);
  });

  it("reads a run the base absorbed as changed without a blob read", async () => {
    const refs: PrSpanRefs = { ...REFS, newBase: "base2" };
    const baseWithP2 = makeText(insertAfter(base, "b10", ["p2"]));
    const prevPatch = makeFilePatch({
      path: "f.ts",
      base: baseText,
      head: withP1AndP2,
    });
    const newPatch = makeFilePatch({
      path: "f.ts",
      base: baseWithP2,
      head: withP1AndP2,
    });
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          prevPatch.replace(/^index \S+/m, "index aaaaaaa..ccccccc"),
        ]),
        "base2..head2": makeOkDiff([
          newPatch.replace(/^index \S+/m, "index bbbbbbb..ccccccc"),
        ]),
      },
    });

    const result = await readPrSpan(source, refs, makeSignal());

    expect(result.ok).toBe(true);
    const span = result.ok ? result.value : undefined;
    expect(span?.isUnchanged).toBe(false);
    expect(span?.changedFiles).toEqual(["f.ts"]);
    expect(span?.filteredDiff).toBe("diff --git a/f.ts b/f.ts");
    expect(span?.hop).toEqual([{ file: "f.ts", hunks: [IDENTITY_SPAN] }]);
    expect(source.blobCalls).toEqual([]);
  });

  it("reads the same edit moved to another file on one base as changed", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "pkg-a/t.json", base: baseText, head: withP1 }),
        ]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({ path: "pkg-b/t.json", base: baseText, head: withP1 }),
        ]),
      },
      blobs: {
        "head1:pkg-a/t.json": withP1,
        "head2:pkg-a/t.json": baseText,
        "head1:pkg-b/t.json": baseText,
        "head2:pkg-b/t.json": withP1,
      },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.isUnchanged).toBe(false);
    expect(span?.changedFiles).toEqual(["pkg-b/t.json", "pkg-a/t.json"]);
    expect(span?.filteredDiff).toContain("+p1");
    expect(span?.filteredDiff).toContain("-p1");
  });

  it("confirms a base rename by absence at the swapped paths", async () => {
    const refs: PrSpanRefs = { ...REFS, newBase: "base2" };
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "a.ts", base: baseText, head: withP1 }),
        ]),
        "base2..head2": makeOkDiff([
          makeFilePatch({ path: "a2.ts", base: baseText, head: withP1 }),
        ]),
      },
    });

    const result = await readPrSpan(source, refs, makeSignal());

    expect(result.ok && result.value.isUnchanged).toBe(true);
    expect(source.blobCalls).toEqual([
      { path: "a2.ts", ref: "head1", maxBytes: MAX_LINE_DIFF_BYTES },
      { path: "a.ts", ref: "head2", maxBytes: MAX_LINE_DIFF_BYTES },
    ]);
  });

  it("confirms a base rename when both heads name the same base SHA", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "a.ts", base: baseText, head: withP1 }),
        ]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({ path: "a2.ts", base: baseText, head: withP1 }),
        ]),
      },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    expect(result.ok && result.value.isUnchanged).toBe(true);
    expect(source.blobCalls).toEqual([
      { path: "a2.ts", ref: "head1", maxBytes: MAX_LINE_DIFF_BYTES },
      { path: "a.ts", ref: "head2", maxBytes: MAX_LINE_DIFF_BYTES },
    ]);
  });

  it("reads a base rename as changed when a swapped path exists", async () => {
    const refs: PrSpanRefs = { ...REFS, newBase: "base2" };
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "a.ts", base: baseText, head: withP1 }),
        ]),
        "base2..head2": makeOkDiff([
          makeFilePatch({ path: "a2.ts", base: baseText, head: withP1 }),
        ]),
      },
      blobs: {
        "head1:a.ts": withP1,
        "head2:a.ts": baseText,
        "head1:a2.ts": baseText,
        "head2:a2.ts": withP1,
      },
    });

    const result = await readPrSpan(source, refs, makeSignal());

    expect(result.ok && result.value.changedFiles).toEqual(["a2.ts", "a.ts"]);
  });

  it("fails the span when a base rename probe fails", async () => {
    const refs: PrSpanRefs = { ...REFS, newBase: "base2" };
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "a.ts", base: baseText, head: withP1 }),
        ]),
        "base2..head2": makeOkDiff([
          makeFilePatch({ path: "a2.ts", base: baseText, head: withP1 }),
        ]),
      },
      blobs: {
        "head1:a2.ts": {
          ok: false,
          error: { kind: PrSpanFailureKinds.TRANSIENT },
        },
      },
    });

    expect(await readPrSpan(source, refs, makeSignal())).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.TRANSIENT },
    });
  });

  it("falls back to the new PR hunks for a blob past the byte bound", async () => {
    const oversized = "x".repeat(MAX_LINE_DIFF_BYTES + 1);
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "f.ts", base: baseText, head: withP1 }),
        ]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({ path: "f.ts", base: baseText, head: withP1AndP2 }),
        ]),
      },
      blobs: { "head1:f.ts": oversized, "head2:f.ts": withP1AndP2 },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.filteredDiff).toContain("+p2");
    expect(span?.hop).toEqual([{ file: "f.ts", hunks: [] }]);
    expect(span?.unpairableFiles).toEqual(["f.ts"]);
  });

  it("falls back for a blob the source cannot read as text", async () => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: makeOkDiff([
          makeFilePatch({ path: "f.ts", base: baseText, head: withP1 }),
        ]),
        [NEW_SPAN]: makeOkDiff([
          makeFilePatch({ path: "f.ts", base: baseText, head: withP1AndP2 }),
        ]),
      },
      blobs: {
        "head1:f.ts": { ok: true, value: { kind: BlobReadKinds.UNREADABLE } },
        "head2:f.ts": withP1AndP2,
      },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    expect(result.ok && result.value.unpairableFiles).toEqual(["f.ts"]);
  });

  it("answers too-large past the file bound before any blob read", async () => {
    const files = Array.from(
      { length: MAX_SPAN_CHANGED_FILES + 1 },
      (_unused, index) =>
        makeFilePatch({ path: `f${index}.ts`, base: baseText, head: withP1 }),
    );
    const source = stubSource({
      diffs: { [PREV_SPAN]: makeOkDiff([]), [NEW_SPAN]: makeOkDiff(files) },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    expect(result).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.TOO_LARGE },
    });
    expect(source.blobCalls).toEqual([]);
  });

  it("stops reading blobs once the signal aborts", async () => {
    const controller = new AbortController();
    const files = Array.from(
      { length: BLOB_READ_CONCURRENCY + 1 },
      (_unused, index) =>
        makeFilePatch({ path: `f${index}.ts`, base: baseText, head: withP1 }),
    );
    const source = stubSource({
      diffs: { [PREV_SPAN]: makeOkDiff([]), [NEW_SPAN]: makeOkDiff(files) },
      onFetchBlob: () => controller.abort(new Error("superseded")),
    });

    await expect(readPrSpan(source, REFS, controller.signal)).rejects.toThrow(
      "superseded",
    );
    expect(source.blobCalls).toHaveLength(BLOB_READ_CONCURRENCY * 2);
  });

  it.each([
    PrSpanFailureKinds.TRANSIENT,
    PrSpanFailureKinds.UNAVAILABLE,
    PrSpanFailureKinds.TOO_LARGE,
  ])("passes a %s PR diff failure through", async (kind) => {
    const source = stubSource({
      diffs: {
        [PREV_SPAN]: { ok: false, error: { kind } },
        [NEW_SPAN]: makeOkDiff([]),
      },
    });

    expect(await readPrSpan(source, REFS, makeSignal())).toEqual({
      ok: false,
      error: { kind },
    });
  });

  it.each([
    [
      PrSpanFailureKinds.TRANSIENT,
      PrSpanFailureKinds.TOO_LARGE,
      PrSpanFailureKinds.TOO_LARGE,
    ],
    [
      PrSpanFailureKinds.TOO_LARGE,
      PrSpanFailureKinds.TRANSIENT,
      PrSpanFailureKinds.TOO_LARGE,
    ],
    [
      PrSpanFailureKinds.TRANSIENT,
      PrSpanFailureKinds.UNAVAILABLE,
      PrSpanFailureKinds.UNAVAILABLE,
    ],
    [
      PrSpanFailureKinds.UNAVAILABLE,
      PrSpanFailureKinds.TOO_LARGE,
      PrSpanFailureKinds.TOO_LARGE,
    ],
  ])(
    "prefers the lasting failure of %s and %s",
    async (prevKind, newKind, expected) => {
      const source = stubSource({
        diffs: {
          [PREV_SPAN]: { ok: false, error: { kind: prevKind } },
          [NEW_SPAN]: { ok: false, error: { kind: newKind } },
        },
      });

      expect(await readPrSpan(source, REFS, makeSignal())).toEqual({
        ok: false,
        error: { kind: expected },
      });
    },
  );

  it.each([PrSpanFailureKinds.TRANSIENT, PrSpanFailureKinds.UNAVAILABLE])(
    "passes a %s blob failure through",
    async (kind) => {
      const source = stubSource({
        diffs: {
          [PREV_SPAN]: makeOkDiff([]),
          [NEW_SPAN]: makeOkDiff([
            makeFilePatch({ path: "c.ts", base: baseText, head: withP1 }),
          ]),
        },
        blobs: { "head1:c.ts": { ok: false, error: { kind } } },
      });

      expect(await readPrSpan(source, REFS, makeSignal())).toEqual({
        ok: false,
        error: { kind },
      });
    },
  );
});

/** Both heads' text of one changed file, keyed by its path. */
type HeadSides = ReadonlyMap<string, readonly [string, string]>;

/** Each file's between-heads kind in path-map order, and how many blobs the span read. */
interface SpanKinds {
  readonly kinds: readonly (string | undefined)[];
  readonly blobReads: number;
}

/** The span's line diffs over these blobs; each file's PR diff is a small edit, since only its path is read. */
async function readSpanKinds(
  sides: HeadSides,
  bounds?: SpanLineDiffBounds,
): Promise<SpanKinds> {
  const paths = [...sides.keys()];
  const blobs: Record<string, string> = {};
  for (const [path, [prev, next]] of sides) {
    blobs[`head1:${path}`] = prev;
    blobs[`head2:${path}`] = next;
  }
  const source = stubSource({ diffs: {}, blobs });
  const patches = paths.map((path) =>
    makeFilePatch({ path, base: baseText, head: withP1 }),
  );
  const compared = comparePrDiffs(makeDiff([]), makeDiff(patches));

  const result = await readBetweenHeadsFiles(
    source,
    REFS,
    compared,
    makeSignal(),
    bounds,
  );

  const kinds = result.ok
    ? paths.map((path) => result.value.get(path)?.kind)
    : [];
  return { kinds, blobReads: source.blobCalls.length };
}

function makeSamePaths(
  prefix: string,
  count: number,
  sides: readonly [string, string],
): HeadSides {
  return new Map(
    Array.from({ length: count }, (_unused, index) => [
      `${prefix}${String(index).padStart(3, "0")}.ts`,
      sides,
    ]),
  );
}

function makeLines(count: number, makeLine: (index: number) => string): string {
  return makeText(
    Array.from({ length: count }, (_unused, index) => makeLine(index)),
  );
}

/** A file's compare cost: its weighted characters plus the per-line cost. */
function countCompareCost(prev: string, next: string, weight = 1): number {
  const lines = countTextLines(prev) + countTextLines(next);
  return (
    (prev.length + next.length) * weight + lines * LINE_DIFF_CHARS_PER_LINE
  );
}

function countTextLines(content: string): number {
  return content.split("\n").length - 1;
}

const P1_SIDES = [baseText, withP1] as const;
/** `withP1` inserts one line: an edit length of 1. */
const P1_COST = countCompareCost(baseText, withP1);
const DEFAULT_BOUNDS = {
  maxLines: SPAN_LINE_DIFF_MAX_LINES,
  maxChars: SPAN_LINE_DIFF_MAX_CHARS,
  maxWork: SPAN_LINE_DIFF_MAX_WORK,
};

describe("readBetweenHeadsFiles under the line bound", () => {
  const fileLines = 26;
  const sides = makeSamePaths("f", BLOB_READ_CONCURRENCY + 2, P1_SIDES);

  it("falls back for the file past the bound and every file after it", async () => {
    const { kinds, blobReads } = await readSpanKinds(sides, {
      ...DEFAULT_BOUNDS,
      maxLines: fileLines * 2,
    });

    expect(kinds.slice(0, 2)).toEqual([
      BetweenHeadsKinds.PATCH,
      BetweenHeadsKinds.PATCH,
    ]);
    expect(new Set(kinds.slice(2))).toEqual(
      new Set([BetweenHeadsKinds.UNREADABLE]),
    );
    expect(blobReads).toBe(BLOB_READ_CONCURRENCY * 2);
  });

  it("spends the bound in path order whatever order the files came in", async () => {
    const reversed = new Map([...sides].toReversed());

    const { kinds } = await readSpanKinds(reversed, {
      ...DEFAULT_BOUNDS,
      maxLines: fileLines * 2,
    });

    const patched = [...reversed.keys()].filter(
      (_path, index) => kinds[index] === BetweenHeadsKinds.PATCH,
    );
    expect(patched.toSorted()).toEqual([...sides.keys()].slice(0, 2));
  });
});

describe("readBetweenHeadsFiles under the character bound", () => {
  const p1Chars = baseText.length + withP1.length;

  it("falls back for the file past the bound and every file after it", async () => {
    const sides = makeSamePaths("c", BLOB_READ_CONCURRENCY + 2, P1_SIDES);

    const { kinds, blobReads } = await readSpanKinds(sides, {
      ...DEFAULT_BOUNDS,
      maxChars: p1Chars * 2.5,
    });

    expect(kinds.slice(0, 2)).toEqual([
      BetweenHeadsKinds.PATCH,
      BetweenHeadsKinds.PATCH,
    ]);
    expect(new Set(kinds.slice(2))).toEqual(
      new Set([BetweenHeadsKinds.UNREADABLE]),
    );
    expect(blobReads).toBe(BLOB_READ_CONCURRENCY * 2);
  });

  it.each([
    ["previous", [`${baseText}→\n`, withP1]],
    ["new", [baseText, `${withP1}→\n`]],
  ] as const)(
    "weights every character of a file wide on its %s side",
    async (_side, wideSides) => {
      const wideChars = wideSides[0].length + wideSides[1].length;
      const sides: HeadSides = new Map([
        ["a.ts", wideSides],
        ["b.ts", P1_SIDES],
      ]);

      const { kinds } = await readSpanKinds(sides, {
        ...DEFAULT_BOUNDS,
        maxChars: wideChars * WIDE_TEXT_CHAR_WEIGHT,
      });

      expect(kinds).toEqual([
        BetweenHeadsKinds.PATCH,
        BetweenHeadsKinds.UNREADABLE,
      ]);
    },
  );

  it("charges a character up to U+00FF once", async () => {
    const latinSides = [`${baseText}é\n`, withP1] as const;
    const latinChars = latinSides[0].length + latinSides[1].length;
    const sides: HeadSides = new Map([
      ["a.ts", latinSides],
      ["b.ts", P1_SIDES],
    ]);

    const { kinds } = await readSpanKinds(sides, {
      ...DEFAULT_BOUNDS,
      maxChars: latinChars + p1Chars,
    });

    expect(kinds).toEqual([BetweenHeadsKinds.PATCH, BetweenHeadsKinds.PATCH]);
  });

  it("reads only a few of 300 two-byte files of nearly a megabyte", async () => {
    const lineChars = 99_980;
    const prev = makeLines(10, (index) => `${index}`.padStart(lineChars, "x"));
    /** Three arrows for nine ASCII characters: the same UTF-8 bytes, under the byte bound. */
    const next = prev.replace("xxxxxxxxx", "→→→");
    const sides = makeSamePaths("m", MAX_SPAN_CHANGED_FILES, [prev, next]);
    const fileChars = (prev.length + next.length) * WIDE_TEXT_CHAR_WEIGHT;
    const affordableFiles = Math.floor(SPAN_LINE_DIFF_MAX_CHARS / fileChars);

    const { kinds, blobReads } = await readSpanKinds(sides);

    expect(affordableFiles).toBeGreaterThan(0);
    expect(kinds.slice(0, affordableFiles)).toEqual(
      Array<string>(affordableFiles).fill(BetweenHeadsKinds.PATCH),
    );
    expect(new Set(kinds.slice(affordableFiles))).toEqual(
      new Set([BetweenHeadsKinds.UNREADABLE]),
    );
    expect(blobReads).toBeLessThanOrEqual(BLOB_READ_CONCURRENCY * 2);
  });
});

describe("readBetweenHeadsFiles under the line-diff work bound", () => {
  const rewrittenLines = 200;
  const before = makeLines(rewrittenLines, (index) => `old${index}`);
  const after = makeLines(rewrittenLines, (index) => `new${index}`);
  /** A file rewritten whole: its edit length is every line of both sides. */
  const fileLines = rewrittenLines * 2;
  const fileWork = countCompareCost(before, after) * fileLines;

  it("lets one file's diff spend at most half of the work left", async () => {
    const sides = makeSamePaths("w", BLOB_READ_CONCURRENCY + 2, [
      before,
      after,
    ]);

    const { kinds, blobReads } = await readSpanKinds(sides, {
      ...DEFAULT_BOUNDS,
      maxWork: fileWork * 2,
    });

    expect(kinds[0]).toBe(BetweenHeadsKinds.PATCH);
    expect(new Set(kinds.slice(1))).toEqual(
      new Set([BetweenHeadsKinds.UNREADABLE]),
    );
    expect(blobReads).toBe((BLOB_READ_CONCURRENCY + 2) * 2);
  });

  it("weights the compare cost of wide text", async () => {
    const wideAfter = `${after}→\n`;
    const plainWork = countCompareCost(before, wideAfter) * (fileLines + 1);
    const bounds = { ...DEFAULT_BOUNDS, maxWork: plainWork * 2 };
    const plain = new Map([["a.ts", [before, `${after}-\n`] as const]]);
    const wide = new Map([["a.ts", [before, wideAfter] as const]]);

    const plainKinds = await readSpanKinds(plain, bounds);
    const wideKinds = await readSpanKinds(wide, bounds);

    expect(plainKinds.kinds).toEqual([BetweenHeadsKinds.PATCH]);
    expect(wideKinds.kinds).toEqual([BetweenHeadsKinds.UNREADABLE]);
  });

  it("charges no work to a file the byte bound refuses", async () => {
    const oversized = "x".repeat(MAX_LINE_DIFF_BYTES + 1);
    const sides: HeadSides = new Map([
      ["a.ts", [oversized, withP1]],
      ["b.ts", P1_SIDES],
    ]);

    const { kinds } = await readSpanKinds(sides, {
      ...DEFAULT_BOUNDS,
      maxWork: P1_COST * 2,
    });

    expect(kinds).toEqual([
      BetweenHeadsKinds.UNREADABLE,
      BetweenHeadsKinds.PATCH,
    ]);
  });

  it("charges no work to a file whose line counts pass its share", async () => {
    /** Four lines changed: an edit length of 8, which fits only if the rewrite before it spent nothing. */
    const fourChanged = makeLines(rewrittenLines, (index) =>
      index < 4 ? `changed${index}` : `old${index}`,
    );
    const changedEditLength = 8;
    const changedCost = countCompareCost(before, fourChanged);
    const sides: HeadSides = new Map([
      ["a.ts", [before, after]],
      ["b.ts", [before, fourChanged]],
    ]);

    const { kinds } = await readSpanKinds(sides, {
      ...DEFAULT_BOUNDS,
      maxWork: changedCost * changedEditLength * 2,
    });

    expect(kinds).toEqual([
      BetweenHeadsKinds.UNREADABLE,
      BetweenHeadsKinds.PATCH,
    ]);
  });

  it("leaves half the work to later files when a reordered file passes", async () => {
    const reversed = makeText(
      before.split("\n").slice(0, rewrittenLines).toReversed(),
    );
    const reorderedCost = countCompareCost(before, reversed);
    /** Ten edit steps: far short of a reversal, which every line count allows. */
    const reorderedShare = reorderedCost * 10;
    const sides: HeadSides = new Map([
      ["a.ts", [before, reversed]],
      ["b.ts", P1_SIDES],
    ]);

    const { kinds } = await readSpanKinds(sides, {
      ...DEFAULT_BOUNDS,
      maxWork: reorderedShare * 2,
    });

    expect(kinds).toEqual([
      BetweenHeadsKinds.UNREADABLE,
      BetweenHeadsKinds.PATCH,
    ]);
  });

  it("diffs the files after a large lockfile with a few changed lines", async () => {
    const lockLines = 12_000;
    const lock = Array.from(
      { length: lockLines },
      (_unused, index) =>
        `    "node_modules/package-${index}/lib": { "version": "1.${index % 97}.0", "dev": true },`,
    );
    const lockAfter = lock.map((line, index) =>
      index % 133 === 0 ? line.replace("true", "false") : line,
    );
    const source = makeLines(
      300,
      (index) => `export const v${index} = ${index};`,
    );
    const sourceAfter = source.replace(/= (\d*0);/g, "= -$1;");
    const sides: HeadSides = new Map([
      ["package-lock.json", [makeText(lock), makeText(lockAfter)]],
      ...makeSamePaths("src/f", 30, [source, sourceAfter]),
    ]);

    const { kinds } = await readSpanKinds(sides);

    expect(new Set(kinds.slice(1))).toEqual(new Set([BetweenHeadsKinds.PATCH]));
  });
});

describe("readBetweenHeadsFiles at ordinary sizes", () => {
  it("diffs six large files with scattered edits and the files after them", async () => {
    const big = makeLines(
      3_000,
      (index) =>
        `  const value${index} = computeSomething(input${index}, options);`,
    );
    const bigAfter = makeLines(3_000, (index) =>
      index % 20 === 0
        ? `  const value${index} = computeOther(input${index});`
        : `  const value${index} = computeSomething(input${index}, options);`,
    );
    const small = makeLines(
      300,
      (index) => `export const v${index} = ${index};`,
    );
    const smallAfter = small.replace(/= (\d*0);/g, "= -$1;");
    const sides: HeadSides = new Map([
      ...makeSamePaths("lib/big", 6, [big, bigAfter]),
      ...makeSamePaths("src/f", 20, [small, smallAfter]),
    ]);

    const { kinds } = await readSpanKinds(sides);

    expect(new Set(kinds)).toEqual(new Set([BetweenHeadsKinds.PATCH]));
  });

  it("diffs the files after four large generated files", async () => {
    const generatedLines = 25_001;
    const generated = makeLines(
      generatedLines,
      (index) => `  "entry-${index}": "${index % 7}",`,
    );
    const generatedAfter = generated.replace(
      '"entry-9": "2"',
      '"entry-9": "3"',
    );
    const small = makeLines(
      300,
      (index) => `export const v${index} = ${index};`,
    );
    const smallAfter = small.replace("= 10;", "= -10;");
    const sides: HeadSides = new Map([
      ...makeSamePaths("a/gen", 4, [generated, generatedAfter]),
      ...makeSamePaths("b/f", 5, [small, smallAfter]),
    ]);

    const { kinds } = await readSpanKinds(sides);

    expect(new Set(kinds)).toEqual(new Set([BetweenHeadsKinds.PATCH]));
  });
});

describe("readBetweenHeadsFiles on files of long lines", () => {
  const longLines = 300;
  const prefix = "x".repeat(3_200);
  /** Same-length lines that differ only at the end: every compare reads the whole line. */
  const before = makeLines(longLines, (index) => `${prefix}o${index}`);
  const after = makeLines(longLines, (index) => `${prefix}n${index}`);
  const fileWork = countCompareCost(before, after) * longLines * 2;

  it("charges each character, so long-line rewrites spend the bound", async () => {
    const sides = makeSamePaths("l", BLOB_READ_CONCURRENCY, [before, after]);

    const { kinds } = await readSpanKinds(sides, {
      ...DEFAULT_BOUNDS,
      maxWork: fileWork * 2,
    });

    expect(kinds[0]).toBe(BetweenHeadsKinds.PATCH);
    expect(new Set(kinds.slice(1))).toEqual(
      new Set([BetweenHeadsKinds.UNREADABLE]),
    );
  });
});

describe("readPrSpan text", () => {
  const files = ["b.ts", "a.ts", "c.ts"];
  const blobs: Record<string, string> = {};
  for (const path of files) {
    blobs[`head1:${path}`] = baseText;
    blobs[`head2:${path}`] = withP1;
  }

  function makePrDiff(order: readonly string[]): { ok: true; value: string } {
    return makeOkDiff(
      order.map((path) =>
        makeFilePatch({ path, base: baseText, head: withP1 }),
      ),
    );
  }

  it("is byte-identical whatever order the PR diff lists its files in", async () => {
    const forward = await readPrSpan(
      stubSource({
        diffs: { [PREV_SPAN]: makeOkDiff([]), [NEW_SPAN]: makePrDiff(files) },
        blobs,
      }),
      REFS,
      makeSignal(),
    );
    const backward = await readPrSpan(
      stubSource({
        diffs: {
          [PREV_SPAN]: makeOkDiff([]),
          [NEW_SPAN]: makePrDiff(files.toReversed()),
        },
        blobs,
      }),
      REFS,
      makeSignal(),
    );

    expect(forward.ok && forward.value.filteredDiff).toBe(
      backward.ok && backward.value.filteredDiff,
    );
  });

  it("is byte-identical however slowly the blobs arrive", async () => {
    const fast = stubSource({
      diffs: { [PREV_SPAN]: makeOkDiff([]), [NEW_SPAN]: makePrDiff(files) },
      blobs,
    });
    const slow: typeof fast = {
      ...fast,
      async fetchBlob(blob, signal) {
        await new Promise((resolve) => setTimeout(resolve, blob.path.length));
        return fast.fetchBlob(blob, signal);
      },
    };

    const quick = await readPrSpan(fast, REFS, makeSignal());
    const delayed = await readPrSpan(slow, REFS, makeSignal());

    expect(quick.ok && quick.value.filteredDiff).toBe(
      delayed.ok && delayed.value.filteredDiff,
    );
  });
});
