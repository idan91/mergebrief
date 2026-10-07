import { describe, expect, it } from "vitest";
import { ArtifactIssueCodes, readBriefSessionFacts } from "../../src/artifact";
import { makeTwoGroupBrief } from "../helpers";

const BODY = {
  changeGroups: [{ id: "group-a" }, { id: "group-b" }],
  chunks: [
    {
      id: "c1",
      file: "src/app.ts",
      addedRanges: [{ start: 10, end: 20 }],
      removedRanges: [{ start: 4, end: 6 }],
      riskSurface: ["auth", "io"],
    },
    {
      id: "c2",
      file: "src/app.ts",
      addedRanges: [{ start: 50, end: 52 }],
      removedRanges: [],
      riskSurface: [],
    },
  ],
};

function readFactsOrThrow(body: unknown) {
  const read = readBriefSessionFacts(JSON.stringify(body));
  if (!read.ok) {
    throw new Error(`expected an ok read: ${JSON.stringify(read.error)}`);
  }
  return read.value;
}

describe("readBriefSessionFacts", () => {
  it("reads chunk ids, group ids, deduped paths and one flag per attribute", () => {
    expect(readFactsOrThrow(BODY)).toEqual({
      chunkIds: ["c1", "c2"],
      groupIds: ["group-a", "group-b"],
      filePaths: ["src/app.ts"],
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

  it("reads a whole stored Brief", () => {
    const facts = readFactsOrThrow(makeTwoGroupBrief());

    expect(facts.chunkIds).toEqual(["c1", "c2"]);
    expect(facts.groupIds).toEqual(["g1", "g2"]);
    expect(facts.filePaths).toEqual(["a.ts", "b.ts"]);
  });

  it("keeps a risk attribute outside the built-in vocabulary", () => {
    const body = structuredClone(BODY);
    body.chunks[0]?.riskSurface.splice(0, 2, "touches-billing");

    expect(readFactsOrThrow(body).flags).toEqual([
      {
        filePath: "src/app.ts",
        attribute: "touches-billing",
        regionStart: 4,
        regionEnd: 20,
      },
    ]);
  });

  it("ignores unknown keys rather than failing on them", () => {
    const facts = readFactsOrThrow({ ...BODY, narrative: "x", version: 3 });

    expect(facts.groupIds).toEqual(["group-a", "group-b"]);
  });

  it("spans every range on both sides of the diff", () => {
    const facts = readFactsOrThrow({
      changeGroups: [],
      chunks: [
        {
          id: "c1",
          file: "src/app.ts",
          addedRanges: [
            { start: 30, end: 33 },
            { start: 12, end: 14 },
          ],
          removedRanges: [{ start: 8, end: 9 }],
          riskSurface: ["auth"],
        },
      ],
    });

    expect(facts.flags).toEqual([
      expect.objectContaining({ regionStart: 8, regionEnd: 33 }),
    ]);
  });

  it("gives a chunk with no ranges a unit span, not a parse failure", () => {
    const facts = readFactsOrThrow({
      changeGroups: [],
      chunks: [{ id: "c1", file: "src/new.ts", riskSurface: ["auth"] }],
    });

    expect(facts.flags).toEqual([
      {
        filePath: "src/new.ts",
        attribute: "auth",
        regionStart: 1,
        regionEnd: 1,
      },
    ]);
  });

  it("fails with not-json on a body that is not JSON", () => {
    expect(readBriefSessionFacts("not json")).toEqual({
      ok: false,
      error: [expect.objectContaining({ code: ArtifactIssueCodes.NOT_JSON })],
    });
  });

  it.each(["changeGroups", "chunks"])(
    "fails rather than read zero facts when %s is missing",
    (key) => {
      const partial: Record<string, unknown> = { ...BODY };
      delete partial[key];

      const read = readBriefSessionFacts(JSON.stringify(partial));

      expect(read.ok).toBe(false);
    },
  );

  it("fails on a chunk with no id", () => {
    const body = structuredClone(BODY);
    const { id: _id, ...anonymous } = body.chunks[0] ?? {};

    const read = readBriefSessionFacts(
      JSON.stringify({ ...body, chunks: [anonymous] }),
    );

    expect(read.ok).toBe(false);
  });
});
