import { describe, expect, it } from "vitest";
import type { FileDiff } from "../../src/diff/file-diff";
import { snapChunkRanges } from "../../src/generation/snap-ranges";
import type { LineRange } from "../../src/types";

interface StubChunk {
  file: string;
  addedRanges: LineRange[];
  removedRanges: LineRange[];
}

function stubChunk(
  addedRanges: LineRange[],
  removedRanges: LineRange[] = [],
  file = "src/a.ts",
): StubChunk {
  return { file, addedRanges, removedRanges };
}

/** One file with one hunk; `+`, `-` and ` ` lines as written. */
function makePatch(lines: string[], header = "@@ -1,1 +1,20 @@"): FileDiff[] {
  return [
    {
      file: "src/a.ts",
      patch: ["diff --git a/src/a.ts b/src/a.ts", header, ...lines].join("\n"),
    },
  ];
}

describe("snapChunkRanges", () => {
  it("absorbs the deeper-indented tail of a statement the chunk opened", () => {
    const diffs = makePatch([
      "+  const x = foo(",
      "+    a,",
      "+    b,",
      "+  );",
      "+  bar();",
    ]);

    const [snapped] = snapChunkRanges(
      [stubChunk([{ start: 1, end: 1 }])],
      diffs,
    );

    expect(snapped?.addedRanges).toEqual([{ start: 1, end: 4 }]);
  });

  it("leaves the next statement at the same indentation alone", () => {
    const diffs = makePatch(["+  foo();", "+  bar();", "+  baz();"]);

    const [snapped] = snapChunkRanges(
      [stubChunk([{ start: 1, end: 1 }])],
      diffs,
    );

    expect(snapped?.addedRanges).toEqual([{ start: 1, end: 1 }]);
  });

  it("takes a closing line only when the range opened a bracket", () => {
    const diffs = makePatch([
      "+  if (ok) {",
      "+    run();",
      "+  }",
      "+  done();",
    ]);
    const opened = snapChunkRanges([stubChunk([{ start: 1, end: 1 }])], diffs);
    const closed = snapChunkRanges([stubChunk([{ start: 2, end: 2 }])], diffs);

    expect(opened[0]?.addedRanges).toEqual([{ start: 1, end: 3 }]);
    expect(closed[0]?.addedRanges).toEqual([{ start: 2, end: 2 }]);
  });

  it("carries an if block through its else branch to the final closer", () => {
    const diffs = makePatch([
      "+  if (ready) {",
      "+    start();",
      "+  } else {",
      "+    wait();",
      "+  }",
      "+  next();",
    ]);

    const [snapped] = snapChunkRanges(
      [stubChunk([{ start: 1, end: 2 }])],
      diffs,
    );

    expect(snapped?.addedRanges).toEqual([{ start: 1, end: 5 }]);
  });

  it("ends a tail on a closer that carries a comment or a type suffix", () => {
    const withComment = makePatch([
      "+  run(() => {",
      "+    go();",
      "+  }); // fallback",
      "+  after();",
    ]);
    const withSuffix = makePatch([
      "+  const table = {",
      "+    a: 1,",
      "+  } as const;",
      "+  after();",
    ]);

    const [comment] = snapChunkRanges(
      [stubChunk([{ start: 1, end: 1 }])],
      withComment,
    );
    const [suffix] = snapChunkRanges(
      [stubChunk([{ start: 1, end: 1 }])],
      withSuffix,
    );

    expect(comment?.addedRanges).toEqual([{ start: 1, end: 3 }]);
    expect(suffix?.addedRanges).toEqual([{ start: 1, end: 3 }]);
  });

  it("follows a call chain that closes and reopens on one line", () => {
    const diffs = makePatch([
      "+  const out = build(",
      "+    input,",
      "+  ).map(",
      "+    format,",
      "+  );",
      "+  after();",
    ]);

    const [snapped] = snapChunkRanges(
      [stubChunk([{ start: 1, end: 1 }])],
      diffs,
    );

    expect(snapped?.addedRanges).toEqual([{ start: 1, end: 5 }]);
  });

  it("caps absorption at ten lines per range", () => {
    const tail = Array.from(
      { length: 14 },
      (_, at) => `+    item${String(at)},`,
    );
    const diffs = makePatch(["+  const list = [", ...tail, "+  ];"]);

    const [snapped] = snapChunkRanges(
      [stubChunk([{ start: 1, end: 1 }])],
      diffs,
    );

    expect(snapped?.addedRanges).toEqual([{ start: 1, end: 11 }]);
  });

  it("never takes a line another chunk holds", () => {
    const diffs = makePatch([
      "+  const x = foo(",
      "+    a,",
      "+    b,",
      "+  );",
    ]);
    const chunks = [
      stubChunk([{ start: 1, end: 1 }]),
      stubChunk([{ start: 3, end: 4 }]),
    ];

    const snapped = snapChunkRanges(chunks, diffs);

    expect(snapped[0]?.addedRanges).toEqual([{ start: 1, end: 2 }]);
    expect(snapped[1]?.addedRanges).toEqual([{ start: 3, end: 4 }]);
  });

  it("stops at a context line", () => {
    const diffs = [
      {
        file: "src/a.ts",
        patch: [
          "diff --git a/src/a.ts b/src/a.ts",
          "@@ -1,2 +1,3 @@",
          "+  const x = foo(",
          "+    a,",
          "   b,",
          "@@ -10,1 +11,2 @@",
          "+  const y = bar(",
          "@@ -20,1 +22,2 @@",
          "+    c,",
        ].join("\n"),
      },
    ];
    const chunks = [
      stubChunk([{ start: 1, end: 1 }]),
      stubChunk([{ start: 11, end: 11 }]),
    ];

    const snapped = snapChunkRanges(chunks, diffs);

    expect(snapped[0]?.addedRanges).toEqual([{ start: 1, end: 2 }]);
    expect(snapped[1]?.addedRanges).toEqual([{ start: 11, end: 11 }]);
  });

  it("leaves an inverted range as the model produced it", () => {
    const diffs = makePatch(["+  a(", "+    b,", "+    c,", "+  );"]);

    const [snapped] = snapChunkRanges(
      [stubChunk([{ start: 4, end: 1 }])],
      diffs,
    );

    expect(snapped?.addedRanges).toEqual([{ start: 4, end: 1 }]);
  });

  it("lets an inverted range block nothing for its neighbours", () => {
    const diffs = makePatch(["+  a(", "+    b,", "+    c,", "+  );"]);
    const chunks = [
      stubChunk([{ start: 4, end: 1 }]),
      stubChunk([{ start: 1, end: 1 }]),
    ];

    const snapped = snapChunkRanges(chunks, diffs);

    expect(snapped[1]?.addedRanges).toEqual([{ start: 1, end: 4 }]);
  });

  it("snaps the removed side on old line numbers", () => {
    const diffs = makePatch(
      ["-  const x = foo(", "-    a,", "-  );", "-  bar();"],
      "@@ -1,4 +1,0 @@",
    );

    const [snapped] = snapChunkRanges(
      [stubChunk([], [{ start: 1, end: 1 }])],
      diffs,
    );

    expect(snapped?.removedRanges).toEqual([{ start: 1, end: 3 }]);
  });

  it("treats a blank line as part of the tail and a tab as four columns", () => {
    const diffs = makePatch([
      "+\tconst x = foo(",
      "+",
      "+\t\ta,",
      "+\t);",
      "+\tnext();",
    ]);

    const [snapped] = snapChunkRanges(
      [stubChunk([{ start: 1, end: 1 }])],
      diffs,
    );

    expect(snapped?.addedRanges).toEqual([{ start: 1, end: 4 }]);
  });

  it("keeps a chunk of another file untouched", () => {
    const diffs = makePatch(["+  const x = foo(", "+    a,"]);

    const [snapped] = snapChunkRanges(
      [stubChunk([{ start: 1, end: 1 }], [], "src/b.ts")],
      diffs,
    );

    expect(snapped?.addedRanges).toEqual([{ start: 1, end: 1 }]);
  });
});
