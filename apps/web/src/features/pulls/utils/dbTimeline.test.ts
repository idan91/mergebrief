import { describe, expect, it } from "vitest";

import {
  buildRevisionTimelineViewFromDb,
  findDbTimelinePoint,
  formatRevisionKey,
  resolveDbTimeline,
} from "./dbTimeline";
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

// Out of order on purpose, the resolver must sort by headIndex.
const REVISIONS: RevisionSummary[] = [
  revision({ headSha: "h2", baseSha: "b2", headIndex: 2 }),
  revision({ headSha: "h1", baseSha: "b1", headIndex: 1 }),
  revision({ headSha: "h3", baseSha: "b3-drifted", headIndex: 3 }),
];

describe("resolveDbTimeline", () => {
  it("returns undefined when there are no revisions", () => {
    expect(resolveDbTimeline(undefined, {})).toBeUndefined();
    expect(resolveDbTimeline([], { head: "h1" })).toBeUndefined();
  });

  it("defaults to the latest revision when no head is requested", () => {
    const selection = resolveDbTimeline(REVISIONS, {});
    expect(selection?.points.map((point) => point.headSha)).toEqual([
      "h1",
      "h2",
      "h3",
    ]);
    expect(selection?.selected.headSha).toBe("h3");
    expect(selection?.degraded).toBe(false);
    expect(selection?.selectedIndex).toBe(2);
    expect(selection?.points[1]?.headSha).toBe("h2");
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
      { head: "h2" },
    );
    expect(selection?.selected.generatedAt).toBe("2026-07-06T11:58:00.000Z");
    expect(selection?.points[0]?.generatedAt).toBeUndefined();
  });

  it("selects a historical head with ITS OWN base", () => {
    const selection = resolveDbTimeline(REVISIONS, { head: "h1" });
    expect(selection?.selected.headSha).toBe("h1");
    expect(selection?.selected.baseSha).toBe("b1");
    expect(selection?.selectedIndex).toBe(0);
  });

  it("degrades an unknown head to latest with the note flag set", () => {
    const selection = resolveDbTimeline(REVISIONS, { head: "never-briefed" });
    expect(selection?.selected.headSha).toBe("h3");
    expect(selection?.degraded).toBe(true);
  });
});

describe("resolveDbTimeline with duplicate heads from a retarget", () => {
  // The brief natural key is (pr, base, head): a retarget re-brief writes a
  // SECOND revision for the same head with a different base.
  const DUPLICATES: RevisionSummary[] = [
    revision({ headSha: "h1", baseSha: "b1", headIndex: 1 }),
    revision({ headSha: "h2", baseSha: "b-old", headIndex: 2 }),
    revision({ headSha: "h2", baseSha: "b-new", headIndex: 3 }),
  ];

  it("a bare head resolves to the highest-index duplicate", () => {
    const selection = resolveDbTimeline(DUPLICATES, { head: "h2" });
    expect(selection?.selected.baseSha).toBe("b-new");
    expect(selection?.selectedIndex).toBe(2);
    expect(selection?.degraded).toBe(false);
  });

  it("head + base resolves the EXACT span, reaching the older duplicate", () => {
    const selection = resolveDbTimeline(DUPLICATES, {
      head: "h2",
      base: "b-old",
    });
    expect(selection?.selected.baseSha).toBe("b-old");
    expect(selection?.selectedIndex).toBe(1);
    expect(selection?.degraded).toBe(false);
    // Both duplicates stay addressable as distinct points.
    expect(selection?.points[2]?.baseSha).toBe("b-new");
  });

  it("head plus an unknown base falls back to the highest-index head", () => {
    const selection = resolveDbTimeline(DUPLICATES, {
      head: "h2",
      base: "b-gone",
    });
    expect(selection?.selected.baseSha).toBe("b-new");
    expect(selection?.degraded).toBe(false);
  });
});

describe("resolveDbTimeline with a rev request", () => {
  it("selects the revision whose headIndex is the rev", () => {
    const selection = resolveDbTimeline(REVISIONS, { rev: 2 });
    expect(selection?.selected.headSha).toBe("h2");
    expect(selection?.selected.baseSha).toBe("b2");
    expect(selection?.selectedIndex).toBe(1);
    expect(selection?.degraded).toBe(false);
  });

  it("degrades an unknown rev to latest with the note flag set", () => {
    const selection = resolveDbTimeline(REVISIONS, { rev: 9 });
    expect(selection?.selected.headSha).toBe("h3");
    expect(selection?.degraded).toBe(true);
  });

  it("rev wins over a legacy head when both are present", () => {
    const selection = resolveDbTimeline(REVISIONS, { rev: 1, head: "h3" });
    expect(selection?.selected.headSha).toBe("h1");
  });

  it("a retarget duplicate is addressable by its own rev", () => {
    const duplicates: RevisionSummary[] = [
      revision({ headSha: "h2", baseSha: "b-old", headIndex: 2 }),
      revision({ headSha: "h2", baseSha: "b-new", headIndex: 3 }),
    ];
    expect(resolveDbTimeline(duplicates, { rev: 2 })?.selected.baseSha).toBe(
      "b-old",
    );
    expect(resolveDbTimeline(duplicates, { rev: 3 })?.selected.baseSha).toBe(
      "b-new",
    );
  });
});

describe("buildRevisionTimelineViewFromDb", () => {
  it("keys rows by brief index, newest first, current on the selection", () => {
    const selection = resolveDbTimeline(REVISIONS, { rev: 2 });
    if (selection === undefined) {
      throw new Error("no selection");
    }
    const view = buildRevisionTimelineViewFromDb(selection);
    expect(view.rows.map((row) => row.key)).toEqual(["3", "2", "1"]);
    expect(view.rows.map((row) => row.current)).toEqual([false, true, false]);
    expect(view.rows[0]?.newest).toBe(true);
  });

  it("dates a row from its generation start when the point has one", () => {
    const selection = resolveDbTimeline(
      [
        revision({ headSha: "h1", headIndex: 1 }),
        revision({
          headSha: "h2",
          headIndex: 2,
          generatedAt: "2026-09-30T10:00:00Z",
        }),
      ],
      {},
    );
    if (selection === undefined) {
      throw new Error("no selection");
    }
    const [newest, oldest] = buildRevisionTimelineViewFromDb(selection).rows;
    expect(newest?.at).toBe("2026-09-30T10:00:00Z");
    expect(oldest).not.toHaveProperty("at");
  });

  it("formats a revision key as its brief index", () => {
    const selection = resolveDbTimeline(REVISIONS, {});
    expect(selection && formatRevisionKey(selection.selected)).toBe("3");
  });
});

describe("findDbTimelinePoint", () => {
  it("finds the revision a row key names, and nothing for a stale key", () => {
    const selection = resolveDbTimeline(REVISIONS, {});
    if (selection === undefined) {
      throw new Error("no selection");
    }
    expect(findDbTimelinePoint(selection, "2")?.headSha).toBe("h2");
    expect(findDbTimelinePoint(selection, "9")).toBeUndefined();
  });
});
