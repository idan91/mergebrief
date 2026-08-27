// What a session write may say on the wire. The integration suite proves a
// rejected payload is a 400; this pins the edges that decide it — the int8
// ceiling a row id must stay under, the line ordering an anchor must hold,
// and the closed category vocabulary.
import { ChangeGroupCategory, DraftCommentSide } from "persistence";
import { describe, expect, it } from "vitest";
import {
  anchorSchema,
  briefLocalIdSchema,
  categorySchema,
  createDraftSchema,
  readSchema,
} from "../../src/routes/repos/pr/session/schemas";
import { rowIdSchema } from "../../src/routes/repos/pr/wire-bounds";

const ANCHOR = {
  filePath: "src/app.ts",
  side: DraftCommentSide.NEW,
  startLine: 10,
  endLine: 12,
};

describe("rowIdSchema", () => {
  it("reads digits as a bigint", () => {
    expect(rowIdSchema.parse("42")).toBe(42n);
  });

  it("accepts the largest int8", () => {
    expect(rowIdSchema.parse("9223372036854775807")).toBe(
      9_223_372_036_854_775_807n,
    );
  });

  it.each([
    ["past int8", "9223372036854775808"],
    ["twenty digits", "12345678901234567890"],
    ["empty", ""],
    ["negative", "-1"],
    ["not a number", "abc"],
    ["padded", " 42"],
  ])("rejects %s", (_case, raw) => {
    expect(rowIdSchema.safeParse(raw).success).toBe(false);
  });
});

describe("briefLocalIdSchema", () => {
  it("accepts an opaque token up to the cap", () => {
    expect(briefLocalIdSchema.parse("a".repeat(256))).toHaveLength(256);
  });

  it.each([
    ["empty", ""],
    ["over the cap", "a".repeat(257)],
  ])("rejects %s", (_case, raw) => {
    expect(briefLocalIdSchema.safeParse(raw).success).toBe(false);
  });
});

describe("anchorSchema", () => {
  it("accepts a single-line anchor", () => {
    expect(
      anchorSchema.safeParse({ ...ANCHOR, startLine: 7, endLine: 7 }).success,
    ).toBe(true);
  });

  it("rejects a start that follows its end", () => {
    expect(
      anchorSchema.safeParse({ ...ANCHOR, startLine: 12, endLine: 10 }).success,
    ).toBe(false);
  });

  it.each([
    ["an unknown side", { side: "both" }],
    ["an unknown startSide", { startSide: "both" }],
    ["a zero line", { startLine: 0 }],
    ["a fractional line", { endLine: 12.5 }],
    ["an empty path", { filePath: "" }],
    ["an over-long path", { filePath: "a".repeat(1025) }],
  ])("rejects %s", (_case, patch) => {
    expect(anchorSchema.safeParse({ ...ANCHOR, ...patch }).success).toBe(false);
  });
});

describe("anchorSchema — two-side ranges", () => {
  it("accepts old\u2192new and keeps the crossing startSide", () => {
    const parsed = anchorSchema.parse({
      ...ANCHOR,
      startSide: DraftCommentSide.OLD,
    });
    expect(parsed.startSide).toBe(DraftCommentSide.OLD);
  });

  it("accepts new\u2192old with lines out of order — cross-side is unordered", () => {
    const parsed = anchorSchema.parse({
      ...ANCHOR,
      side: DraftCommentSide.OLD,
      startSide: DraftCommentSide.NEW,
      startLine: 25,
      endLine: 3,
    });
    expect(parsed).toMatchObject({
      side: DraftCommentSide.OLD,
      startSide: DraftCommentSide.NEW,
      startLine: 25,
      endLine: 3,
    });
  });

  it("normalizes a startSide equal to side to null", () => {
    expect(
      anchorSchema.parse({ ...ANCHOR, startSide: DraftCommentSide.NEW })
        .startSide,
    ).toBe(null);
  });

  it("defaults an absent startSide to null", () => {
    expect(anchorSchema.parse(ANCHOR).startSide).toBe(null);
  });

  it("still rejects an inverted range once startSide collapses to side", () => {
    expect(
      anchorSchema.safeParse({
        ...ANCHOR,
        startSide: DraftCommentSide.NEW,
        startLine: 12,
        endLine: 10,
      }).success,
    ).toBe(false);
  });
});

describe("createDraftSchema", () => {
  it("carries the anchor and the body together", () => {
    expect(createDraftSchema.parse({ ...ANCHOR, body: "hi" })).toEqual({
      ...ANCHOR,
      startSide: null,
      body: "hi",
    });
  });

  it("normalizes a startSide equal to side, same as the bare anchor", () => {
    expect(
      createDraftSchema.parse({
        ...ANCHOR,
        startSide: DraftCommentSide.NEW,
        body: "hi",
      }).startSide,
    ).toBe(null);
  });

  it("holds the anchor's line ordering too", () => {
    expect(
      createDraftSchema.safeParse({
        ...ANCHOR,
        startLine: 12,
        endLine: 10,
        body: "hi",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["an empty body", ""],
    ["a body past the cap", "a".repeat(65_537)],
  ])("rejects %s", (_case, body) => {
    expect(createDraftSchema.safeParse({ ...ANCHOR, body }).success).toBe(
      false,
    );
  });
});

describe("categorySchema", () => {
  it("accepts a known category", () => {
    expect(
      categorySchema.parse({ category: ChangeGroupCategory.BUGFIX }),
    ).toEqual({ category: ChangeGroupCategory.BUGFIX });
  });

  it.each([
    ["an unknown category", "invented"],
    ["a missing category", undefined],
    ["a non-string", 3],
  ])("rejects %s", (_case, category) => {
    expect(categorySchema.safeParse({ category }).success).toBe(false);
  });
});

describe("readSchema", () => {
  it("takes the boolean both directions", () => {
    expect(readSchema.parse({ read: false })).toEqual({ read: false });
  });

  it("rejects a truthy non-boolean", () => {
    expect(readSchema.safeParse({ read: "true" }).success).toBe(false);
  });
});
