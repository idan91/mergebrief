import { describe, expect, it } from "vitest";
import {
  PrSpanFailureKinds,
  readPrSpan,
  type PrSpanRefs,
} from "../../../src/diff/pr-span";
import {
  IDENTITY_SPAN,
  MAX_SPAN_CHANGED_FILES,
} from "../../../src/diff/pr-span/consts";
import { buildFastForwardSpan } from "../../../src/diff/pr-span/logic/fast-forward-span";
import {
  insertAfter,
  makeBaseLines,
  makeDiff,
  makeFastForwardMergeBases,
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
const MERGE_BASE = "mb1";
const PREV_SPAN = "base1..head1";
const NEW_SPAN = "base1..head2";
const BETWEEN_SPAN = "head1..head2";

const base = makeBaseLines(12);
const baseText = makeText(base);
const withP1 = makeText(insertAfter(base, "b5", ["p1"]));
const withP1AndP2 = makeText(
  insertAfter(insertAfter(base, "b5", ["p1"]), "b10", ["p2"]),
);

const newPrDiff = makeDiff([
  makeFilePatch({ path: "a.ts", base: baseText, head: withP1AndP2 }),
  makeFilePatch({ path: "u.ts", base: baseText, head: withP1 }),
]);
const betweenHeadsDiff = makeDiff([
  makeFilePatch({ path: "a.ts", base: withP1, head: withP1AndP2 }),
]);

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

function stubFastForward(
  diffs: Record<string, { ok: true; value: string }> = {},
): ReturnType<typeof stubSource> {
  return stubSource({
    mergeBases: makeFastForwardMergeBases(REFS, MERGE_BASE),
    diffs: {
      [NEW_SPAN]: { ok: true, value: newPrDiff },
      [BETWEEN_SPAN]: { ok: true, value: betweenHeadsDiff },
      ...diffs,
    },
  });
}

describe("readPrSpan on a fast-forward over one merge base", () => {
  it("serves the between-heads compare unfiltered with no blob read", async () => {
    const source = stubFastForward();

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.filteredDiff).toBe(betweenHeadsDiff);
    expect(span?.unfilteredDiff).toBe(betweenHeadsDiff);
    expect(span?.changedFiles).toEqual(["a.ts"]);
    expect(span?.unchangedFiles).toEqual(["u.ts"]);
    expect(span?.hop).toEqual([
      {
        file: "a.ts",
        hunks: [{ oldStart: 9, oldLines: 5, newStart: 9, newLines: 6 }],
      },
      { file: "u.ts", hunks: [IDENTITY_SPAN] },
    ]);
    expect(source.blobCalls).toEqual([]);
  });

  it("reads no previous PR diff", async () => {
    const source = stubFastForward();

    await readPrSpan(source, REFS, makeSignal());

    expect(source.diffCalls).toEqual([
      { base: "base1", head: "head2" },
      { base: "head1", head: "head2" },
    ]);
    expect(source.mergeBaseCalls).toEqual([
      { base: "base1", head: "head1" },
      { base: "base1", head: "head2" },
      { base: "head1", head: "head2" },
    ]);
  });

  it("reads an empty push as unchanged with every file on identity", async () => {
    const source = stubFastForward({ [BETWEEN_SPAN]: { ok: true, value: "" } });

    const result = await readPrSpan(source, REFS, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.isUnchanged).toBe(true);
    expect(span?.filteredDiff).toBe("");
    expect(span?.hop).toEqual([
      { file: "a.ts", hunks: [IDENTITY_SPAN] },
      { file: "u.ts", hunks: [IDENTITY_SPAN] },
    ]);
  });

  it("reads a same-head push as unchanged on the fast path", async () => {
    const sameHead = { ...REFS, newHead: REFS.prevHead };
    const source = stubSource({
      mergeBases: makeFastForwardMergeBases(sameHead, MERGE_BASE),
      diffs: { [PREV_SPAN]: { ok: true, value: newPrDiff } },
    });

    const result = await readPrSpan(source, sameHead, makeSignal());

    const span = result.ok ? result.value : undefined;
    expect(span?.isUnchanged).toBe(true);
    expect(span?.hop).toEqual([
      { file: "a.ts", hunks: [IDENTITY_SPAN] },
      { file: "u.ts", hunks: [IDENTITY_SPAN] },
    ]);
    expect(source.diffCalls).toContainEqual({ base: "head1", head: "head1" });
  });

  it("takes the fast path for a retarget that keeps the merge base", async () => {
    const retarget = { ...REFS, newBase: "base2" };
    const source = stubSource({
      mergeBases: makeFastForwardMergeBases(retarget, MERGE_BASE),
      diffs: {
        "base2..head2": { ok: true, value: newPrDiff },
        [BETWEEN_SPAN]: { ok: true, value: betweenHeadsDiff },
      },
    });

    const result = await readPrSpan(source, retarget, makeSignal());

    expect(result.ok && result.value.filteredDiff).toBe(betweenHeadsDiff);
    expect(source.diffCalls).not.toContainEqual({
      base: "base1",
      head: "head1",
    });
  });

  it("answers too-large past the file bound", async () => {
    const patches = Array.from(
      { length: MAX_SPAN_CHANGED_FILES + 1 },
      (_x, n) =>
        makeFilePatch({ path: `f${n}.ts`, base: baseText, head: withP1 }),
    );
    const source = stubFastForward({
      [BETWEEN_SPAN]: { ok: true, value: makeDiff(patches) },
    });

    expect(await readPrSpan(source, REFS, makeSignal())).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.TOO_LARGE },
    });
  });

  it.each([
    PrSpanFailureKinds.TRANSIENT,
    PrSpanFailureKinds.UNAVAILABLE,
    PrSpanFailureKinds.TOO_LARGE,
  ])("passes a %s between-heads read failure through", async (kind) => {
    const source = stubSource({
      mergeBases: makeFastForwardMergeBases(REFS, MERGE_BASE),
      diffs: {
        [NEW_SPAN]: { ok: true, value: newPrDiff },
        [BETWEEN_SPAN]: { ok: false, error: { kind } },
      },
    });

    expect(await readPrSpan(source, REFS, makeSignal())).toEqual({
      ok: false,
      error: { kind },
    });
  });
});

describe("readPrSpan off the fast path", () => {
  const prevPrDiff = makeDiff([
    makeFilePatch({ path: "a.ts", base: baseText, head: withP1 }),
    makeFilePatch({ path: "u.ts", base: baseText, head: withP1 }),
  ]);

  it("builds the span for a catch-up merge that moved the merge base", async () => {
    const source = stubSource({
      mergeBases: {
        ...makeFastForwardMergeBases(REFS, MERGE_BASE),
        [NEW_SPAN]: { ok: true, value: "mb2" },
      },
      diffs: {
        [PREV_SPAN]: { ok: true, value: prevPrDiff },
        [NEW_SPAN]: { ok: true, value: newPrDiff },
      },
      blobs: { "head1:a.ts": withP1, "head2:a.ts": withP1AndP2 },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    expect(result.ok && result.value.changedFiles).toEqual(["a.ts"]);
    expect(source.diffCalls).toEqual([
      { base: "base1", head: "head2" },
      { base: "base1", head: "head1" },
    ]);
  });

  it("reads a run a catch-up merge took into the base as changed", async () => {
    const withP2 = makeText(insertAfter(base, "b10", ["p2"]));
    const prevPatch = makeFilePatch({
      path: "a.ts",
      base: baseText,
      head: withP1AndP2,
    });
    const newPatch = makeFilePatch({
      path: "a.ts",
      base: withP2,
      head: withP1AndP2,
    });
    const source = stubSource({
      mergeBases: {
        ...makeFastForwardMergeBases(REFS, MERGE_BASE),
        [NEW_SPAN]: { ok: true, value: "mb2" },
      },
      diffs: {
        [PREV_SPAN]: {
          ok: true,
          value: makeDiff([
            prevPatch.replace(/^index \S+/m, "index aaaaaaa..ccccccc"),
          ]),
        },
        [NEW_SPAN]: {
          ok: true,
          value: makeDiff([
            newPatch.replace(/^index \S+/m, "index bbbbbbb..ccccccc"),
          ]),
        },
      },
    });

    const result = await readPrSpan(source, REFS, makeSignal());

    expect(source.diffCalls).not.toContainEqual({
      base: "head1",
      head: "head2",
    });
    expect(result.ok && result.value.isUnchanged).toBe(false);
    expect(result.ok && result.value.changedFiles).toEqual(["a.ts"]);
    expect(result.ok && result.value.hop).toEqual([
      { file: "a.ts", hunks: [IDENTITY_SPAN] },
    ]);
  });

  it("builds the span for a force push over one merge base", async () => {
    const source = stubSource({
      mergeBases: {
        ...makeFastForwardMergeBases(REFS, MERGE_BASE),
        [BETWEEN_SPAN]: { ok: true, value: "older" },
      },
      diffs: {
        [PREV_SPAN]: { ok: true, value: prevPrDiff },
        [NEW_SPAN]: { ok: true, value: newPrDiff },
      },
      blobs: { "head1:a.ts": withP1, "head2:a.ts": withP1AndP2 },
    });

    await readPrSpan(source, REFS, makeSignal());

    expect(source.diffCalls).not.toContainEqual({
      base: "head1",
      head: "head2",
    });
    expect(source.blobCalls).toHaveLength(2);
  });

  it.each([
    [PrSpanFailureKinds.UNAVAILABLE, PrSpanFailureKinds.TRANSIENT],
    [PrSpanFailureKinds.TRANSIENT, PrSpanFailureKinds.TRANSIENT],
    [PrSpanFailureKinds.TOO_LARGE, PrSpanFailureKinds.UNAVAILABLE],
  ])(
    "ranks a %s merge-base failure with a %s PR diff failure",
    async (mergeBaseKind, diffKind) => {
      const source = stubSource({
        mergeBases: {
          [BETWEEN_SPAN]: { ok: false, error: { kind: mergeBaseKind } },
        },
        diffs: { [NEW_SPAN]: { ok: false, error: { kind: diffKind } } },
      });

      const result = await readPrSpan(source, REFS, makeSignal());

      const lasting =
        mergeBaseKind === PrSpanFailureKinds.TRANSIENT
          ? diffKind
          : mergeBaseKind;
      expect(result).toEqual({ ok: false, error: { kind: lasting } });
      expect(source.diffCalls).toHaveLength(1);
    },
  );

  it.each([PrSpanFailureKinds.UNAVAILABLE, PrSpanFailureKinds.TRANSIENT])(
    "fails the span on a %s merge-base read alone",
    async (kind) => {
      const source = stubSource({
        mergeBases: { [PREV_SPAN]: { ok: false, error: { kind } } },
        diffs: { [NEW_SPAN]: { ok: true, value: newPrDiff } },
      });

      expect(await readPrSpan(source, REFS, makeSignal())).toEqual({
        ok: false,
        error: { kind },
      });
    },
  );
});

describe("buildFastForwardSpan", () => {
  it("demotes a path the push renamed away and a file it dropped", () => {
    const between = makeDiff([
      makeFilePatch({
        path: "b.ts",
        prePath: "a.ts",
        base: withP1,
        head: withP1AndP2,
      }),
      makeFilePatch({
        path: "d.ts",
        base: withP1,
        head: "",
        isDeleted: true,
      }),
    ]);
    const prDiff = makeDiff([
      makeFilePatch({
        path: "b.ts",
        prePath: "a.ts",
        base: baseText,
        head: withP1AndP2,
      }),
    ]);

    const span = buildFastForwardSpan({
      betweenHeadsDiff: between,
      newPrDiff: prDiff,
    });

    expect(span.changedFiles).toEqual(["b.ts", "d.ts"]);
    expect(span.unchangedFiles).toEqual([]);
    expect(span.hop[0]).toEqual({ file: "a.ts", hunks: [] });
    expect(span.unpairableFiles).toEqual(["b.ts"]);
    expect(span.hop[1]).toEqual({
      file: "d.ts",
      hunks: [{ oldStart: 1, oldLines: 13, newStart: 0, newLines: 0 }],
    });
  });

  it("keeps a renamed-away path zero-hunk when a new file takes it", () => {
    const between = makeDiff([
      makeFilePatch({ path: "a.ts", base: "", head: baseText, isAdded: true }),
      makeFilePatch({
        path: "b.ts",
        prePath: "a.ts",
        base: withP1,
        head: withP1,
      }),
    ]);

    const span = buildFastForwardSpan({
      betweenHeadsDiff: between,
      newPrDiff: "",
    });

    expect(span.hop).toEqual([{ file: "a.ts", hunks: [] }]);
    expect(span.unpairableFiles).toEqual(["a.ts", "b.ts"]);
  });

  it("demotes a binary or mode-only change between the heads", () => {
    const between = [
      "diff --git a/img.png b/img.png",
      "index 1111111..2222222 100644",
      "Binary files a/img.png and b/img.png differ",
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
      "",
    ].join("\n");

    const span = buildFastForwardSpan({
      betweenHeadsDiff: between,
      newPrDiff: "",
    });

    expect(span.changedFiles).toEqual(["img.png", "run.sh"]);
    expect(span.hop).toEqual([
      { file: "img.png", hunks: [] },
      { file: "run.sh", hunks: [] },
    ]);
    expect(span.filteredDiff).toBe(span.unfilteredDiff);
  });
});
