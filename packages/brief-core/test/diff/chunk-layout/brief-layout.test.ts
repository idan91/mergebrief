import { describe, expect, it } from "vitest";
import {
  countBriefChunkLayouts,
  countChunkLayout,
  parseUnifiedDiffPatch,
} from "../../../src/diff/chunk-layout";
import { PATCH } from "./helpers";

const SECOND_FILE = [
  "diff --git a/src/other.ts b/src/other.ts",
  "--- a/src/other.ts",
  "+++ b/src/other.ts",
  "@@ -1,2 +1,3 @@",
  " keep",
  "+new line",
  " keep2",
].join("\n");

const TWO_FILES = `${PATCH}\n${SECOND_FILE}\n`;

describe("countBriefChunkLayouts", () => {
  it("counts every chunk against its own file's rows", () => {
    const body = countBriefChunkLayouts(TWO_FILES, {
      chunks: [
        {
          id: "app-head",
          file: "src/app.ts",
          addedRanges: [{ start: 2, end: 3 }],
          removedRanges: [{ start: 2, end: 2 }],
        },
        {
          id: "app-tail",
          file: "src/app.ts",
          addedRanges: [{ start: 22, end: 22 }],
          removedRanges: [],
        },
        {
          id: "other",
          file: "src/other.ts",
          addedRanges: [{ start: 2, end: 2 }],
          removedRanges: [],
        },
      ],
      unattributed: [],
    });

    const appRows = parseUnifiedDiffPatch(PATCH);
    expect(Object.keys(body.chunks)).toEqual(["app-head", "app-tail", "other"]);
    expect(body.chunks["app-head"]).toEqual(
      countChunkLayout(appRows, {
        addedRanges: [{ start: 2, end: 3 }],
        removedRanges: [{ start: 2, end: 2 }],
      }),
    );
    expect(body.chunks["other"]?.rows).toBe(4);
    expect(body.chunks["other"]?.hunkRows).toBe(1);
  });

  it("leaves out a chunk whose file the diff does not carry", () => {
    const body = countBriefChunkLayouts(PATCH, {
      chunks: [
        {
          id: "missing",
          file: "src/not-in-diff.ts",
          addedRanges: [{ start: 1, end: 1 }],
          removedRanges: [],
        },
      ],
      unattributed: [
        {
          file: "src/not-in-diff.ts",
          addedRanges: [{ start: 2, end: 2 }],
          removedRanges: [],
        },
      ],
    });

    expect(body).toEqual({ chunks: {}, files: {} });
  });

  it("answers no chunks for an empty diff", () => {
    const body = countBriefChunkLayouts("", {
      chunks: [
        {
          id: "c1",
          file: "src/app.ts",
          addedRanges: [{ start: 2, end: 3 }],
          removedRanges: [],
        },
      ],
      unattributed: [],
    });

    expect(body).toEqual({ chunks: {}, files: {} });
  });

  it("counts each unattributed file by its path", () => {
    const tailRanges = {
      addedRanges: [{ start: 22, end: 22 }],
      removedRanges: [],
    };
    const body = countBriefChunkLayouts(TWO_FILES, {
      chunks: [
        {
          id: "app-head",
          file: "src/app.ts",
          addedRanges: [{ start: 2, end: 3 }],
          removedRanges: [{ start: 2, end: 2 }],
        },
      ],
      unattributed: [
        { file: "src/app.ts", ...tailRanges },
        {
          file: "src/other.ts",
          addedRanges: [{ start: 2, end: 2 }],
          removedRanges: [],
        },
      ],
    });

    expect(Object.keys(body.files)).toEqual(["src/app.ts", "src/other.ts"]);
    expect(body.files["src/app.ts"]).toEqual(
      countChunkLayout(parseUnifiedDiffPatch(PATCH), tailRanges),
    );
    expect(body.files["src/other.ts"]?.rows).toBe(4);
    expect(body.chunks["src/app.ts"]).toBeUndefined();
  });
});
