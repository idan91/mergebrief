import { describe, expect, it } from "vitest";

import { type DiffLine, DiffRowOrigins } from "@web/utils/diffTokens/types";
import { appI18n } from "../../../../../i18n/I18nProvider";
import {
  type Brief,
  type BriefChunk,
  Concerns,
  type RevisionNarrativeChunk,
  Roles,
} from "../../../types";
import { collectNarrativeRows, countLines, shapeGuestRows } from "./utils";

function stubChunk(id: string, file: string, diff: DiffLine[]): BriefChunk {
  return {
    id,
    changeGroupId: "g1",
    file,
    concern: Concerns.IMPLEMENTATION,
    role: Roles.CORE,
    loc: { added: 0, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff,
  };
}

const BRIEF = {
  chunks: [
    stubChunk("c1", "src/a.ts", [
      { kind: "hunk", content: "@@ -9,2 +9,4 @@" },
      { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
      { kind: "add", content: "b", newLine: 10 },
      { kind: "del", content: "gone", oldLine: 10 },
      { kind: "add", content: "c", newLine: 11 },
    ]),
    stubChunk("c2", "src/a.ts", [{ kind: "add", content: "z", newLine: 40 }]),
    stubChunk("c0", "src/a.ts", [
      { kind: "add", content: "early", newLine: 2 },
    ]),
    stubChunk("other", "src/b.ts", [
      { kind: "add", content: "q", newLine: 10 },
    ]),
  ],
} as unknown as Brief;

const NARRATIVE_CHUNK: RevisionNarrativeChunk = {
  id: "rc1",
  briefChangeGroupId: "g1",
  file: "src/a.ts",
  addedRanges: [
    { start: 10, end: 11 },
    { start: 40, end: 40 },
    { start: 2, end: 2 },
  ],
  removedRanges: [],
  summary: "s",
};

describe("collectNarrativeRows", () => {
  it("keeps the owner row each guest row came from, in line order", () => {
    const { rows, origins } = collectNarrativeRows(
      BRIEF,
      NARRATIVE_CHUNK,
      appI18n.t,
    );

    expect(rows.map((row) => row.content)).toEqual([
      "early",
      "7 lines not shown",
      "b",
      "c",
      "28 lines not shown",
      "z",
    ]);
    expect(rows.every((row) => row.origin === DiffRowOrigins.GUEST)).toBe(true);
    expect(origins).toEqual([
      { chunkId: "c0", index: 0 },
      undefined,
      { chunkId: "c1", index: 2 },
      { chunkId: "c1", index: 4 },
      undefined,
      { chunkId: "c2", index: 0 },
    ]);
  });

  it("skips deleted rows and rows of another file", () => {
    const { rows } = collectNarrativeRows(BRIEF, NARRATIVE_CHUNK, appI18n.t);

    expect(rows.some((row) => row.kind === "del")).toBe(false);
    expect(rows.some((row) => row.content === "q")).toBe(false);
  });
});

describe("collectNarrativeRows over neighbouring chunks", () => {
  /** Each slice carries the other's changed lines as context, as sliceChunkDiff does. */
  const SHARED: DiffLine[] = [
    { kind: "add", content: "ten", newLine: 10 },
    { kind: "add", content: "eleven", newLine: 11 },
    { kind: "add", content: "twelve", newLine: 12 },
    { kind: "add", content: "thirteen", newLine: 13 },
  ];
  const first: BriefChunk = {
    ...stubChunk("a", "src/n.ts", SHARED),
    addedRanges: [{ start: 10, end: 11 }],
  };
  const second: BriefChunk = {
    ...stubChunk("b", "src/n.ts", SHARED),
    addedRanges: [{ start: 12, end: 13 }],
  };
  const brief = { chunks: [first, second] } as unknown as Brief;
  const narrativeChunk: RevisionNarrativeChunk = {
    ...NARRATIVE_CHUNK,
    file: "src/n.ts",
    addedRanges: [{ start: 10, end: 13 }],
  };

  it("shows each line once, from the chunk whose ranges hold it", () => {
    const { rows, origins } = collectNarrativeRows(
      brief,
      narrativeChunk,
      appI18n.t,
    );

    expect(rows.map((row) => row.newLine)).toEqual([10, 11, 12, 13]);
    expect(origins.map((origin) => origin?.chunkId)).toEqual([
      "a",
      "a",
      "b",
      "b",
    ]);
  });
});

describe("shapeGuestRows", () => {
  it("drops full-width rows and notes a gap on either side", () => {
    const rows: DiffLine[] = [
      { kind: "hunk", content: "@@" },
      { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
      { kind: "del", content: "gone", oldLine: 10 },
      { kind: "add", content: "b", newLine: 10 },
      { kind: "hunk", content: "@@" },
      { kind: "ctx", content: "m", oldLine: 30, newLine: 39 },
      { kind: "add", content: "c", newLine: 40 },
    ];

    expect(
      shapeGuestRows(rows, appI18n.t).map((row) => [row.kind, row.content]),
    ).toEqual([
      ["ctx", "a"],
      ["del", "gone"],
      ["add", "b"],
      ["note", "28 lines not shown"],
      ["ctx", "m"],
      ["add", "c"],
    ]);
  });
});

describe("countLines", () => {
  it("sums inclusive ranges", () => {
    expect(
      countLines([
        { start: 3, end: 5 },
        { start: 9, end: 9 },
      ]),
    ).toBe(4);
  });
});
