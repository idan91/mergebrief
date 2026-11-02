import { describe, expect, it } from "vitest";
import {
  ArtifactIssueCodes,
  checkBriefForWrite,
  checkRevisionNarrativeForWrite,
  isCompleteBrief,
  readStoredBrief,
  readStoredDelta,
  readStoredDeltaBrief,
  readStoredRevisionNarrative,
} from "../../src/artifact";
import {
  makeSkippedRevisionNarrative,
  makeUnchangedRevisionNarrative,
  makeTwoGroupBrief,
  makeValidBrief,
  makeValidDeltaBrief,
  makeValidRevisionNarrative,
} from "../helpers";

type Body = Record<string, unknown>;

const NOT_A_SECTION = { nope: true };
// zod spreads one element's issues into a single call; this many overflow it.
const HUGE_LIST_LENGTH = 300_000;

function readBody(body: unknown) {
  return readStoredBrief(JSON.stringify(body));
}

function readBodyOrThrow(body: unknown) {
  const read = readBody(body);
  if (!read.ok) {
    throw new Error(`expected an ok read: ${JSON.stringify(read.error)}`);
  }
  return read.value;
}

function makeBodyWith(overrides: Body): Body {
  return { ...makeValidBrief(), ...overrides };
}

function makeBodyWithPr(overrides: Body): Body {
  const brief = makeValidBrief();
  return { ...brief, pr: { ...brief.pr, ...overrides } };
}

function makeBodyWithChunk(overrides: Body): Body {
  const brief = makeValidBrief();
  return { ...brief, chunks: [{ ...brief.chunks[0], ...overrides }] };
}

describe("readStoredBrief", () => {
  it("reads a current body complete with no drops", () => {
    const brief = makeValidBrief();

    const read = readBodyOrThrow(brief);

    expect(read).toEqual({ brief, issues: [] });
    expect(isCompleteBrief(read.brief)).toBe(true);
  });

  it("keeps every valid optional section", () => {
    const body = makeBodyWith({
      generationWarnings: ["salvaged"],
      anchor: { state: "none" },
      anchoring: { carried: ["g1"], regenerated: [] },
      lengthViolations: [
        {
          surface: "group-title",
          field: "group g1 title",
          actual: 200,
          cap: 150,
        },
      ],
      unattributed: [],
      diffTotals: { added: 1, deleted: 0 },
      readingOrder: [{ groupId: "g1", why: "the only group" }],
    });

    expect(readBodyOrThrow(body)).toEqual({ brief: body, issues: [] });
  });

  it("fails with not-json on a body that is not JSON", () => {
    expect(readStoredBrief("{not json")).toEqual({
      ok: false,
      error: [
        {
          code: ArtifactIssueCodes.NOT_JSON,
          path: "",
          message: expect.any(String),
        },
      ],
    });
  });

  it.each([
    ["an empty string", ""],
    ["a JSON array", "[]"],
    ["a JSON null", "null"],
    ["a JSON string", '"brief"'],
  ])("fails without throwing on %s", (_label, json) => {
    expect(readStoredBrief(json).ok).toBe(false);
  });

  it("fails without throwing on a chunk with a huge invalid list", () => {
    const brief = makeValidBrief();
    const [firstChunk, ...otherChunks] = brief.chunks;
    const hugeList = Array.from({ length: HUGE_LIST_LENGTH }, () => 0);
    const body = makeBodyWith({
      chunks: [{ ...firstChunk, riskSurface: hugeList }, ...otherChunks],
    });

    expect(readBody(body).ok).toBe(false);
  });

  it("fails on an empty object with a pathed issue per core field", () => {
    const read = readBody({});

    expect(read.ok).toBe(false);
    expect(read).toMatchObject({
      error: expect.arrayContaining([
        expect.objectContaining({
          code: ArtifactIssueCodes.INVALID,
          path: "pr",
        }),
        expect.objectContaining({ path: "summary" }),
        expect.objectContaining({ path: "chunks" }),
      ]),
    });
  });

  it.each([
    ["an invalid pr core field", makeBodyWithPr({ number: "1" }), "pr.number"],
    ["an invalid summary", makeBodyWith({ summary: 7 }), "summary"],
    [
      "a malformed group",
      makeBodyWith({ changeGroups: [{ id: "g1" }] }),
      "changeGroups.0.title",
    ],
    ["a malformed chunk", makeBodyWithChunk({ file: 7 }), "chunks.0.file"],
    [
      "an invalid concernView",
      makeBodyWith({ concernView: [{ concern: "nope" }] }),
      "concernView.0.concern",
    ],
  ])("fails on %s", (_label, body, path) => {
    expect(readBody(body)).toMatchObject({
      ok: false,
      error: expect.arrayContaining([
        expect.objectContaining({ code: ArtifactIssueCodes.INVALID, path }),
      ]),
    });
  });

  it("moves a chunk with no membership at all into the remainder", () => {
    const { changeGroupId: _removed, ...chunk } = makeValidBrief().chunks[0]!;

    const read = readBodyOrThrow(makeBodyWith({ chunks: [chunk] }));

    expect(read.brief.chunks).toEqual([]);
    expect(read.brief.unattributed).toEqual([
      {
        file: chunk.file,
        addedRanges: chunk.addedRanges,
        removedRanges: chunk.removedRanges,
      },
    ]);
    expect(read.issues).toEqual([
      {
        code: ArtifactIssueCodes.UNKNOWN_CHANGE_GROUP,
        path: "chunks.0.changeGroupId",
        message: expect.any(String),
      },
    ]);
  });

  it("keeps a remainder file whose risk name a newer release wrote", () => {
    const file = {
      file: "src/a.ts",
      addedRanges: [{ start: 1, end: 2 }],
      removedRanges: [],
      riskSurface: ["adds-future-secret"],
    };

    const read = readBodyOrThrow(makeBodyWith({ unattributed: [file] }));

    expect(read.brief.unattributed).toEqual([file]);
    expect(read.issues).toEqual([]);
  });

  it("moves a chunk whose changeGroupId is empty into the remainder", () => {
    const read = readBodyOrThrow(makeBodyWithChunk({ changeGroupId: "" }));

    expect(read.brief.chunks).toEqual([]);
    expect(read.issues).toEqual([
      expect.objectContaining({
        code: ArtifactIssueCodes.UNKNOWN_CHANGE_GROUP,
        path: "chunks.0.changeGroupId",
      }),
    ]);
  });

  it.each([
    ["index", makeBodyWith({ index: "first" })],
    ["commitRange", makeBodyWith({ commitRange: NOT_A_SECTION })],
    ["generation", makeBodyWith({ generation: { provider: 1 } })],
    ["anchor", makeBodyWith({ anchor: { state: "sideways" } })],
    ["anchoring", makeBodyWith({ anchoring: NOT_A_SECTION })],
    ["generationWarnings", makeBodyWith({ generationWarnings: [1] })],
    ["lengthViolations", makeBodyWith({ lengthViolations: [NOT_A_SECTION] })],
    ["unattributed", makeBodyWith({ unattributed: [NOT_A_SECTION] })],
    ["diffTotals", makeBodyWith({ diffTotals: null })],
    ["readingOrder", makeBodyWith({ readingOrder: [NOT_A_SECTION] })],
    ["intentCheck", makeBodyWith({ intentCheck: "none" })],
    ["outlineForm", makeBodyWith({ outlineForm: "lines-99" })],
    ["pr.state", makeBodyWithPr({ state: "merged" })],
    ["pr.draft", makeBodyWithPr({ draft: "yes" })],
    ["pr.merged", makeBodyWithPr({ merged: 1 })],
    ["pr.headRef", makeBodyWithPr({ headRef: 7 })],
    ["pr.baseRef", makeBodyWithPr({ baseRef: null })],
    ["pr.stack", makeBodyWithPr({ stack: "above" })],
  ])("drops and reports an invalid %s", (path, body) => {
    const read = readBodyOrThrow(body);

    expect(read.issues).toEqual([
      {
        code: ArtifactIssueCodes.DROPPED_SECTION,
        path,
        message: expect.any(String),
      },
    ]);
    expect(read.brief).not.toHaveProperty(path);
  });

  it("nulls an unknown effort and keeps the generation stamp", () => {
    const brief = makeValidBrief();
    const body = makeBodyWith({
      generation: { ...brief.generation, effort: "extreme" },
    });

    const read = readBodyOrThrow(body);

    expect(read.brief.generation).toEqual({
      ...brief.generation,
      effort: null,
    });
    expect(isCompleteBrief(read.brief)).toBe(true);
    expect(read.issues).toEqual([
      {
        code: ArtifactIssueCodes.DROPPED_FIELD,
        path: "generation.effort",
        message: expect.any(String),
      },
    ]);
  });

  it("reads a body missing commitCount as incomplete", () => {
    const body = makeBodyWith({ commitRange: { base: "b", head: "h" } });

    const read = readBodyOrThrow(body);

    expect(read.issues).toEqual([
      expect.objectContaining({
        code: ArtifactIssueCodes.DROPPED_SECTION,
        path: "commitRange",
      }),
    ]);
    expect(read.brief.commitRange).toBeUndefined();
    expect(isCompleteBrief(read.brief)).toBe(false);
  });

  it.each(["index", "commitRange", "generation"] as const)(
    "reads a body with only %s absent as incomplete",
    (section) => {
      const { [section]: _absent, ...body } = makeValidBrief();

      const read = readBodyOrThrow(body);

      expect(read.issues).toEqual([]);
      expect(isCompleteBrief(read.brief)).toBe(false);
    },
  );

  it("drops a readingOrder that is not a permutation of the groups", () => {
    const body = {
      ...makeTwoGroupBrief(),
      readingOrder: [
        { groupId: "g1", why: "first" },
        { groupId: "g1", why: "again" },
      ],
    };

    const read = readBodyOrThrow(body);

    expect(read.brief).not.toHaveProperty("readingOrder");
    expect(read.issues).toEqual([
      {
        code: ArtifactIssueCodes.DROPPED_SECTION,
        path: "readingOrder",
        message: expect.any(String),
      },
    ]);
  });

  it("fails on a group with no id", () => {
    const brief = makeValidBrief();
    const { id: _removed, ...group } = brief.changeGroups[0]!;

    expect(readBody({ ...brief, changeGroups: [group] })).toMatchObject({
      ok: false,
      error: expect.arrayContaining([
        expect.objectContaining({
          code: ArtifactIssueCodes.INVALID,
          path: "changeGroups.0.id",
        }),
      ]),
    });
  });

  it("ignores a legacy chunk list and moves the chunk to the remainder", () => {
    const brief = makeValidBrief();
    const [chunk] = brief.chunks;
    const { changeGroupId: _removed, ...unlisted } = chunk!;
    const group = { ...brief.changeGroups[0], coreChunkIds: [chunk!.id] };

    const read = readBodyOrThrow({
      ...brief,
      changeGroups: [group],
      chunks: [unlisted],
    });

    expect(read.brief.chunks).toEqual([]);
    expect(read.brief.changeGroups[0]).not.toHaveProperty("coreChunkIds");
    expect(read.issues).toEqual([
      expect.objectContaining({
        code: ArtifactIssueCodes.UNKNOWN_CHANGE_GROUP,
        path: "chunks.0.changeGroupId",
      }),
    ]);
  });

  it("reads a body whose groups share an id and reports it", () => {
    const brief = makeTwoGroupBrief();
    const [firstGroup, lastGroup] = brief.changeGroups;
    const changeGroups = [firstGroup, firstGroup, lastGroup];

    const read = readBodyOrThrow({ ...brief, changeGroups });

    expect(read.brief.changeGroups).toEqual(changeGroups);
    expect(read.brief.chunks).toEqual(brief.chunks);
    expect(read.issues).toEqual([
      {
        code: ArtifactIssueCodes.SHARED_GROUP_ID,
        path: "changeGroups.1.id",
        message: "Shares its id with an earlier change group",
      },
    ]);
  });

  it.each([
    ["one step per group", ["g1", "g1"]],
    ["one step per distinct id", ["g1"]],
  ])("drops the reading order when groups share an id: %s", (_label, steps) => {
    const brief = makeValidBrief();
    const [group] = brief.changeGroups;
    const body = {
      ...brief,
      changeGroups: [group, group],
      readingOrder: steps.map((groupId) => ({ groupId, why: "a step" })),
    };

    const read = readBodyOrThrow(body);

    expect(read.brief).not.toHaveProperty("readingOrder");
    expect(read.issues.map((issue) => issue.code)).toEqual([
      ArtifactIssueCodes.SHARED_GROUP_ID,
      ArtifactIssueCodes.DROPPED_SECTION,
    ]);
  });

  it("moves a chunk naming no group into the unattributed remainder", () => {
    const brief = makeTwoGroupBrief();
    const [kept, orphan] = brief.chunks;
    const body = {
      ...brief,
      chunks: [kept, { ...orphan, changeGroupId: "g9" }],
      unattributed: [],
    };

    const read = readBodyOrThrow(body);

    expect(read.brief.chunks).toEqual([kept]);
    expect(read.brief.unattributed).toEqual([
      {
        file: orphan!.file,
        addedRanges: orphan!.addedRanges,
        removedRanges: orphan!.removedRanges,
      },
    ]);
    expect(read.issues).toEqual([
      {
        code: ArtifactIssueCodes.UNKNOWN_CHANGE_GROUP,
        path: "chunks.1.changeGroupId",
        message: expect.any(String),
      },
    ]);
  });

  it("merges a moved chunk's lines into its file's remainder entry", () => {
    const brief = makeValidBrief();
    const orphan = {
      ...brief.chunks[0],
      id: "c9",
      changeGroupId: "g9",
      addedRanges: [{ start: 6, end: 8 }],
      removedRanges: [{ start: 2, end: 2 }],
    };
    const body = {
      ...brief,
      chunks: [...brief.chunks, orphan],
      unattributed: [
        {
          file: "a.ts",
          addedRanges: [{ start: 9, end: 9 }],
          removedRanges: [],
        },
      ],
    };

    const read = readBodyOrThrow(body);

    expect(read.brief.unattributed).toEqual([
      {
        file: "a.ts",
        addedRanges: [{ start: 6, end: 9 }],
        removedRanges: [{ start: 2, end: 2 }],
      },
    ]);
  });

  it.each([
    ["an empty token", ""],
    ["a token that is not kebab-case", "Breaking Change!"],
    ["a token over 50 characters", `a${"-b".repeat(25)}`],
  ])("drops %s and reports it", (_label, badToken) => {
    const body = makeBodyWithChunk({
      riskSurface: ["no-tests", badToken],
      riskNotes: [
        { attr: "no-tests", note: "no coverage" },
        { attr: badToken, note: "why it fired" },
      ],
    });

    const read = readBodyOrThrow(body);

    expect(read.brief.chunks[0]?.riskSurface).toEqual(["no-tests"]);
    expect(read.brief.chunks[0]?.riskNotes).toEqual([
      { attr: "no-tests", note: "no coverage" },
    ]);
    expect(read.issues).toEqual([
      {
        code: ArtifactIssueCodes.DROPPED_FIELD,
        path: "chunks.0.riskSurface.1",
        message: expect.any(String),
      },
      {
        code: ArtifactIssueCodes.DROPPED_FIELD,
        path: "chunks.0.riskNotes.1",
        message: expect.any(String),
      },
    ]);
  });

  it("accepts a custom risk token it cannot know", () => {
    const body = makeBodyWithChunk({
      riskSurface: ["touches-billing"],
      riskNotes: [{ attr: "touches-billing", note: "charges the card" }],
    });

    expect(readBodyOrThrow(body)).toEqual({ brief: body, issues: [] });
  });

  it("strips a key the Brief shape does not know", () => {
    const read = readBodyOrThrow(makeBodyWith({ verdict: "approve" }));

    expect(read.brief).not.toHaveProperty("verdict");
    expect(read.issues).toEqual([]);
  });
});

describe("a body the write check accepts", () => {
  it("reads ok: a Brief with a reading order", () => {
    const body = {
      ...makeTwoGroupBrief(),
      readingOrder: [
        { groupId: "g2", why: "first" },
        { groupId: "g1", why: "second" },
      ],
    };

    expect(checkBriefForWrite(body, []).ok).toBe(true);

    expect(readBodyOrThrow(body)).toEqual({ brief: body, issues: [] });
  });
});

describe("readStoredDeltaBrief", () => {
  it("reads a well-formed Delta Brief", () => {
    const delta = makeValidDeltaBrief();

    expect(readStoredDeltaBrief(JSON.stringify(delta))).toEqual({
      ok: true,
      value: delta,
    });
  });

  it("fails on an invalid core", () => {
    const { wholePrImpact: _removed, ...body } = makeValidDeltaBrief();

    expect(readStoredDeltaBrief(JSON.stringify(body))).toEqual({
      ok: false,
      error: [
        {
          code: ArtifactIssueCodes.INVALID,
          path: "wholePrImpact",
          message: expect.any(String),
        },
      ],
    });
  });

  it("fails with not-json on a body that is not JSON", () => {
    expect(readStoredDeltaBrief("<html>")).toEqual({
      ok: false,
      error: [expect.objectContaining({ code: ArtifactIssueCodes.NOT_JSON })],
    });
  });

  it("fails on a body that is not an object", () => {
    expect(readStoredDeltaBrief("7")).toEqual({
      ok: false,
      error: [
        expect.objectContaining({ code: ArtifactIssueCodes.INVALID, path: "" }),
      ],
    });
  });
});

describe("readStoredDelta", () => {
  const { pr, baselineSha, headSha } = makeValidDeltaBrief();
  const spanRecord = {
    pr,
    baselineSha,
    headSha,
    baselineIndex: 1,
    headIndex: 2,
  };

  it.each([
    ["the no-change record", { artifactKind: "deltaUnchanged", ...spanRecord }],
    [
      "the skip record",
      {
        artifactKind: "deltaSkipped",
        ...spanRecord,
        skipped: "span-too-large",
      },
    ],
    ["a Delta Brief", makeValidDeltaBrief()],
  ])("reads %s", (_title, body) => {
    expect(readStoredDelta(JSON.stringify(body))).toEqual({
      ok: true,
      value: body,
    });
  });

  it("fails on a no-change record missing its span", () => {
    const body = { artifactKind: "deltaUnchanged", pr };

    const read = readStoredDelta(JSON.stringify(body));

    expect(read.ok).toBe(false);
  });
});

describe("readStoredRevisionNarrative", () => {
  it("reads a generated narrative", () => {
    const narrative = makeValidRevisionNarrative();

    expect(readStoredRevisionNarrative(JSON.stringify(narrative))).toEqual({
      ok: true,
      value: { narrative, issues: [] },
    });
  });

  it("accepts the skipped stub", () => {
    const stub = makeSkippedRevisionNarrative();

    expect(readStoredRevisionNarrative(JSON.stringify(stub))).toEqual({
      ok: true,
      value: { narrative: stub, issues: [] },
    });
  });

  it("accepts the no-change record", () => {
    const unchanged = makeUnchangedRevisionNarrative();

    expect(readStoredRevisionNarrative(JSON.stringify(unchanged))).toEqual({
      ok: true,
      value: { narrative: unchanged, issues: [] },
    });
  });

  it("strips a key a newer release added to a narrative", () => {
    const narrative = makeValidRevisionNarrative();
    const body = { ...narrative, verdict: "approve" };

    expect(readStoredRevisionNarrative(JSON.stringify(body))).toEqual({
      ok: true,
      value: { narrative, issues: [] },
    });
    expect(checkRevisionNarrativeForWrite(body).ok).toBe(false);
  });

  it("strips a key a newer release added to the skipped stub", () => {
    const stub = makeSkippedRevisionNarrative();
    const body = { ...stub, retryAfter: 60 };

    expect(readStoredRevisionNarrative(JSON.stringify(body))).toEqual({
      ok: true,
      value: { narrative: stub, issues: [] },
    });
    expect(checkRevisionNarrativeForWrite(body).ok).toBe(false);
  });

  it("nulls an unknown effort and keeps the narrative", () => {
    const narrative = makeValidRevisionNarrative();
    const body = {
      ...narrative,
      generation: { ...narrative.generation, effort: "extreme" },
    };

    expect(readStoredRevisionNarrative(JSON.stringify(body))).toEqual({
      ok: true,
      value: {
        narrative: {
          ...narrative,
          generation: { ...narrative.generation, effort: null },
        },
        issues: [
          {
            code: ArtifactIssueCodes.DROPPED_FIELD,
            path: "generation.effort",
            message: expect.any(String),
          },
        ],
      },
    });
  });

  it.each([
    ["generationWarnings", { generationWarnings: [1] }],
    ["lengthViolations", { lengthViolations: [NOT_A_SECTION] }],
    [
      "pr.state",
      { pr: { ...makeValidRevisionNarrative().pr, state: "merged" } },
    ],
  ])("drops and reports an invalid %s", (path, overrides) => {
    const narrative = makeValidRevisionNarrative();
    const body = { ...narrative, ...overrides };

    const read = readStoredRevisionNarrative(JSON.stringify(body));
    if (!read.ok) {
      throw new Error(`expected an ok read: ${JSON.stringify(read.error)}`);
    }

    expect(read.value.narrative).not.toHaveProperty(path);
    expect(read.value.issues).toEqual([
      {
        code: ArtifactIssueCodes.DROPPED_SECTION,
        path,
        message: expect.any(String),
      },
    ]);
  });

  it("fails on a narrative with no overview", () => {
    const { overview: _removed, ...body } = makeValidRevisionNarrative();

    expect(readStoredRevisionNarrative(JSON.stringify(body))).toEqual({
      ok: false,
      error: [
        expect.objectContaining({
          code: ArtifactIssueCodes.INVALID,
          path: "overview",
        }),
      ],
    });
  });

  it("fails with not-json on a body that is not JSON", () => {
    expect(readStoredRevisionNarrative("")).toEqual({
      ok: false,
      error: [expect.objectContaining({ code: ArtifactIssueCodes.NOT_JSON })],
    });
  });
});

const MERMAID_KEY = `mermaid:${"a1".repeat(32)}`;
const SUMMARY_MEDIA = {
  shown: [
    { key: "https://cdn.test/after.png", position: "before-lede" },
    { key: MERMAID_KEY, position: "after-lede" },
  ],
  pointer: {
    label: "Before and after",
    items: ["https://github.com/acme/app/raw/main/before.png"],
  },
};

describe("Summary Media in a stored Brief", () => {
  it("round-trips through the write check and the reader", () => {
    const body = makeBodyWith({ summaryMedia: SUMMARY_MEDIA });

    expect(checkBriefForWrite(body, []).ok).toBe(true);
    expect(readBodyOrThrow(body)).toEqual({ brief: body, issues: [] });
  });

  it.each([
    [
      "a key that is no address",
      { shown: [{ key: "../x", position: "after-lede" }] },
    ],
    [
      "a short mermaid key",
      { shown: [{ key: "mermaid:abc", position: "after-lede" }] },
    ],
    [
      "a plain http key",
      { shown: [{ key: "http://cdn.test/a.png", position: "after-lede" }] },
    ],
    ["an unknown position", { shown: [{ key: MERMAID_KEY, position: "top" }] }],
    [
      "three shown items",
      {
        shown: [1, 2, 3].map(() => ({
          key: MERMAID_KEY,
          position: "after-lede",
        })),
      },
    ],
    [
      "an empty label",
      { shown: [], pointer: { label: "", items: [MERMAID_KEY] } },
    ],
    [
      "a long label",
      { shown: [], pointer: { label: "x".repeat(41), items: [MERMAID_KEY] } },
    ],
    [
      "a pointer with no items",
      { shown: [], pointer: { label: "Set", items: [] } },
    ],
    ["a number for a key", { shown: [{ key: 1, position: "after-lede" }] }],
  ])("drops the section for %s", (_case, summaryMedia) => {
    const read = readBodyOrThrow(makeBodyWith({ summaryMedia }));

    expect(read.brief).not.toHaveProperty("summaryMedia");
    expect(read.issues).toEqual([
      expect.objectContaining({
        code: ArtifactIssueCodes.DROPPED_SECTION,
        path: "summaryMedia",
      }),
    ]);
  });

  it("refuses junk at the write check", () => {
    const body = makeBodyWith({
      summaryMedia: {
        shown: [{ key: "javascript:alert(1)", position: "after-lede" }],
      },
    });

    expect(checkBriefForWrite(body, []).ok).toBe(false);
  });
});
