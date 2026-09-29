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
import {
  collectNarrativeRows,
  countLines,
  resolveCardOwnerChunkId,
  shapeGuestRows,
} from "./utils";

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

describe("collectNarrativeRows with the span diff", () => {
  /** Previous head to head: the lines this revision removed sit beside their replacements. */
  const SPAN: DiffLine[] = [
    { kind: "hunk", content: "@@ -9,3 +9,4 @@" },
    { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
    { kind: "del", content: "gone-old", oldLine: 10 },
    { kind: "add", content: "b", newLine: 10 },
    { kind: "add", content: "c", newLine: 11 },
    { kind: "ctx", content: "d", oldLine: 11, newLine: 12 },
    { kind: "hunk", content: "@@ -30,2 +39,2 @@" },
    { kind: "ctx", content: "m", oldLine: 30, newLine: 39 },
    { kind: "del", content: "old-z", oldLine: 31 },
    { kind: "add", content: "z", newLine: 40 },
  ];
  const withRemoved: RevisionNarrativeChunk = {
    ...NARRATIVE_CHUNK,
    removedRanges: [
      { start: 10, end: 10 },
      { start: 31, end: 31 },
    ],
  };

  it("seats each removed line before the head line that replaced it", () => {
    const { rows, origins, removedShown } = collectNarrativeRows(
      BRIEF,
      withRemoved,
      appI18n.t,
      SPAN,
    );

    expect(rows.map((row) => row.content)).toEqual([
      "early",
      "7 lines not shown",
      "gone-old",
      "b",
      "c",
      "28 lines not shown",
      "old-z",
      "z",
    ]);
    expect(rows.filter((row) => row.kind === "del")).toHaveLength(2);
    expect(removedShown).toBe(2);
    expect(origins[2]).toBeUndefined();
    expect(origins[3]).toEqual({ chunkId: "c1", index: 2 });
  });

  it("takes removed lines from the span only, never the base diff", () => {
    const { rows, removedShown } = collectNarrativeRows(
      BRIEF,
      withRemoved,
      appI18n.t,
    );

    expect(rows.some((row) => row.kind === "del")).toBe(false);
    expect(removedShown).toBe(0);
  });

  it("seats a deletion at the start of a hunk after the hunk's head start", () => {
    const span: DiffLine[] = [
      { kind: "hunk", content: "@@ -5,1 +4,0 @@" },
      { kind: "del", content: "lonely", oldLine: 5 },
    ];
    const lonely: RevisionNarrativeChunk = {
      ...NARRATIVE_CHUNK,
      addedRanges: [
        { start: 2, end: 2 },
        { start: 10, end: 11 },
      ],
      removedRanges: [{ start: 5, end: 5 }],
    };

    const { rows } = collectNarrativeRows(BRIEF, lonely, appI18n.t, span);

    expect(rows.map((row) => row.content)).toEqual([
      "early",
      "2 lines not shown",
      "lonely",
      "5 lines not shown",
      "b",
      "c",
    ]);
  });

  it("counts the seat of a removed line among the hidden lines after it", () => {
    const span: DiffLine[] = [
      { kind: "hunk", content: "@@ -5,1 +4,0 @@" },
      { kind: "del", content: "lonely", oldLine: 5 },
      { kind: "hunk", content: "@@ -9,1 +7,0 @@" },
      { kind: "del", content: "second", oldLine: 9 },
    ];
    const twoRemoved: RevisionNarrativeChunk = {
      ...NARRATIVE_CHUNK,
      addedRanges: [{ start: 11, end: 11 }],
      removedRanges: [
        { start: 5, end: 5 },
        { start: 9, end: 9 },
      ],
    };

    const { rows } = collectNarrativeRows(BRIEF, twoRemoved, appI18n.t, span);

    expect(rows.map((row) => row.content)).toEqual([
      "lonely",
      "3 lines not shown",
      "second",
      "3 lines not shown",
      "c",
    ]);
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

describe("resolveCardOwnerChunkId", () => {
  const chunks: BriefChunk[] = [
    {
      ...stubChunk("a", "src/n.ts", []),
      addedRanges: [{ start: 10, end: 11 }],
    },
    {
      ...stubChunk("b", "src/n.ts", []),
      changeGroupId: "g2",
      addedRanges: [{ start: 12, end: 13 }],
    },
    stubChunk("other", "src/b.ts", []),
  ];

  it("names the chunk whose added range holds the card's first added line", () => {
    expect(
      resolveCardOwnerChunkId(chunks, "src/n.ts", [{ start: 12, end: 13 }]),
    ).toBe("b");
    expect(
      resolveCardOwnerChunkId(chunks, "src/n.ts", [
        { start: 12, end: 13 },
        { start: 10, end: 11 },
      ]),
    ).toBe("a");
  });

  it("falls back to the file's chunk in the card's group with nothing added", () => {
    expect(resolveCardOwnerChunkId(chunks, "src/n.ts", [], "g2")).toBe("b");
    expect(resolveCardOwnerChunkId(chunks, "src/n.ts", [])).toBe("a");
  });

  it("names nothing for a file no chunk of the brief touches", () => {
    expect(resolveCardOwnerChunkId(chunks, "src/zzz.ts", [])).toBeUndefined();
  });
});
