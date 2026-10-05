import { describe, expect, it } from "vitest";
import {
  ArtifactIssueCodes,
  checkBriefForWrite,
  checkDeltaBriefForWrite,
  checkRevisionNarrativeForWrite,
} from "../../src/artifact";
import { BriefSchema } from "../../src/types";
import {
  makeSkippedRevisionNarrative,
  makeTwoGroupBrief,
  makeValidBrief,
  makeValidDeltaBrief,
  makeValidRevisionNarrative,
} from "../helpers";

const CUSTOM_NAME = "touches-billing";
const MARKER = "marker-value-that-must-not-leak";

function makeCustomNameBrief() {
  const brief = makeValidBrief();
  const [chunk] = brief.chunks;
  if (chunk === undefined) {
    throw new Error("fixture has no chunk");
  }
  chunk.riskSurface = [CUSTOM_NAME];
  chunk.riskNotes = [{ attr: CUSTOM_NAME, note: "charges the card" }];
  return brief;
}

describe("checkBriefForWrite", () => {
  it("accepts a built-in Brief with no custom names", () => {
    const brief = makeValidBrief();

    expect(checkBriefForWrite(brief, [])).toEqual({ ok: true, value: brief });
  });

  it("accepts a custom risk name the repo configured", () => {
    const brief = makeCustomNameBrief();

    const checked = checkBriefForWrite(brief, [CUSTOM_NAME]);

    expect(BriefSchema.safeParse(brief).success).toBe(false);
    expect(checked).toEqual({ ok: true, value: brief });
  });

  it("refuses a custom risk name the repo did not configure", () => {
    const checked = checkBriefForWrite(makeCustomNameBrief(), []);

    expect(checked).toEqual({
      ok: false,
      error: [
        expect.objectContaining({
          code: ArtifactIssueCodes.INVALID,
          path: "chunks.0.riskSurface.0",
        }),
        expect.objectContaining({
          code: ArtifactIssueCodes.INVALID,
          path: "chunks.0.riskNotes.0.attr",
        }),
      ],
    });
  });

  it.each([
    ["no custom names", []],
    ["custom names", [CUSTOM_NAME]],
  ])("refuses two groups that share an id with %s", (_label, customNames) => {
    const brief = makeTwoGroupBrief();
    const [firstGroup, lastGroup] = brief.changeGroups;
    const body = { ...brief, changeGroups: [firstGroup, lastGroup, lastGroup] };

    expect(checkBriefForWrite(body, customNames)).toEqual({
      ok: false,
      error: [
        {
          code: ArtifactIssueCodes.INVALID,
          path: "changeGroups.2.id",
          message: "Shares its id with an earlier change group",
        },
      ],
    });
  });

  it("refuses a body that is not an object", () => {
    const checked = checkBriefForWrite("not a brief", []);

    expect(checked).toEqual({
      ok: false,
      error: [expect.objectContaining({ path: "" })],
    });
  });

  it("keeps the offending value out of every issue", () => {
    const brief = makeValidBrief();
    const [chunk] = brief.chunks;
    if (chunk === undefined) {
      throw new Error("fixture has no chunk");
    }
    chunk.riskSurface = [MARKER];
    const body = { ...brief, summary: { text: MARKER }, index: MARKER };

    const checked = checkBriefForWrite(body, []);

    expect(checked).toMatchObject({
      ok: false,
      error: [{ path: "index" }, { path: "summary" }, {}],
    });
    expect(JSON.stringify(checked)).not.toContain(MARKER);
  });
});

describe("checkDeltaBriefForWrite", () => {
  it("accepts a well-formed Delta Brief", () => {
    const delta = makeValidDeltaBrief();

    expect(checkDeltaBriefForWrite(delta)).toEqual({ ok: true, value: delta });
  });

  it("refuses two changed groups that share an id", () => {
    const delta = makeValidDeltaBrief();
    const [group] = delta.changedGroups;
    const body = { ...delta, changedGroups: [group, group] };

    expect(checkDeltaBriefForWrite(body)).toEqual({
      ok: false,
      error: [
        {
          code: ArtifactIssueCodes.INVALID,
          path: "changedGroups.1.id",
          message: "Shares its id with an earlier change group",
        },
      ],
    });
  });

  it("refuses a Delta Brief missing a field with a pathed issue", () => {
    const { wholePrImpact: _dropped, ...body } = makeValidDeltaBrief();

    const checked = checkDeltaBriefForWrite(body);

    expect(checked).toEqual({
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
});

describe("checkRevisionNarrativeForWrite", () => {
  it("accepts a generated narrative", () => {
    const narrative = makeValidRevisionNarrative();

    expect(checkRevisionNarrativeForWrite(narrative)).toEqual({
      ok: true,
      value: narrative,
    });
  });

  it("accepts the skipped stub", () => {
    const stub = makeSkippedRevisionNarrative();

    expect(checkRevisionNarrativeForWrite(stub)).toEqual({
      ok: true,
      value: stub,
    });
  });

  it("refuses an unknown key on a narrative", () => {
    const body = { ...makeValidRevisionNarrative(), verdict: "approve" };

    const checked = checkRevisionNarrativeForWrite(body);

    expect(checked).toEqual({
      ok: false,
      error: [expect.objectContaining({ code: ArtifactIssueCodes.INVALID })],
    });
  });

  it("refuses an unknown key on the skipped stub", () => {
    const body = { ...makeSkippedRevisionNarrative(), overview: "extra" };

    expect(checkRevisionNarrativeForWrite(body)).toEqual({
      ok: false,
      error: [expect.objectContaining({ path: "" })],
    });
  });

  it("refuses an artifact kind it does not know", () => {
    const body = { ...makeSkippedRevisionNarrative(), artifactKind: "other" };

    const checked = checkRevisionNarrativeForWrite(body);

    expect(checked).toEqual({
      ok: false,
      error: [expect.objectContaining({ path: "artifactKind" })],
    });
  });
});
