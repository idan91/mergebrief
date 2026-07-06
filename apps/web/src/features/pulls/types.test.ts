// Boundary-guard tests for the read-API PR shapes (BRIEF-19 PR 3.1). The API
// is trusted infrastructure but still an external boundary to this bundle —
// responses are parsed, never cast.
import { describe, expect, it } from "vitest";
import { parsePrSummary, parsePullsList } from "./types";

const ROW = {
  repoId: "424242",
  repoSlug: "octo/hello",
  prNumber: 7,
  title: "feat: widgets",
  state: "open",
  baseSha: "base-1",
  headSha: "head-1",
  briefAvailable: true,
  generation: {
    status: "succeeded",
    phase: null,
    attempts: 0,
    error: null,
    updatedAt: "2026-07-06T12:00:00.000Z",
  },
  updatedAt: "2026-07-06T12:00:00.000Z",
};

describe("parsePrSummary", () => {
  it("accepts a full row", () => {
    const parsed = parsePrSummary(ROW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.prNumber).toBe(7);
    expect(parsed.value.generation?.status).toBe("succeeded");
  });

  it("accepts nullable fields (waiting row: no brief, no title, null span)", () => {
    const parsed = parsePrSummary({
      ...ROW,
      title: null,
      baseSha: null,
      headSha: null,
      briefAvailable: false,
      generation: null,
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects an unknown generation status", () => {
    const parsed = parsePrSummary({
      ...ROW,
      generation: { ...ROW.generation, status: "exploded" },
    });
    expect(parsed.ok).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { prNumber: _dropped, ...rest } = ROW;
    expect(parsePrSummary(rest).ok).toBe(false);
  });

  it("rejects an unknown state", () => {
    expect(parsePrSummary({ ...ROW, state: "reopened" }).ok).toBe(false);
  });

  it("rejects a non-numeric repoId (it is interpolated into route URLs)", () => {
    expect(parsePrSummary({ ...ROW, repoId: "123/extra" }).ok).toBe(false);
    expect(parsePrSummary({ ...ROW, repoId: "?x=1" }).ok).toBe(false);
    expect(parsePrSummary({ ...ROW, repoId: "" }).ok).toBe(false);
  });
});

describe("parsePrSummary comparisons (PR-meta only)", () => {
  it("accepts an absent comparisons key (list rows) and an empty envelope", () => {
    expect(parsePrSummary(ROW).ok).toBe(true);
    const empty = parsePrSummary({ ...ROW, comparisons: {} });
    expect(empty.ok).toBe(true);
    if (!empty.ok) throw new Error("unreachable");
    expect(empty.value.comparisons?.previousBrief).toBeUndefined();
  });

  it("parses previousBrief availability", () => {
    const parsed = parsePrSummary({
      ...ROW,
      comparisons: {
        previousBrief: {
          baselineSha: "head-0",
          baselineIndex: 1,
          narrativeAvailable: true,
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value.comparisons?.previousBrief).toEqual({
      baselineSha: "head-0",
      baselineIndex: 1,
      narrativeAvailable: true,
    });
  });

  it("rejects a malformed previousBrief", () => {
    expect(
      parsePrSummary({
        ...ROW,
        comparisons: { previousBrief: { baselineSha: 5 } },
      }).ok,
    ).toBe(false);
  });
});

describe("parsePullsList", () => {
  it("accepts { pulls: [...] } and rejects a bare array", () => {
    const ok = parsePullsList({ pulls: [ROW] });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("unreachable");
    expect(ok.value).toHaveLength(1);

    expect(parsePullsList([ROW]).ok).toBe(false);
  });

  it("rejects a list containing one malformed row", () => {
    expect(parsePullsList({ pulls: [ROW, { nope: true }] }).ok).toBe(false);
  });
});
