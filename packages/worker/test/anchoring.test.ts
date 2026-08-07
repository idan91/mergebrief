// Unit tests for the pure anchored-generation helpers (BRIEF-143 PR 3):
// planAnchoredGeneration (partition + remap-as-invariant + shared-file
// exclusivity) and stitchBrief (carry + drop + id descent + coverage).
import { describe, expect, it } from "vitest";
import type { Brief } from "brief-core";
import {
  planAnchoredGeneration,
  stitchBrief,
  type AnchorPlan,
} from "../src/task/anchoring";

const GENERATION = {
  provider: "stub",
  model: "stub-model",
  effort: "medium" as const,
};

const PR_REF = {
  repo: "acme/widget",
  number: 7,
  title: "t",
  url: "https://github.com/acme/widget/pull/7",
  sha: "h".repeat(40),
  description: "",
};

function chunk(
  id: string,
  groupId: string,
  file: string,
  start = 1,
  end = 2,
): Brief["chunks"][number] {
  return {
    id,
    changeGroupId: groupId,
    file,
    concern: "implementation",
    role: "carrier",
    loc: { added: end - start + 1, deleted: 0 },
    addedRanges: [{ start, end }],
    removedRanges: [],
    riskSurface: [],
  };
}

function group(id: string, title: string): Brief["changeGroups"][number] {
  return {
    id,
    title,
    summary: `${title} summary`,
    dominantCategory: "bugfix",
    secondaryCategories: [],
    uncertain: false,
    uncertainBetween: [],
  };
}

function brief(
  groups: Brief["changeGroups"],
  chunks: Brief["chunks"],
  extra: Partial<Brief> = {},
): Brief {
  return {
    pr: PR_REF,
    index: 1,
    commitRange: { base: "b".repeat(40), head: "h".repeat(40), commitCount: 1 },
    generation: GENERATION,
    summary: "s",
    changeGroups: groups,
    chunks,
    concernView: [{ concern: "implementation", added: 2, deleted: 0 }],
    ...extra,
  };
}

/** Incremental diff touching only b.ts. */
const DIFF_B = `diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,3 @@
 line
+added
 line2
`;

const COMPARE_B = {
  files: [{ filename: "b.ts", status: "modified" }],
  complete: true,
  status: "ahead",
};

describe("planAnchoredGeneration", () => {
  const previous = brief(
    [group("g1", "alpha"), group("g2", "beta")],
    [chunk("c1", "g1", "a.ts", 5, 8), chunk("c2", "g2", "b.ts", 1, 2)],
  );

  it("freezes untouched groups and re-looks touched ones", () => {
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      incrementalDiff: DIFF_B,
      compareFiles: COMPARE_B,
      baseShaMoved: false,
    });
    expect(plan.frozen.map((f) => f.group.id)).toEqual(["g1"]);
    expect([...plan.frozenFiles]).toEqual(["a.ts"]);
    expect(plan.reLook.map((r) => r.id)).toEqual(["g2"]);
  });

  it("re-looks everything when the base SHA moved (rebase noise)", () => {
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      incrementalDiff: DIFF_B,
      compareFiles: COMPARE_B,
      baseShaMoved: true,
    });
    expect(plan.frozen).toEqual([]);
    expect(plan.reLook.map((r) => r.id)).toEqual(["g1", "g2"]);
  });

  it("re-looks everything when the incremental diff is unavailable", () => {
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      compareFiles: COMPARE_B,
      baseShaMoved: false,
    });
    expect(plan.frozen).toEqual([]);
  });

  it("re-looks everything when compare metadata is unavailable", () => {
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      incrementalDiff: DIFF_B,
      baseShaMoved: false,
    });
    expect(plan.frozen).toEqual([]);
  });

  it("forces groups sharing a file to re-look (coverage exclusivity)", () => {
    const shared = brief(
      [group("g1", "alpha"), group("g2", "beta"), group("g3", "gamma")],
      [
        chunk("c1", "g1", "a.ts", 1, 2),
        chunk("c2", "g2", "a.ts", 10, 12),
        chunk("c3", "g3", "z.ts", 1, 2),
      ],
    );
    const plan = planAnchoredGeneration({
      previousBrief: shared,
      incrementalDiff: DIFF_B,
      compareFiles: COMPARE_B,
      baseShaMoved: false,
    });
    expect(plan.frozen.map((f) => f.group.id)).toEqual(["g3"]);
    expect(plan.reLook.map((r) => r.id).toSorted()).toEqual(["g1", "g2"]);
  });

  it("re-looks everything when the compare span is not a fast-forward (force-push, same base)", () => {
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      incrementalDiff: DIFF_B,
      compareFiles: { ...COMPARE_B, status: "diverged" },
      baseShaMoved: false,
    });
    expect(plan.frozen).toEqual([]);
    expect(plan.reLook[0]?.reason).toContain("not a fast-forward");
  });

  it("re-looks everything when the compare span status is absent", () => {
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      incrementalDiff: DIFF_B,
      compareFiles: { files: [...COMPARE_B.files], complete: true },
      baseShaMoved: false,
    });
    expect(plan.frozen).toEqual([]);
  });

  it("demotes to re-look when a truncated patch's hunk overlaps carried ranges (remap invariant)", () => {
    // A patch whose hunk header exists but whose body carries no +/- lines:
    // parseChangedRanges drops the file (no changed lines) and the compare
    // list is silent, so the partition freezes g1 — the remap invariant is
    // the last line of defense and must demote, never carry wrong lines.
    const truncated = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,4 +1,9 @@",
      " ctx",
    ].join("\n");
    const plan = planAnchoredGeneration({
      previousBrief: brief(
        [group("g1", "alpha")],
        [chunk("c1", "g1", "a.ts", 2, 3)],
      ),
      incrementalDiff: truncated,
      compareFiles: { files: [], complete: true, status: "ahead" },
      baseShaMoved: false,
    });
    expect(plan.frozen).toEqual([]);
    expect(plan.reLook[0]?.reason).toContain("range remap ambiguous");
  });

  it("re-looks a group when raw-diff hunks contradict a clean compare list", () => {
    const contradictory = brief(
      [group("g1", "alpha")],
      [chunk("c1", "g1", "a.ts", 1, 2)],
    );
    const diffTouchingA = DIFF_B.replaceAll("b.ts", "a.ts");
    const plan = planAnchoredGeneration({
      previousBrief: contradictory,
      incrementalDiff: diffTouchingA,
      // Compare list claims nothing changed — contradicts the raw diff. The
      // predicate's evidence union catches it: the group re-looks.
      compareFiles: { files: [], complete: true, status: "ahead" },
      baseShaMoved: false,
    });
    expect(plan.frozen).toEqual([]);
    expect(plan.reLook.map((r) => r.id)).toEqual(["g1"]);
  });

  it("carries remapped ranges through hunks in a shared file scenario", () => {
    // g1 (a.ts only) frozen; its ranges pass through untouched a.ts → identity.
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      incrementalDiff: DIFF_B,
      compareFiles: COMPARE_B,
      baseShaMoved: false,
    });
    expect(plan.frozen[0]?.chunks[0]?.addedRanges).toEqual([
      { start: 5, end: 8 },
    ]);
  });
});

describe("stitchBrief", () => {
  const previous = brief(
    [group("g1", "alpha"), group("g2", "beta")],
    [chunk("c1", "g1", "a.ts", 5, 8), chunk("c2", "g2", "b.ts", 1, 2)],
  );

  function planFor(): AnchorPlan {
    return planAnchoredGeneration({
      previousBrief: previous,
      incrementalDiff: DIFF_B,
      compareFiles: COMPARE_B,
      baseShaMoved: false,
    });
  }

  it("carries frozen groups verbatim, keeps regenerated groups, rewrites ids by descent", () => {
    // The model (unaware of freezing in PR 3) re-emitted BOTH regions.
    const generated = brief(
      [group("tmpA", "alpha rewritten"), group("tmpB", "beta v2")],
      [chunk("x1", "tmpA", "a.ts", 5, 8), chunk("x2", "tmpB", "b.ts", 1, 3)],
    );
    const plan = planFor();
    const result = stitchBrief({
      generated,
      plan,
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const {
      brief: merged,
      carriedGroupIds,
      regeneratedGroupIds,
    } = result.value;

    // Frozen g1 carried VERBATIM — the model's rewrite discarded.
    const g1 = merged.changeGroups.find((g) => g.id === "g1");
    expect(g1?.title).toBe("alpha");
    // The re-looked region survives under its descended id (g2).
    const g2 = merged.changeGroups.find((g) => g.id === "g2");
    expect(g2?.title).toBe("beta v2");
    expect(merged.changeGroups).toHaveLength(2);

    // Carried chunk untouched; generated chunk re-pointed at g2, id unique.
    const carried = merged.chunks.find((c) => c.file === "a.ts");
    expect(carried?.changeGroupId).toBe("g1");
    expect(carried?.addedRanges).toEqual([{ start: 5, end: 8 }]);
    const regenerated = merged.chunks.find((c) => c.file === "b.ts");
    expect(regenerated?.changeGroupId).toBe("g2");
    expect(regenerated?.addedRanges).toEqual([{ start: 1, end: 3 }]);
    expect(new Set(merged.chunks.map((c) => c.id)).size).toBe(2);

    expect(carriedGroupIds).toEqual(["g1"]);
    expect(regeneratedGroupIds).toEqual(["g2"]);
    expect(merged.anchoring).toEqual({
      carried: ["g1"],
      regenerated: ["g2"],
    });
  });

  it("recomputes concernView mechanically from the merged chunks", () => {
    const generated = brief(
      [group("tmpB", "beta v2")],
      [chunk("x2", "tmpB", "b.ts", 1, 3)],
      { concernView: [{ concern: "implementation", added: 999, deleted: 0 }] },
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // carried a.ts chunk: 4 added; generated b.ts chunk: 3 added.
    expect(result.value.brief.concernView).toEqual([
      { concern: "implementation", added: 7, deleted: 0 },
    ]);
  });

  it("maps references of a dropped generated group to its frozen parent", () => {
    // The model emitted a group over the FROZEN file; its definition is
    // discarded but intent references resolve to the carried group.
    const generated = brief(
      [group("tmpA", "alpha rewritten"), group("tmpB", "beta v2")],
      [chunk("x1", "tmpA", "a.ts", 5, 8), chunk("x2", "tmpB", "b.ts", 1, 3)],
      {
        intentCheck: {
          ticketUrls: [],
          specificity: "precise",
          scopeNote: "",
          accomplished: [
            {
              intent: "does alpha",
              quote: "alpha quote",
              sourceUrl: "",
              groupIds: ["tmpA"],
              acknowledged: false,
            },
          ],
          statedButMissing: [],
          doneButUnstated: [],
          deviations: [],
          claimedButUnachieved: [],
        },
      },
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.brief.intentCheck?.accomplished[0]?.groupIds).toEqual([
      "g1",
    ]);
  });

  it("drops an intent item whose groupIds all dangle after the rewrite", () => {
    const generated = brief(
      [group("tmpB", "beta v2")],
      [chunk("x2", "tmpB", "b.ts", 1, 3)],
      {
        intentCheck: {
          ticketUrls: [],
          specificity: "precise",
          scopeNote: "",
          accomplished: [
            {
              intent: "phantom",
              quote: "q",
              sourceUrl: "",
              groupIds: ["nonexistent"],
              acknowledged: false,
            },
          ],
          statedButMissing: [],
          doneButUnstated: [],
          deviations: [],
          claimedButUnachieved: [],
        },
      },
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.brief.intentCheck?.accomplished).toEqual([]);
  });

  it("drops a readingOrder that is no longer a permutation of the merged groups", () => {
    const generated = brief(
      [group("tmpA", "alpha rewritten"), group("tmpB", "beta v2")],
      [chunk("x1", "tmpA", "a.ts", 5, 8), chunk("x2", "tmpB", "b.ts", 1, 3)],
      {
        readingOrder: [
          { groupId: "tmpA", why: "first" },
          { groupId: "tmpB", why: "second" },
        ],
      },
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // tmpA maps to frozen g1, tmpB → g2 — a valid permutation SURVIVES.
    expect(result.value.brief.readingOrder).toEqual([
      { groupId: "g1", why: "first" },
      { groupId: "g2", why: "second" },
    ]);

    // But an order missing a merged group is dropped.
    const partial = stitchBrief({
      generated: {
        ...generated,
        readingOrder: [{ groupId: "tmpB", why: "only" }],
      },
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(partial.ok).toBe(true);
    if (!partial.ok) throw new Error("unreachable");
    expect(partial.value.brief.readingOrder).toBeUndefined();
  });

  it("fails coverage when a PR file lands in no group", () => {
    const generated = brief(
      [group("tmpB", "beta v2")],
      [chunk("x2", "tmpB", "b.ts", 1, 3)],
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts", "missing.ts"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toContain("missing.ts");
  });

  it("fails coverage when a PR file lands in two groups", () => {
    const generated = brief(
      [group("tmpB", "beta v2"), group("tmpC", "gamma")],
      [chunk("x2", "tmpB", "b.ts", 1, 3), chunk("x3", "tmpC", "b.ts", 10, 11)],
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toContain("b.ts");
  });

  it("reassigns colliding generated chunk ids while carried chunk ids win", () => {
    const generated = brief(
      [group("tmpB", "beta v2")],
      // Model reused the carried chunk's id "c1".
      [chunk("c1", "tmpB", "b.ts", 1, 3)],
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const ids = result.value.brief.chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    const carried = result.value.brief.chunks.find((c) => c.file === "a.ts");
    expect(carried?.id).toBe("c1");
  });
});
