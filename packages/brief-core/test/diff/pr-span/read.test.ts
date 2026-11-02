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
  MAX_LINE_DIFF_BYTES,
  MAX_SPAN_CHANGED_FILES,
} from "../../../src/diff/pr-span/consts";
import { comparePrDiffs } from "../../../src/diff/pr-span/logic/compare-patches";
import { readBetweenHeadsFiles } from "../../../src/diff/pr-span/logic/read-blobs";
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

describe("readBetweenHeadsFiles", () => {
  it("falls back for every file once the line-diff budget is spent", async () => {
    const source = stubSource({
      diffs: {},
      blobs: { "head1:c.ts": baseText, "head2:c.ts": withP1 },
    });
    const compared = comparePrDiffs(
      makeDiff([]),
      makeDiff([makeFilePatch({ path: "c.ts", base: baseText, head: withP1 })]),
    );

    const result = await readBetweenHeadsFiles(
      source,
      REFS,
      compared,
      makeSignal(),
      0,
    );

    expect(source.blobCalls).toEqual([]);
    expect(result).toEqual({
      ok: true,
      value: new Map([["c.ts", { kind: BetweenHeadsKinds.UNREADABLE }]]),
    });
  });
});
