import { describe, expect, it } from "vitest";
import { RepoFileKinds } from "github";
import { classifyRepoFile, sliceFileRange, splitFileLines } from "./file-range";

function makeFileContent(lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_, index) => `line${index + 1}`,
  ).join("\n");
}

describe("splitFileLines", () => {
  it("counts a trailing newline as a terminator", () => {
    expect(splitFileLines("a\nb\n")).toEqual(["a", "b"]);
  });

  it("counts a missing trailing newline the same way", () => {
    expect(splitFileLines("a\nb")).toEqual(["a", "b"]);
  });

  it("reads an empty file as no lines", () => {
    expect(splitFileLines("")).toEqual([]);
  });

  it("drops the carriage return of a CRLF file", () => {
    expect(splitFileLines("a\r\nb\r\n")).toEqual(["a", "b"]);
  });
});

const REQUEST = { path: "src/app.ts", ref: "abc123", from: 2, to: 4 };

function makeLines(lineCount: number): string[] {
  return splitFileLines(makeFileContent(lineCount));
}

describe("sliceFileRange", () => {
  it("slices a 1-based inclusive window", () => {
    const view = sliceFileRange(makeLines(10), REQUEST);
    expect(view.lines).toEqual(["line2", "line3", "line4"]);
    expect(view.totalLines).toBe(10);
    expect(view).toMatchObject({ path: "src/app.ts", ref: "abc123", to: 4 });
  });

  it("clamps the end of the window to the file", () => {
    const view = sliceFileRange(makeLines(3), { ...REQUEST, to: 400 });
    expect(view.lines).toEqual(["line2", "line3"]);
    expect(view.to).toBe(3);
  });

  it("reports an empty window past the end as from = totalLines + 1", () => {
    const view = sliceFileRange(makeLines(1), { ...REQUEST, from: 9, to: 12 });
    expect(view.lines).toEqual([]);
    expect(view).toMatchObject({ from: 2, to: 1, totalLines: 1 });
  });

  it("keeps lines.length equal to to - from + 1 at every clamp", () => {
    const windows = [
      { from: 1, to: 3 },
      { from: 2, to: 400 },
      { from: 9, to: 12 },
    ];
    for (const window of windows) {
      const view = sliceFileRange(makeLines(3), { ...REQUEST, ...window });
      expect(view.lines).toHaveLength(view.to - view.from + 1);
    }
  });
});

describe("classifyRepoFile", () => {
  it("passes text through", () => {
    expect(
      classifyRepoFile({
        kind: RepoFileKinds.FILE,
        content: "a\nb",
        blobSha: "sha",
        size: 3,
      }),
    ).toBeUndefined();
  });

  it("refuses a blob carrying a NUL byte", () => {
    expect(
      classifyRepoFile({
        kind: RepoFileKinds.FILE,
        content: "a\u0000b",
        blobSha: "sha",
        size: 3,
      }),
    ).toEqual({ kind: "file-not-text" });
  });

  it("reports an absent path", () => {
    expect(classifyRepoFile({ kind: RepoFileKinds.ABSENT })).toEqual({
      kind: "file-absent",
    });
  });

  it("reports a blob over the byte cap", () => {
    expect(
      classifyRepoFile({
        kind: RepoFileKinds.TOO_LARGE,
        blobSha: "sha",
        size: 9_000_000,
      }),
    ).toEqual({ kind: "file-too-large" });
  });
});
