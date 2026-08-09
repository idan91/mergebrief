// Unit tests for the pure anchored-generation helpers:
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
    // The model, unaware of freezing, re-emitted BOTH regions.
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

  it("recomputes the text length floor over the MERGED artifact", () => {
    // The CARRIED group's summary is over-cap — categorize() never saw it,
    // so only the merged-artifact recompute can stamp it.
    const verbosePrevious = brief(
      [
        { ...group("g1", "alpha"), summary: "v".repeat(300) },
        group("g2", "beta"),
      ],
      [chunk("c1", "g1", "a.ts", 5, 8), chunk("c2", "g2", "b.ts", 1, 2)],
    );
    const plan = planAnchoredGeneration({
      previousBrief: verbosePrevious,
      incrementalDiff: DIFF_B,
      compareFiles: COMPARE_B,
      baseShaMoved: false,
    });
    const generated = brief(
      [group("tmpB", "beta v2")],
      [chunk("x2", "tmpB", "b.ts", 1, 3)],
      // A stale stamp + warning line from the partial (re-emitted-only)
      // categorize() view: the recompute must replace both, never union.
      {
        lengthViolations: [
          {
            surface: "group-summary",
            field: "group tmpB summary",
            actual: 999,
            cap: 250,
          },
        ],
        generationWarnings: [
          "⚠ text length issues: group tmpB summary is 999 chars — exceeds the 250-char cap",
          "⚠ risk attrs issues: unrelated line survives",
        ],
      },
    );
    const result = stitchBrief({ generated, plan, prFiles: ["a.ts", "b.ts"] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.brief.lengthViolations).toEqual([
      {
        surface: "group-summary",
        field: "group g1 summary",
        actual: 300,
        cap: 250,
      },
    ]);
    const warningText = result.value.brief.generationWarnings?.join("\n");
    expect(warningText).toContain(
      "anchored stitch: group g1 summary is 300 chars",
    );
    // categorize()'s tmp-id text-length line is filtered; other warnings survive.
    expect(warningText).not.toContain("tmpB");
    expect(warningText).toContain("risk attrs issues");
  });

  it("drops a stale lengthViolations stamp when the merged artifact fits", () => {
    const generated = brief(
      [group("tmpB", "beta v2")],
      [chunk("x2", "tmpB", "b.ts", 1, 3)],
      {
        lengthViolations: [
          {
            surface: "group-summary",
            field: "group tmpB summary",
            actual: 999,
            cap: 250,
          },
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
    expect("lengthViolations" in result.value.brief).toBe(false);
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

  it("a claimed frozen id unfreezes the group — model version wins, carry cancelled", () => {
    // The model claimed frozen g1 (new file c.ts belongs to it) and
    // re-emitted it fully, alongside its re-look take on g2.
    const generated = brief(
      [group("g1", "alpha with gamma"), group("tmpB", "beta v2")],
      [
        chunk("x1", "g1", "a.ts", 5, 8),
        chunk("x2", "g1", "c.ts", 1, 4),
        chunk("x3", "tmpB", "b.ts", 1, 3),
      ],
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts", "c.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const merged = result.value.brief;
    const g1 = merged.changeGroups.find((g) => g.id === "g1");
    expect(g1?.title).toBe("alpha with gamma");
    expect(
      merged.chunks
        .filter((c) => c.changeGroupId === "g1")
        .map((c) => c.file)
        .toSorted(),
    ).toEqual(["a.ts", "c.ts"]);
    // Claimed = re-examined, not carried.
    expect(result.value.carriedGroupIds).toEqual([]);
    expect(result.value.regeneratedGroupIds.toSorted()).toEqual(["g1", "g2"]);
    expect(merged.generationWarnings?.some((w) => w.includes("claimed"))).toBe(
      true,
    );
  });

  it("a frozen-id reuse WITHOUT the group's files is a numbering slip, not a claim", () => {
    // The model reused frozen id g1 for an unrelated all-new file: the carry
    // survives and the slip is renamed by descent.
    const generated = brief(
      [group("g1", "unrelated new work"), group("tmpB", "beta v2")],
      [chunk("x1", "g1", "new.ts", 1, 4), chunk("x2", "tmpB", "b.ts", 1, 3)],
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts", "new.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const merged = result.value.brief;
    // The carried g1 (alpha, a.ts) survives untouched.
    const g1 = merged.changeGroups.find((g) => g.id === "g1");
    expect(g1?.title).toBe("alpha");
    // The slip group lives on under a fresh minted id.
    const renamed = merged.changeGroups.find(
      (g) => g.title === "unrelated new work",
    );
    expect(renamed).toBeDefined();
    expect(renamed?.id).not.toBe("g1");
    expect(result.value.carriedGroupIds).toEqual(["g1"]);
    expect(
      merged.generationWarnings?.some((w) => w.includes("numbering slip")),
    ).toBe(true);
  });

  it("a frozen-id re-emission with ONLY its own files is not a claim — the carry survives", () => {
    // The model re-emitted frozen g1 with just its previous file. Nothing in
    // the re-look diff touches a.ts, so the "claim" carries no evidence and
    // must not cancel the carry.
    const generated = brief(
      [group("g1", "alpha drifted"), group("tmpB", "beta v2")],
      [chunk("x1", "g1", "a.ts", 5, 8), chunk("x2", "tmpB", "b.ts", 1, 3)],
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const merged = result.value.brief;
    const g1 = merged.changeGroups.find((g) => g.id === "g1");
    expect(g1?.title).toBe("alpha");
    expect(result.value.carriedGroupIds).toEqual(["g1"]);
    expect(
      merged.changeGroups.find((g) => g.title === "alpha drifted"),
    ).toBeUndefined();
    expect(
      merged.generationWarnings?.some((w) => w.includes("without a new file")),
    ).toBe(true);
  });

  it("scrubs generated chunks on files outside the PR and drops groups they empty", () => {
    // The revision reverted a file out of the PR, but the model kept
    // narrating it from the anchor brief.
    const generated = brief(
      [group("tmpB", "beta v2"), group("tmpC", "ghost of departed work")],
      [
        chunk("x2", "tmpB", "b.ts", 1, 3),
        chunk("x3", "tmpC", "departed.ts", 1, 4),
      ],
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const merged = result.value.brief;
    expect(merged.chunks.every((c) => c.file !== "departed.ts")).toBe(true);
    expect(
      merged.changeGroups.find((g) => g.title === "ghost of departed work"),
    ).toBeUndefined();
    expect(
      merged.generationWarnings?.some((w) => w.includes("departed.ts")),
    ).toBe(true);
  });

  it("a departed-file chunk cannot serve as claim evidence", () => {
    // The model claims frozen g1 with its old file plus a departed file —
    // after the scrub the claim has no new evidence, so the carry survives.
    const generated = brief(
      [group("g1", "alpha stretched"), group("tmpB", "beta v2")],
      [
        chunk("x1", "g1", "a.ts", 5, 8),
        chunk("x2", "g1", "departed.ts", 1, 4),
        chunk("x3", "tmpB", "b.ts", 1, 3),
      ],
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.carriedGroupIds).toEqual(["g1"]);
    expect(
      result.value.brief.changeGroups.find(
        (g) => g.title === "alpha stretched",
      ),
    ).toBeUndefined();
  });

  it("another frozen group's file is not claim evidence — both carries survive", () => {
    // The model merges two frozen groups into one re-emission under g1. No
    // frozen file can be evidence (the re-look diff never touches them), so
    // the claim is rejected and both carries stay verbatim.
    const previous3 = brief(
      [group("g1", "alpha"), group("g2", "beta"), group("g3", "gamma")],
      [
        chunk("c1", "g1", "a.ts", 5, 8),
        chunk("c2", "g2", "b.ts", 1, 2),
        chunk("c3", "g3", "c.ts", 1, 2),
      ],
    );
    const plan = planAnchoredGeneration({
      previousBrief: previous3,
      incrementalDiff: DIFF_B,
      compareFiles: COMPARE_B,
      baseShaMoved: false,
    });
    expect(plan.frozen.map((f) => f.group.id)).toEqual(["g1", "g3"]);
    const generated = brief(
      [group("g1", "alpha and gamma mashed"), group("tmpB", "beta v2")],
      [
        chunk("x1", "g1", "a.ts", 5, 8),
        chunk("x2", "g1", "c.ts", 1, 2),
        chunk("x3", "tmpB", "b.ts", 1, 3),
      ],
    );
    const result = stitchBrief({
      generated,
      plan,
      prFiles: ["a.ts", "b.ts", "c.ts"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.carriedGroupIds.toSorted()).toEqual(["g1", "g3"]);
    const merged = result.value.brief;
    expect(merged.changeGroups.find((g) => g.id === "g1")?.title).toBe("alpha");
    expect(merged.changeGroups.find((g) => g.id === "g3")?.title).toBe("gamma");
    expect(
      merged.changeGroups.find((g) => g.title === "alpha and gamma mashed"),
    ).toBeUndefined();
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
