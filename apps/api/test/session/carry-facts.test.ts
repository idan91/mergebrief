// The Brief slice the carry-over evaluation reads. The integration suites
// cover the route's 500; this pins what counts as unreadable and how a
// chunk's flags get their region, because empty facts here read as "every
// flag stopped firing" and would drop the reviewer's work silently.
import { describe, expect, it } from "vitest";
import {
  deriveChunkRegion,
  readCarryFacts,
  UnreadableBriefError,
} from "../../src/routes/repos/pr/session/carry-facts";

const BODY = {
  changeGroups: [{ id: "group-a" }, { id: "group-b" }],
  chunks: [
    {
      file: "src/app.ts",
      addedRanges: [{ start: 10, end: 20 }],
      removedRanges: [{ start: 4, end: 6 }],
      riskSurface: ["auth", "io"],
    },
  ],
};

describe("readCarryFacts", () => {
  it("reads group ids and one flag per risk-surface attribute", () => {
    expect(readCarryFacts(JSON.stringify(BODY))).toEqual({
      groupIds: ["group-a", "group-b"],
      flags: [
        {
          filePath: "src/app.ts",
          attribute: "auth",
          regionStart: 4,
          regionEnd: 20,
        },
        {
          filePath: "src/app.ts",
          attribute: "io",
          regionStart: 4,
          regionEnd: 20,
        },
      ],
    });
  });

  it("keeps unknown keys out rather than failing on them", () => {
    const facts = readCarryFacts(
      JSON.stringify({ ...BODY, narrative: "…", version: 3 }),
    );
    expect(facts.groupIds).toEqual(["group-a", "group-b"]);
  });

  it("treats a chunk with no ranges as a span, not a parse failure", () => {
    const facts = readCarryFacts(
      JSON.stringify({
        changeGroups: [],
        chunks: [{ file: "src/new.ts", riskSurface: ["auth"] }],
      }),
    );
    expect(facts.flags).toEqual([
      {
        filePath: "src/new.ts",
        attribute: "auth",
        regionStart: 1,
        regionEnd: 1,
      },
    ]);
  });

  it("throws on a body that is not JSON at all", () => {
    expect(() => readCarryFacts("not json")).toThrow(UnreadableBriefError);
  });

  it.each(["changeGroups", "chunks"])(
    "throws rather than read zero facts when %s is missing",
    (key) => {
      const partial: Record<string, unknown> = { ...BODY };
      delete partial[key];
      expect(() => readCarryFacts(JSON.stringify(partial))).toThrow(
        UnreadableBriefError,
      );
    },
  );
});

describe("deriveChunkRegion", () => {
  it("spans both sides of the diff", () => {
    expect(
      deriveChunkRegion({
        addedRanges: [
          { start: 30, end: 33 },
          { start: 12, end: 14 },
        ],
        removedRanges: [{ start: 8, end: 9 }],
      }),
    ).toEqual({ start: 8, end: 33 });
  });

  it("answers a unit span for a chunk with no ranges", () => {
    expect(deriveChunkRegion({ addedRanges: [], removedRanges: [] })).toEqual({
      start: 1,
      end: 1,
    });
  });
});
