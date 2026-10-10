import { describe, expect, it } from "vitest";

import { appI18n } from "../../../../../../i18n/I18nProvider";
import { briefFixture } from "@web/features/brief/test-utils";
import type { BriefChunk } from "../../../../model/types";
import {
  deriveChunkMarks,
  deriveMarkName,
  findMarkIndex,
  getChunkStartLine,
  moveRovingIndex,
} from "./utils";

function makeChunk(overrides: Partial<BriefChunk>): BriefChunk {
  const base = briefFixture.chunks[0];
  if (base === undefined) {
    throw new Error("fixture has no chunks");
  }
  return { ...base, ...overrides };
}

describe("getChunkStartLine", () => {
  it("reads the first added range", () => {
    const chunk = makeChunk({
      addedRanges: [{ start: 40, end: 42 }],
      removedRanges: [{ start: 7, end: 7 }],
    });
    expect(getChunkStartLine(chunk)).toBe(40);
  });

  it("falls back to the first removed range", () => {
    const chunk = makeChunk({
      addedRanges: [],
      removedRanges: [{ start: 7, end: 9 }],
    });
    expect(getChunkStartLine(chunk)).toBe(7);
  });

  it("has no line without ranges", () => {
    const chunk = makeChunk({ addedRanges: [], removedRanges: [] });
    expect(getChunkStartLine(chunk)).toBeUndefined();
  });
});

describe("deriveChunkMarks", () => {
  it("keeps reading order, the basename and a 1-based position", () => {
    const marks = deriveChunkMarks(briefFixture.chunks);
    expect(marks).toEqual([
      { id: "chunk-a", basename: "leak.ts", line: 10, position: 1 },
      { id: "chunk-b", basename: "leak.test.ts", line: 1, position: 2 },
    ]);
  });
});

describe("moveRovingIndex", () => {
  it("steps with Left and Right and clamps at both ends", () => {
    expect(moveRovingIndex("ArrowRight", 1, 3)).toBe(2);
    expect(moveRovingIndex("ArrowRight", 2, 3)).toBe(2);
    expect(moveRovingIndex("ArrowLeft", 1, 3)).toBe(0);
    expect(moveRovingIndex("ArrowLeft", 0, 3)).toBe(0);
  });

  it("jumps to the ends with Home and End", () => {
    expect(moveRovingIndex("Home", 2, 3)).toBe(0);
    expect(moveRovingIndex("End", 0, 3)).toBe(2);
  });

  it("ignores any other key", () => {
    expect(moveRovingIndex("ArrowDown", 1, 3)).toBeUndefined();
    expect(moveRovingIndex("Enter", 1, 3)).toBeUndefined();
  });
});

describe("deriveMarkName", () => {
  it("names the file, line and place", () => {
    const mark = { id: "c", basename: "params.ts", line: 40, position: 2 };
    expect(deriveMarkName(appI18n.t, mark, 5)).toBe(
      "params.ts line 40, chunk 2 of 5",
    );
  });

  it("drops the line when the chunk has none", () => {
    const mark = {
      id: "c",
      basename: "logo.png",
      line: undefined,
      position: 1,
    };
    expect(deriveMarkName(appI18n.t, mark, 1)).toBe("logo.png, chunk 1 of 1");
  });
});

describe("findMarkIndex", () => {
  const marks = deriveChunkMarks(briefFixture.chunks);

  it("finds a mark by its chunk id", () => {
    expect(findMarkIndex(marks, "chunk-b")).toBe(1);
  });

  it("has no index for a missing or unset id", () => {
    expect(findMarkIndex(marks, "gone")).toBeUndefined();
    expect(findMarkIndex(marks, undefined)).toBeUndefined();
  });
});
