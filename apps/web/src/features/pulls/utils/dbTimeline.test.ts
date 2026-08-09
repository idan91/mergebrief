import { describe, expect, it } from "vitest";

import { resolveDbTimeline } from "./dbTimeline";
import type { RevisionSummary } from "../types";

function revision(overrides: Partial<RevisionSummary>): RevisionSummary {
  return {
    headSha: "head",
    baseSha: "base",
    headIndex: 1,
    createdAt: "2026-07-06T12:00:00.000Z",
    comparisons: {},
    ...overrides,
  };
}

// Out of order on purpose — the resolver must sort by headIndex.
const REVISIONS: RevisionSummary[] = [
  revision({ headSha: "h2", baseSha: "b2", headIndex: 2 }),
  revision({ headSha: "h1", baseSha: "b1", headIndex: 1 }),
  revision({ headSha: "h3", baseSha: "b3-drifted", headIndex: 3 }),
];

describe("resolveDbTimeline", () => {
  it("returns undefined when there are no revisions", () => {
    expect(resolveDbTimeline(undefined, undefined)).toBeUndefined();
    expect(resolveDbTimeline([], "h1")).toBeUndefined();
  });

  it("defaults to the latest revision when no head is requested", () => {
    const selection = resolveDbTimeline(REVISIONS, undefined);
    expect(selection?.points.map((point) => point.headSha)).toEqual([
      "h1",
      "h2",
      "h3",
    ]);
    expect(selection?.selected.headSha).toBe("h3");
    expect(selection?.degraded).toBe(false);
    expect(selection?.next).toBeUndefined();
    expect(selection?.previous?.headSha).toBe("h2");
  });

  it("carries a revision's generatedAt onto its point", () => {
    const selection = resolveDbTimeline(
      [
        revision({ headSha: "h1", headIndex: 1 }),
        revision({
          headSha: "h2",
          headIndex: 2,
          generatedAt: "2026-07-06T11:58:00.000Z",
        }),
      ],
      "h2",
    );
    expect(selection?.selected.generatedAt).toBe("2026-07-06T11:58:00.000Z");
    expect(selection?.points[0]?.generatedAt).toBeUndefined();
  });

  it("selects a historical head with ITS OWN base, exposing prev/next", () => {
    const selection = resolveDbTimeline(REVISIONS, "h1");
    expect(selection?.selected.headSha).toBe("h1");
    expect(selection?.selected.baseSha).toBe("b1");
    expect(selection?.previous).toBeUndefined();
    expect(selection?.next?.headSha).toBe("h2");
  });

  it("carries the per-entry drifted base for a middle revision", () => {
    const selection = resolveDbTimeline(REVISIONS, "h3");
    expect(selection?.selected.baseSha).toBe("b3-drifted");
  });

  it("degrades an unknown head to latest with the note flag set", () => {
    const selection = resolveDbTimeline(REVISIONS, "never-briefed");
    expect(selection?.selected.headSha).toBe("h3");
    expect(selection?.degraded).toBe(true);
  });
});

describe("resolveDbTimeline — duplicate heads (retarget re-brief)", () => {
  // The brief natural key is (pr, base, head): a retarget re-brief writes a
  // SECOND revision for the same head with a different base.
  const DUPLICATES: RevisionSummary[] = [
    revision({ headSha: "h1", baseSha: "b1", headIndex: 1 }),
    revision({ headSha: "h2", baseSha: "b-old", headIndex: 2 }),
    revision({ headSha: "h2", baseSha: "b-new", headIndex: 3 }),
  ];

  it("a bare head resolves to the HIGHEST-index duplicate (backend at(-1) choice)", () => {
    const selection = resolveDbTimeline(DUPLICATES, "h2");
    expect(selection?.selected.baseSha).toBe("b-new");
    expect(selection?.selectedIndex).toBe(2);
    expect(selection?.degraded).toBe(false);
  });

  it("head + base resolves the EXACT span, reaching the older duplicate", () => {
    const selection = resolveDbTimeline(DUPLICATES, "h2", "b-old");
    expect(selection?.selected.baseSha).toBe("b-old");
    expect(selection?.selectedIndex).toBe(1);
    expect(selection?.degraded).toBe(false);
    // Both duplicates stay addressable as distinct points.
    expect(selection?.next?.baseSha).toBe("b-new");
  });

  it("head + a base matching no row falls back to the highest-index head match", () => {
    const selection = resolveDbTimeline(DUPLICATES, "h2", "b-gone");
    expect(selection?.selected.baseSha).toBe("b-new");
    expect(selection?.degraded).toBe(false);
  });
});
