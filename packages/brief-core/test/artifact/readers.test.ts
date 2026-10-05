import { describe, expect, it } from "vitest";
import {
  ArtifactIssueCodes,
  checkBriefForWrite,
  checkRevisionNarrativeForWrite,
  isCompleteBrief,
  readStoredBrief,
  readStoredDeltaBrief,
  readStoredRevisionNarrative,
} from "../../src/artifact";
import { dropUnorderedReadingOrder } from "../../src/artifact/logic/optional-sections";
import {
  makeLegacyMembershipBody,
  makeSkippedRevisionNarrative,
  makeTwoGroupBrief,
  makeValidBrief,
  makeValidDeltaBrief,
  makeValidRevisionNarrative,
} from "../helpers";

type Body = Record<string, unknown>;

const NOT_A_SECTION = { nope: true };
const CUSTOM_NAME = "touches-billing";
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
    [
      "an empty risk token",
      makeBodyWithChunk({ riskSurface: [""] }),
      "chunks.0.riskSurface.0",
    ],
  ])("fails on %s", (_label, body, path) => {
    expect(readBody(body)).toMatchObject({
      ok: false,
      error: expect.arrayContaining([
        expect.objectContaining({ code: ArtifactIssueCodes.INVALID, path }),
      ]),
    });
  });

  it("fails on a chunk with no membership at all", () => {
    const { changeGroupId: _removed, ...chunk } = makeValidBrief().chunks[0]!;

    expect(readBody(makeBodyWith({ chunks: [chunk] }))).toEqual({
      ok: false,
      error: [
        {
          code: ArtifactIssueCodes.INVALID,
          path: "chunks.0.changeGroupId",
          message: expect.any(String),
        },
      ],
    });
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

  it("reads a body with absent sections as incomplete with no issue", () => {
    const {
      index: _index,
      generation: _generation,
      ...body
    } = makeValidBrief();

    const read = readBodyOrThrow(body);

    expect(read.issues).toEqual([]);
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

  it("drops a readingOrder longer than the groups it visits", () => {
    const body = {
      ...makeTwoGroupBrief(),
      readingOrder: [
        { groupId: "g1", why: "first" },
        { groupId: "g2", why: "second" },
        { groupId: "g2", why: "again" },
      ],
    };

    const read = readBodyOrThrow(body);

    expect(read.brief).not.toHaveProperty("readingOrder");
    expect(read.issues).toEqual([
      expect.objectContaining({
        code: ArtifactIssueCodes.DROPPED_SECTION,
        path: "readingOrder",
      }),
    ]);
  });

  it("normalizes legacy membership onto each chunk and reports it", () => {
    const read = readBodyOrThrow(makeLegacyMembershipBody());

    expect(read.brief.chunks.map((chunk) => chunk.changeGroupId)).toEqual([
      "g1",
      "g2",
    ]);
    expect(read.brief.changeGroups[0]).not.toHaveProperty("coreChunkIds");
    expect(read.brief.changeGroups[1]).not.toHaveProperty("supportingChunkIds");
    expect(read.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ArtifactIssueCodes.LEGACY_MEMBERSHIP,
          path: "chunks.0.changeGroupId",
        }),
        expect.objectContaining({
          code: ArtifactIssueCodes.LEGACY_MEMBERSHIP,
          path: "chunks.1.changeGroupId",
        }),
      ]),
    );
  });

  it("names a group with no id by its one-based position", () => {
    const read = readBodyOrThrow(makeLegacyMembershipBody());

    expect(read.brief.changeGroups.map((group) => group.id)).toEqual([
      "g1",
      "g2",
    ]);
    expect(read.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ArtifactIssueCodes.MINTED_GROUP_ID,
          path: "changeGroups.0.id",
        }),
        expect.objectContaining({
          code: ArtifactIssueCodes.MINTED_GROUP_ID,
          path: "changeGroups.1.id",
        }),
      ]),
    );
    expect(read.issues).toHaveLength(4);
  });

  it("mints an id that skips an explicit id on another group", () => {
    const body = makeLegacyMembershipBody();
    body.changeGroups[1] = { ...body.changeGroups[1], id: "g1" };

    const read = readBodyOrThrow(body);

    expect(read.brief.changeGroups.map((group) => group.id)).toEqual([
      "g2",
      "g1",
    ]);
    expect(read.brief.chunks.map((chunk) => chunk.changeGroupId)).toEqual([
      "g2",
      "g1",
    ]);
    expect(read.issues).toContainEqual({
      code: ArtifactIssueCodes.MINTED_GROUP_ID,
      path: "changeGroups.0.id",
      message: expect.any(String),
    });
  });

  it("mints an id that skips an id it already minted", () => {
    const body = makeLegacyMembershipBody();
    const [firstGroup, lastGroup] = body.changeGroups;
    body.changeGroups = [firstGroup!, { ...lastGroup, id: "g1" }, lastGroup!];

    const read = readBodyOrThrow(body);

    expect(read.brief.changeGroups.map((group) => group.id)).toEqual([
      "g2",
      "g1",
      "g3",
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

  it("gives a chunk two groups list to the first group", () => {
    const body = makeLegacyMembershipBody();
    body.changeGroups[1] = { ...body.changeGroups[1], coreChunkIds: ["c1"] };

    const read = readBodyOrThrow(body);

    expect(read.brief.chunks[0]?.changeGroupId).toBe("g1");
    expect(
      read.issues.filter((issue) => issue.path === "chunks.0.changeGroupId"),
    ).toEqual([
      expect.objectContaining({ code: ArtifactIssueCodes.LEGACY_MEMBERSHIP }),
    ]);
  });

  it("keeps a readingOrder that names minted group ids", () => {
    const readingOrder = [
      { groupId: "g2", why: "first" },
      { groupId: "g1", why: "second" },
    ];
    const body = { ...makeLegacyMembershipBody(), readingOrder };

    const read = readBodyOrThrow(body);

    expect(read.brief.readingOrder).toEqual(readingOrder);
    expect(read.issues).not.toContainEqual(
      expect.objectContaining({ code: ArtifactIssueCodes.DROPPED_SECTION }),
    );
  });

  it("lets a chunk's own changeGroupId win over a legacy list", () => {
    const body = makeLegacyMembershipBody();
    body.chunks[0] = { ...body.chunks[0], changeGroupId: "g2" };

    const read = readBodyOrThrow(body);

    expect(read.brief.chunks[0]?.changeGroupId).toBe("g2");
    expect(read.issues).not.toContainEqual(
      expect.objectContaining({ path: "chunks.0.changeGroupId" }),
    );
  });

  it("keeps and reports a changeGroupId that names no group", () => {
    const read = readBodyOrThrow(makeBodyWithChunk({ changeGroupId: "g9" }));

    expect(read.brief.chunks[0]?.changeGroupId).toBe("g9");
    expect(read.issues).toEqual([
      {
        code: ArtifactIssueCodes.UNKNOWN_CHANGE_GROUP,
        path: "chunks.0.changeGroupId",
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
  const customNameBrief = makeBodyWithChunk({
    riskSurface: [CUSTOM_NAME],
    riskNotes: [{ attr: CUSTOM_NAME, note: "charges the card" }],
  });
  const orderedBrief = {
    ...makeTwoGroupBrief(),
    readingOrder: [
      { groupId: "g2", why: "first" },
      { groupId: "g1", why: "second" },
    ],
  };

  it.each([
    ["the plain valid Brief", makeValidBrief(), []],
    ["a Brief with a custom risk name", customNameBrief, [CUSTOM_NAME]],
    ["a Brief with a reading order", orderedBrief, []],
  ])("reads ok: %s", (_label, body, customNames) => {
    expect(checkBriefForWrite(body, customNames).ok).toBe(true);

    expect(readBodyOrThrow(body)).toEqual({ brief: body, issues: [] });
  });
});

describe("dropUnorderedReadingOrder", () => {
  it("drops an order that repeats a step over repeated group ids", () => {
    const brief = makeTwoGroupBrief();
    const [firstGroup, lastGroup] = brief.changeGroups;
    const stored = {
      ...brief,
      changeGroups: [firstGroup!, firstGroup!, lastGroup!],
      readingOrder: [
        { groupId: "g1", why: "first" },
        { groupId: "g2", why: "second" },
        { groupId: "g2", why: "again" },
      ],
    };

    const read = dropUnorderedReadingOrder(stored);

    expect(read.brief).not.toHaveProperty("readingOrder");
    expect(read.dropped).toHaveLength(1);
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

describe("readStoredRevisionNarrative", () => {
  it("reads a generated narrative", () => {
    const narrative = makeValidRevisionNarrative();

    expect(readStoredRevisionNarrative(JSON.stringify(narrative))).toEqual({
      ok: true,
      value: narrative,
    });
  });

  it("accepts the skipped stub", () => {
    const stub = makeSkippedRevisionNarrative();

    expect(readStoredRevisionNarrative(JSON.stringify(stub))).toEqual({
      ok: true,
      value: stub,
    });
  });

  it("strips a key a newer release added to a narrative", () => {
    const narrative = makeValidRevisionNarrative();
    const body = { ...narrative, verdict: "approve" };

    expect(readStoredRevisionNarrative(JSON.stringify(body))).toEqual({
      ok: true,
      value: narrative,
    });
    expect(checkRevisionNarrativeForWrite(body).ok).toBe(false);
  });

  it("strips a key a newer release added to the skipped stub", () => {
    const stub = makeSkippedRevisionNarrative();
    const body = { ...stub, retryAfter: 60 };

    expect(readStoredRevisionNarrative(JSON.stringify(body))).toEqual({
      ok: true,
      value: stub,
    });
    expect(checkRevisionNarrativeForWrite(body).ok).toBe(false);
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
