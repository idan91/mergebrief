import { describe, expect, it } from "vitest";

import { Concerns, Roles } from "brief-core/types";
import type { BriefChunk } from "../types";
import { GroupViewKinds } from "../utils/remainder";
import {
  buildChunkLayoutCounts,
  readCardCounts,
  readReservedCounts,
  readStoredCounts,
} from "./useChunkLayout";

const COUNTS = {
  rows: 4,
  hunkRows: 1,
  expandRows: 0,
  splitRows: 3,
  lineWidths: { counts: [4, 0, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
  rowRuns: "h1c3",
};

const FILE_COUNTS = { ...COUNTS, rows: 9, splitRows: 8, rowRuns: "h1c8" };

/** One added line: its hunk header and two rows of context on each side. */
const RANGE_COUNTS = {
  rows: 6,
  hunkRows: 1,
  expandRows: 0,
  splitRows: 6,
  lineWidths: { counts: [5, 0, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
};

function makeChunk(id: string, file: string, changeGroupId = "g1"): BriefChunk {
  return {
    id,
    changeGroupId,
    file,
    concern: Concerns.IMPLEMENTATION,
    role: Roles.CORE,
    loc: { added: 1, deleted: 0 },
    addedRanges: [{ start: 1, end: 1 }],
    removedRanges: [],
    riskSurface: [],
  };
}

const ATTRIBUTED = makeChunk("c1", "src/a.ts");
const REMAINDER = makeChunk(
  "u-1a2b3c4d",
  "src/orphan.ts",
  GroupViewKinds.UNATTRIBUTED_REMAINDER,
);

const STORED = buildChunkLayoutCounts({
  chunks: { c1: COUNTS },
  files: { "src/orphan.ts": FILE_COUNTS },
});

describe("buildChunkLayoutCounts", () => {
  it("indexes chunks by id and remainder files by path", () => {
    expect(STORED?.chunks.get("c1")).toEqual(COUNTS);
    expect(STORED?.files.get("src/orphan.ts")).toEqual(FILE_COUNTS);
    expect(STORED?.chunks.has("c2")).toBe(false);
  });

  it("answers undefined for a brief without a sidecar", () => {
    expect(buildChunkLayoutCounts(undefined)).toBeUndefined();
  });
});

describe("readStoredCounts", () => {
  it("reads an attributed chunk by its id", () => {
    expect(readStoredCounts(STORED, ATTRIBUTED)).toEqual(COUNTS);
  });

  it("reads a remainder card by its file", () => {
    expect(readStoredCounts(STORED, REMAINDER)).toEqual(FILE_COUNTS);
  });

  it("never reads an attributed chunk from the file section", () => {
    const sameFile = makeChunk("c9", "src/orphan.ts");

    expect(readStoredCounts(STORED, sameFile)).toBeUndefined();
  });
});

describe("readReservedCounts", () => {
  it("reserves from the stored counts only while the code is pending", () => {
    expect(
      readReservedCounts({ counts: STORED, codePending: true }, ATTRIBUTED),
    ).toEqual(COUNTS);
    expect(
      readReservedCounts({ counts: STORED, codePending: true }, REMAINDER),
    ).toEqual(FILE_COUNTS);
    expect(
      readReservedCounts({ counts: STORED, codePending: false }, ATTRIBUTED),
    ).toBeUndefined();
  });

  it("reserves nothing without a provider", () => {
    expect(readReservedCounts(undefined, ATTRIBUTED)).toBeUndefined();
  });

  it("reserves a pending card without stored counts from its ranges", () => {
    const unknown = makeChunk("c9", "src/z.ts");

    expect(
      readReservedCounts({ counts: undefined, codePending: true }, ATTRIBUTED),
    ).toEqual(RANGE_COUNTS);
    expect(
      readReservedCounts({ counts: STORED, codePending: true }, unknown),
    ).toEqual(RANGE_COUNTS);
  });

  it("pairs a modification's sides into one hunk and split rows", () => {
    const modified: BriefChunk = {
      ...ATTRIBUTED,
      loc: { added: 3, deleted: 2 },
      addedRanges: [{ start: 4, end: 6 }],
      removedRanges: [{ start: 4, end: 5 }],
    };

    expect(
      readReservedCounts({ counts: undefined, codePending: true }, modified),
    ).toEqual({
      rows: 10,
      hunkRows: 1,
      expandRows: 0,
      splitRows: 8,
      lineWidths: {
        counts: [9, 0, 0, 0, 0, 0, 0, 0, 0],
        overflowColumns: 0,
      },
    });
  });

  it("reserves an empty slice for a card with no changed lines", () => {
    const rename: BriefChunk = {
      ...ATTRIBUTED,
      loc: { added: 0, deleted: 0 },
      addedRanges: [],
    };

    expect(
      readReservedCounts({ counts: undefined, codePending: true }, rename),
    ).toEqual({
      rows: 0,
      hunkRows: 0,
      expandRows: 0,
      splitRows: 0,
      lineWidths: {
        counts: [0, 0, 0, 0, 0, 0, 0, 0, 0],
        overflowColumns: 0,
      },
    });
  });
});

describe("readCardCounts", () => {
  it("reads the stored counts before and after the code lands", () => {
    expect(
      readCardCounts({ counts: STORED, codePending: true }, ATTRIBUTED),
    ).toEqual(COUNTS);
    expect(
      readCardCounts({ counts: STORED, codePending: false }, ATTRIBUTED),
    ).toEqual(COUNTS);
  });

  it("sizes a pending card without stored counts from its ranges", () => {
    expect(
      readCardCounts({ counts: undefined, codePending: true }, ATTRIBUTED),
    ).toEqual(RANGE_COUNTS);
  });

  it("leaves a landed card without stored counts to its rows", () => {
    expect(
      readCardCounts({ counts: undefined, codePending: false }, ATTRIBUTED),
    ).toBeUndefined();
    expect(readCardCounts(undefined, ATTRIBUTED)).toBeUndefined();
  });
});
