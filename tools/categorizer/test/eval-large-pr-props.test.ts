import { describe, expect, it } from "vitest";
import { OutlineForms, type Brief, type Chunk } from "brief-core/types";
import {
  buildLockfileShortening,
  buildOutlineFormRead,
  buildPartitionProperties,
} from "../eval/cases/large-pr-props";
import type { EvalProperty } from "../eval/properties";
import { makeBrief } from "./eval-fixtures";

const LOCKFILE = "pnpm-lock.yaml";
const REMOVED = { start: 4, end: 5 };
/** The case's diff: `src/a.ts` adds lines 1-3, `src/b.ts` removes lines 4-5. */
const CHANGED_FILES = [
  { file: "src/a.ts", addedRanges: [{ start: 1, end: 3 }], removedRanges: [] },
  { file: "src/b.ts", addedRanges: [], removedRanges: [REMOVED] },
];

function makeChunk(overrides: Partial<Chunk>): Chunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "core",
    addedRanges: [{ start: 1, end: 3 }],
    removedRanges: [],
    riskSurface: [],
    loc: { added: 3, deleted: 0 },
    ...overrides,
  };
}

/** A brief whose one chunk claims lines 1-3 of `src/a.ts`, matching its totals. */
function makeCoveredBrief(overrides: Partial<Brief> = {}): Brief {
  return makeBrief({
    chunks: [makeChunk({})],
    unattributed: [],
    diffTotals: { added: 3, deleted: 0 },
    ...overrides,
  });
}

function findPartitionProperty(id: string): EvalProperty {
  const property = buildPartitionProperties().find((entry) => entry.id === id);
  if (property === undefined) {
    throw new Error(`no partition property ${id}`);
  }
  return property;
}

describe("buildPartitionProperties", () => {
  it("passes a brief whose groups partition its chunks", () => {
    const brief = makeCoveredBrief();
    const results = buildPartitionProperties().map((property) =>
      property.check(brief, CHANGED_FILES.slice(0, 1)),
    );

    expect(results).toEqual([true, true, true, true]);
  });

  it("fails duplicate group ids", () => {
    const base = makeCoveredBrief();
    const group = base.changeGroups[0]!;
    const brief = { ...base, changeGroups: [group, group] };

    expect(findPartitionProperty("group-ids-unique").check(brief)).toBe(false);
  });

  it("fails a group that owns no chunk", () => {
    const brief = makeCoveredBrief({ chunks: [] });

    expect(findPartitionProperty("no-empty-groups").check(brief)).toBe(false);
  });

  it("fails a chunk naming a group the brief does not carry", () => {
    const brief = makeCoveredBrief({
      chunks: [makeChunk({ changeGroupId: "g9" })],
    });

    expect(findPartitionProperty("no-unknown-groups").check(brief)).toBe(false);
  });

  it("passes a brief whose chunks and remainder claim the diff's lines", () => {
    const property = findPartitionProperty(
      "every-line-attributed-or-remainder",
    );
    const remainder = {
      file: "src/b.ts",
      addedRanges: [],
      removedRanges: [{ start: 4, end: 5 }],
    };
    const brief = makeCoveredBrief({
      unattributed: [remainder],
      diffTotals: { added: 3, deleted: 2 },
    });

    expect(property.check(brief, CHANGED_FILES)).toBe(true);
  });

  it.each([
    ["a line the diff never changed", { start: 2, end: 4 }, "src/a.ts"],
    ["a file the diff never touches", { start: 1, end: 3 }, "src/c.ts"],
    ["a changed line left out", { start: 1, end: 2 }, "src/a.ts"],
  ])("fails coverage on a claim of %s", (_label, range, file) => {
    const property = findPartitionProperty(
      "every-line-attributed-or-remainder",
    );
    const brief = makeCoveredBrief({
      chunks: [makeChunk({ file, addedRanges: [range] })],
      unattributed: [
        { file: "src/b.ts", addedRanges: [], removedRanges: [REMOVED] },
      ],
      diffTotals: { added: 3, deleted: 2 },
    });

    expect(property.check(brief, CHANGED_FILES)).toBe(false);
  });

  it("passes a chunk range spilling past the changed lines", () => {
    const property = findPartitionProperty(
      "every-line-attributed-or-remainder",
    );
    const brief = makeCoveredBrief({
      chunks: [makeChunk({ addedRanges: [{ start: 1, end: 9 }] })],
    });

    expect(property.check(brief, CHANGED_FILES.slice(0, 1))).toBe(true);
  });

  it("fails coverage on a remainder line the diff never changed", () => {
    const property = findPartitionProperty(
      "every-line-attributed-or-remainder",
    );
    const brief = makeCoveredBrief({
      unattributed: [
        {
          file: "src/b.ts",
          addedRanges: [],
          removedRanges: [{ start: 4, end: 6 }],
        },
      ],
      diffTotals: { added: 3, deleted: 2 },
    });

    expect(property.check(brief, CHANGED_FILES)).toBe(false);
  });

  it("fails coverage on a remainder line a chunk also claims", () => {
    const property = findPartitionProperty(
      "every-line-attributed-or-remainder",
    );
    const brief = makeCoveredBrief({
      unattributed: [
        {
          file: "src/a.ts",
          addedRanges: [{ start: 3, end: 3 }],
          removedRanges: [],
        },
        { file: "src/b.ts", addedRanges: [], removedRanges: [REMOVED] },
      ],
      diffTotals: { added: 3, deleted: 2 },
    });

    expect(property.check(brief, CHANGED_FILES)).toBe(false);
  });

  it("fails coverage without the case's changed lines", () => {
    const property = findPartitionProperty(
      "every-line-attributed-or-remainder",
    );

    expect(property.check(makeCoveredBrief())).toBe(false);
  });

  it("fails coverage on a brief without diff totals", () => {
    const property = findPartitionProperty(
      "every-line-attributed-or-remainder",
    );
    const { diffTotals: _dropped, ...brief } = makeCoveredBrief();

    expect(property.check(brief, CHANGED_FILES)).toBe(false);
  });
});

describe("buildLockfileShortening", () => {
  const property = buildLockfileShortening([LOCKFILE]);

  it("passes a lockfile read as a shortened generated chunk", () => {
    const chunk = makeChunk({
      file: LOCKFILE,
      concern: "generated",
      role: "supporting",
      readAs: "counts-only",
    });

    expect(property.check(makeBrief({ chunks: [chunk] }))).toBe(true);
  });

  it("fails a lockfile read in full or missing from the chunks", () => {
    const fullRead = makeChunk({ file: LOCKFILE, concern: "generated" });

    expect(property.check(makeBrief({ chunks: [fullRead] }))).toBe(false);
    expect(property.check(makeBrief({ chunks: [] }))).toBe(false);
  });
});

describe("buildOutlineFormRead", () => {
  const property = buildOutlineFormRead();

  it("passes a brief grouped over an outline form", () => {
    const brief = makeBrief({ outlineForm: OutlineForms.LINES_6 });

    expect(property.check(brief)).toBe(true);
  });

  it("fails a brief grouped over the full diff or never grouped", () => {
    const fullRead = makeBrief({ outlineForm: OutlineForms.FULL });

    expect(property.check(fullRead)).toBe(false);
    expect(property.check(makeBrief({}))).toBe(false);
  });
});
