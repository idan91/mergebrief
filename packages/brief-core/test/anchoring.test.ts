// Unit tests for the pure anchored-generation helpers:
// planAnchoredGeneration (partition + remap-as-invariant + shared-file
// exclusivity) and stitchBrief (carry + drop + id descent + references).
import { describe, expect, it } from "vitest";
import { planAnchoredGeneration, stitchBrief } from "../src/anchoring";
import type { AnchorPlan } from "../src/anchoring/types";
import { IDENTITY_SPAN, REST_OF_FILE_LINES } from "../src/diff/pr-span/consts";
import { buildPrSpan } from "../src/diff/pr-span";
import type { PrSpan } from "../src/diff/pr-span/types";
import { remapThroughHops } from "../src/diff/remap";
import type { Brief } from "../src/types";
import {
  insertAfter,
  makeBaseLines,
  makeDiff,
  makeFilePatch,
  makeText,
} from "./diff/pr-span/helpers";

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
    role: "core",
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

function makeSpan(fields: Partial<PrSpan>): PrSpan {
  return {
    changedFiles: [],
    unchangedFiles: [],
    unpairableFiles: [],
    filteredDiff: "",
    unfilteredDiff: "",
    hop: [],
    oldSideHop: [],
    isUnchanged: false,
    ...fields,
  };
}

const B_HUNK = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3 };

/** A push that changed the PR's change to b.ts and left a.ts's as it was. */
const SPAN_B = makeSpan({
  changedFiles: ["b.ts"],
  unchangedFiles: ["a.ts"],
  hop: [
    { file: "a.ts", hunks: [IDENTITY_SPAN] },
    { file: "b.ts", hunks: [B_HUNK] },
  ],
  oldSideHop: [
    { file: "a.ts", hunks: [IDENTITY_SPAN] },
    { file: "b.ts", hunks: [] },
  ],
});

/** A rebase that put two base lines above a.ts's PR run at line 5. */
const REBASED_A = makeSpan({
  unchangedFiles: ["a.ts"],
  hop: [
    {
      file: "a.ts",
      hunks: [
        { oldStart: 1, oldLines: 4, newStart: 1, newLines: 6 },
        {
          oldStart: 9,
          oldLines: REST_OF_FILE_LINES,
          newStart: 11,
          newLines: REST_OF_FILE_LINES,
        },
      ],
    },
  ],
  oldSideHop: [
    {
      file: "a.ts",
      hunks: [
        { oldStart: 1, oldLines: 3, newStart: 1, newLines: 5 },
        {
          oldStart: 5,
          oldLines: REST_OF_FILE_LINES,
          newStart: 7,
          newLines: REST_OF_FILE_LINES,
        },
      ],
    },
  ],
});

/**
 * f.ts's PR diff over the same head blob `ccccccc`: the PR adds `p` at
 * line 6 and, when `addsP2`, `p2` at line 10; otherwise the base holds `p2`.
 */
function makeReshapedPrDiff(blobIds: string, addsP2: boolean): string {
  const tail = addsP2 ? ["+p2"] : [];
  return [
    "diff --git a/f.ts b/f.ts",
    `index ${blobIds} 100644`,
    "--- a/f.ts",
    "+++ b/f.ts",
    `@@ -3,6 +3,${addsP2 ? 8 : 7} @@`,
    " b3",
    " b4",
    " b5",
    "+p",
    " b6",
    " b7",
    " b8",
    ...tail,
    "",
  ].join("\n");
}

describe("planAnchoredGeneration", () => {
  const previous = brief(
    [group("g1", "alpha"), group("g2", "beta")],
    [chunk("c1", "g1", "a.ts", 5, 8), chunk("c2", "g2", "b.ts", 1, 2)],
  );

  it("freezes groups whose PR change held and re-looks the rest", () => {
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      span: SPAN_B,
    });

    expect(plan.frozen.map((carry) => carry.group.id)).toEqual(["g1"]);
    expect(plan.reLook.map((entry) => entry.id)).toEqual(["g2"]);
    expect(plan.reLook[0]?.reason).toContain("b.ts");
    expect(plan.frozen[0]?.chunks[0]?.addedRanges).toEqual([
      { start: 5, end: 8 },
    ]);
  });

  it("re-looks every group when the span could not be read", () => {
    const plan = planAnchoredGeneration({ previousBrief: previous });

    expect(plan.frozen).toEqual([]);
    expect(plan.reLook.map((entry) => entry.reason)).toEqual([
      "the revision span could not be read",
      "the revision span could not be read",
    ]);
    expect(plan.hunkSpans).toBeUndefined();
  });

  it("forces groups sharing a file to re-look", () => {
    const shared = brief(
      [group("g1", "alpha"), group("g2", "beta"), group("g3", "gamma")],
      [
        chunk("c1", "g1", "a.ts", 1, 2),
        chunk("c2", "g2", "a.ts", 10, 12),
        chunk("c3", "g3", "z.ts", 1, 2),
      ],
    );
    const identityHop = [
      { file: "a.ts", hunks: [IDENTITY_SPAN] },
      { file: "z.ts", hunks: [IDENTITY_SPAN] },
    ];
    const span = makeSpan({
      unchangedFiles: ["a.ts", "z.ts"],
      hop: identityHop,
      oldSideHop: identityHop,
    });

    const plan = planAnchoredGeneration({ previousBrief: shared, span });

    expect(plan.frozen.map((carry) => carry.group.id)).toEqual(["g3"]);
    expect(plan.reLook.map((entry) => entry.id).toSorted()).toEqual([
      "g1",
      "g2",
    ]);
  });

  it("carries a run's range across a rebase by its exact offset", () => {
    const onRun = brief(
      [group("g1", "alpha")],
      [chunk("c1", "g1", "a.ts", 5, 8)],
    );

    const plan = planAnchoredGeneration({
      previousBrief: onRun,
      span: REBASED_A,
    });

    expect(plan.frozen[0]?.chunks[0]?.addedRanges).toEqual([
      { start: 7, end: 10 },
    ]);
  });

  it("re-looks a range on base lines a rebase moved", () => {
    const onStretch = brief(
      [group("g1", "alpha")],
      [chunk("c1", "g1", "a.ts", 2, 3)],
    );

    const plan = planAnchoredGeneration({
      previousBrief: onStretch,
      span: REBASED_A,
    });

    expect(plan.frozen).toEqual([]);
    expect(plan.reLook[0]?.reason).toContain("range remap ambiguous");
  });

  it("moves a removed range with the base under it", () => {
    const removing = {
      ...chunk("c1", "g1", "a.ts", 5, 8),
      removedRanges: [{ start: 4, end: 4 }],
    };
    const previousBrief = brief([group("g1", "alpha")], [removing]);

    const plan = planAnchoredGeneration({ previousBrief, span: REBASED_A });

    expect(plan.frozen[0]?.chunks[0]?.removedRanges).toEqual([
      { start: 6, end: 6 },
    ]);
  });

  it("re-looks a removed range the old side cannot place", () => {
    const removing = {
      ...chunk("c1", "g1", "a.ts", 5, 8),
      removedRanges: [{ start: 4, end: 4 }],
    };
    const previousBrief = brief([group("g1", "alpha")], [removing]);
    const span = { ...REBASED_A, oldSideHop: [{ file: "a.ts", hunks: [] }] };

    const plan = planAnchoredGeneration({ previousBrief, span });

    expect(plan.frozen).toEqual([]);
    expect(plan.reLook[0]?.reason).toContain(
      "a.ts: no span pairs the PR's change",
    );
  });

  it("re-looks the owner of an unchanged file no span can pair", () => {
    const span = makeSpan({
      unchangedFiles: ["a.ts"],
      unpairableFiles: ["a.ts"],
      hop: [{ file: "a.ts", hunks: [] }],
      oldSideHop: [{ file: "a.ts", hunks: [IDENTITY_SPAN] }],
    });
    const onA = brief(
      [group("g1", "alpha")],
      [chunk("c1", "g1", "a.ts", 5, 8)],
    );

    const plan = planAnchoredGeneration({ previousBrief: onA, span });

    expect(plan.frozen).toEqual([]);
    expect(plan.reLook[0]?.reason).toContain("no span pairs a.ts");
  });

  it("re-looks a group whose added lines a rebase moved into the base", () => {
    const base = makeBaseLines(9);
    const head = insertAfter(insertAfter(base, "b5", ["p"]), "b8", ["p2"]);
    const baseWithP2 = insertAfter(base, "b8", ["p2"]);
    const span = buildPrSpan({
      prevPrDiff: makeDiff([
        makeFilePatch({
          path: "f.ts",
          base: makeText(base),
          head: makeText(head),
        }),
      ]),
      newPrDiff: makeDiff([
        makeFilePatch({
          path: "f.ts",
          base: makeText(baseWithP2),
          head: makeText(head),
        }),
      ]),
      betweenHeads: new Map(),
    });
    const onF = brief(
      [group("g1", "alpha")],
      [chunk("c1", "g1", "f.ts", 6, 6), chunk("c2", "g1", "f.ts", 10, 10)],
    );

    const plan = planAnchoredGeneration({ previousBrief: onF, span });

    expect(plan.frozen).toEqual([]);
    expect(plan.reLook.map((entry) => entry.id)).toEqual(["g1"]);
  });

  it.each([
    {
      title: "the base took p2",
      prev: { ids: "aaaaaaa..ccccccc", addsP2: true },
      next: { ids: "bbbbbbb..ccccccc", addsP2: false },
      ranges: [6, 10],
    },
    {
      title: "the base gave p2 back",
      prev: { ids: "bbbbbbb..ccccccc", addsP2: false },
      next: { ids: "aaaaaaa..ccccccc", addsP2: true },
      ranges: [6],
    },
  ])("re-looks, never carries, f.ts's group when $title", (row) => {
    const span = buildPrSpan({
      prevPrDiff: makeReshapedPrDiff(row.prev.ids, row.prev.addsP2),
      newPrDiff: makeReshapedPrDiff(row.next.ids, row.next.addsP2),
      betweenHeads: new Map(),
    });
    const onF = brief(
      [group("g1", "alpha")],
      row.ranges.map((line, index) =>
        chunk(`c${index}`, "g1", "f.ts", line, line),
      ),
    );

    const plan = planAnchoredGeneration({ previousBrief: onF, span });

    expect(span.changedFiles).toEqual(["f.ts"]);
    expect(plan.frozen).toEqual([]);
    expect(plan.reLook.map((entry) => entry.id)).toEqual(["g1"]);
  });

  it("re-looks a group whose file left the PR", () => {
    const span = makeSpan({
      changedFiles: ["a.ts"],
      hop: [{ file: "a.ts", hunks: [B_HUNK] }],
    });
    const onA = brief(
      [group("g1", "alpha")],
      [chunk("c1", "g1", "a.ts", 5, 8)],
    );

    const plan = planAnchoredGeneration({ previousBrief: onA, span });

    expect(plan.reLook.map((entry) => entry.id)).toEqual(["g1"]);
  });
});

describe("planAnchoredGeneration, the durable hop", () => {
  const previous = brief(
    [group("g1", "alpha"), group("g2", "beta")],
    [chunk("c1", "g1", "a.ts", 5, 8), chunk("c2", "g2", "b.ts", 1, 2)],
  );

  it("writes the span's hop whatever re-looks", () => {
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      span: SPAN_B,
    });

    expect(plan.hunkSpans).toBe(SPAN_B.hop);
  });

  it("demotes an anchor on a renamed-away path even if re-added", () => {
    const span = makeSpan({
      changedFiles: ["a.ts", "new.ts"],
      hop: [{ file: "a.ts", hunks: [] }],
    });

    const plan = planAnchoredGeneration({ previousBrief: previous, span });

    expect(
      remapThroughHops("a.ts", [{ start: 5, end: 8 }], [plan.hunkSpans]),
    ).toMatchObject({ outcome: "demoted" });
  });
});

describe("planAnchoredGeneration, chain id reservation", () => {
  const previous = brief(
    [group("g1", "alpha"), group("g2", "beta")],
    [chunk("c1", "g1", "a.ts", 5, 8), chunk("c2", "g2", "b.ts", 1, 2)],
  );

  it("folds chain ids into previousGroupIds, deduped", () => {
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      span: SPAN_B,
      chainGroupIds: ["g2", "g9"],
    });
    expect(plan.previousGroupIds).toEqual(["g1", "g2", "g9"]);
  });

  it("keeps chain ids reserved on a full re-look", () => {
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      chainGroupIds: ["g9"],
    });
    expect(plan.previousGroupIds).toEqual(["g1", "g2", "g9"]);
  });
});

describe("stitchBrief, chain id reservation", () => {
  it("never re-mints an id the chain retired", () => {
    // g3 was minted at an earlier revision and retired since: absent from the
    // previous brief, present in the chain. A brand-new group must skip it.
    const previous = brief(
      [group("g1", "alpha"), group("g2", "beta")],
      [chunk("c1", "g1", "a.ts", 5, 8), chunk("c2", "g2", "b.ts", 1, 2)],
    );
    const plan = planAnchoredGeneration({
      previousBrief: previous,
      span: SPAN_B,
      chainGroupIds: ["g1", "g2", "g3"],
    });
    const generated = brief(
      [group("tmpB", "beta v2"), group("tmpZ", "brand new")],
      [chunk("x2", "tmpB", "b.ts", 1, 3), chunk("x3", "tmpZ", "z.ts", 1, 2)],
    );
    const result = stitchBrief({
      generated,
      plan,
      prFiles: ["a.ts", "b.ts", "z.ts"],
    });
    const ids = result.brief.changeGroups.map((g) => g.id).toSorted();
    expect(ids).toEqual(["g1", "g2", "g4"]);
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
      span: SPAN_B,
    });
  }

  it("carries frozen groups verbatim and rewrites ids by descent", () => {
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
    const { brief: merged, carriedGroupIds, regeneratedGroupIds } = result;

    // Frozen g1 carried VERBATIM; the model's rewrite is discarded.
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

  it("maps references of a dropped generated group to its frozen parent", () => {
    // The model emitted a group over the FROZEN file; its definition is
    // discarded but intent references resolve to the carried group.
    const generated = brief(
      [group("tmpA", "alpha rewritten"), group("tmpB", "beta v2")],
      [chunk("x1", "tmpA", "a.ts", 5, 8), chunk("x2", "tmpB", "b.ts", 1, 3)],
      {
        intentCheck: {
          ticketUrls: [],
          ticketTitles: [],
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
          maskedFixes: [],
        },
      },
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.brief.intentCheck?.accomplished[0]?.groupIds).toEqual(["g1"]);
  });

  it("leaves a dangling intent group id to the final pass", () => {
    const generated = brief(
      [group("tmpB", "beta v2")],
      [chunk("x2", "tmpB", "b.ts", 1, 3)],
      {
        intentCheck: {
          ticketUrls: [],
          ticketTitles: [],
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
          maskedFixes: [],
        },
      },
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.brief.intentCheck?.accomplished[0]?.groupIds).toEqual([
      "nonexistent",
    ]);
  });

  it("re-points reading order ids and leaves the permutation check", () => {
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
    // tmpA maps to frozen g1 and tmpB to g2, a valid permutation, SURVIVES.
    expect(result.brief.readingOrder).toEqual([
      { groupId: "g1", why: "first" },
      { groupId: "g2", why: "second" },
    ]);

    // An order missing a merged group is re-pointed, not judged.
    const partial = stitchBrief({
      generated: {
        ...generated,
        readingOrder: [{ groupId: "tmpB", why: "only" }],
      },
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(partial.brief.readingOrder).toEqual([
      { groupId: "g2", why: "only" },
    ]);
  });

  it("keeps a PR file split across two groups", () => {
    const generated = brief(
      [group("tmpB", "beta v2"), group("tmpC", "gamma")],
      [chunk("x2", "tmpB", "b.ts", 1, 3), chunk("x3", "tmpC", "b.ts", 10, 11)],
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    const owners = result.brief.chunks
      .filter((row) => row.file === "b.ts")
      .map((row) => row.changeGroupId);
    expect(new Set(owners).size).toBe(2);
  });

  it("a claimed frozen id unfreezes the group and cancels the carry", () => {
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
    const merged = result.brief;
    const g1 = merged.changeGroups.find((g) => g.id === "g1");
    expect(g1?.title).toBe("alpha with gamma");
    expect(
      merged.chunks
        .filter((c) => c.changeGroupId === "g1")
        .map((c) => c.file)
        .toSorted(),
    ).toEqual(["a.ts", "c.ts"]);
    // Claimed = re-examined, not carried.
    expect(result.carriedGroupIds).toEqual([]);
    expect(result.regeneratedGroupIds.toSorted()).toEqual(["g1", "g2"]);
    expect(result.issues.some((w) => w.includes("claimed"))).toBe(true);
  });

  it("a frozen-id reuse without its files is a slip, not a claim", () => {
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
    const merged = result.brief;
    // The carried g1 (alpha, a.ts) survives untouched.
    const g1 = merged.changeGroups.find((g) => g.id === "g1");
    expect(g1?.title).toBe("alpha");
    // The slip group lives on under a fresh minted id.
    const renamed = merged.changeGroups.find(
      (g) => g.title === "unrelated new work",
    );
    expect(renamed).toBeDefined();
    expect(renamed?.id).not.toBe("g1");
    expect(result.carriedGroupIds).toEqual(["g1"]);
    expect(result.issues.some((w) => w.includes("numbering slip"))).toBe(true);
  });

  it("a frozen-id re-emission with only its own files keeps the carry", () => {
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
    const merged = result.brief;
    const g1 = merged.changeGroups.find((g) => g.id === "g1");
    expect(g1?.title).toBe("alpha");
    expect(result.carriedGroupIds).toEqual(["g1"]);
    expect(
      merged.changeGroups.find((g) => g.title === "alpha drifted"),
    ).toBeUndefined();
    expect(result.issues.some((w) => w.includes("without a new file"))).toBe(
      true,
    );
  });

  it("scrubs chunks on files outside the PR and drops emptied groups", () => {
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
    const merged = result.brief;
    expect(merged.chunks.every((c) => c.file !== "departed.ts")).toBe(true);
    expect(
      merged.changeGroups.find((g) => g.title === "ghost of departed work"),
    ).toBeUndefined();
    expect(result.issues.some((w) => w.includes("departed.ts"))).toBe(true);
  });

  it("a departed-file chunk cannot serve as claim evidence", () => {
    // The model claims frozen g1 with its old file plus a departed file,
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
    expect(result.carriedGroupIds).toEqual(["g1"]);
    expect(
      result.brief.changeGroups.find((g) => g.title === "alpha stretched"),
    ).toBeUndefined();
  });

  it("another frozen group's file is not claim evidence", () => {
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
    const span = {
      ...SPAN_B,
      unchangedFiles: ["a.ts", "c.ts"],
      hop: [...SPAN_B.hop, { file: "c.ts", hunks: [IDENTITY_SPAN] }],
      oldSideHop: [
        ...SPAN_B.oldSideHop,
        { file: "c.ts", hunks: [IDENTITY_SPAN] },
      ],
    };
    const plan = planAnchoredGeneration({ previousBrief: previous3, span });
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
    expect(result.carriedGroupIds.toSorted()).toEqual(["g1", "g3"]);
    const merged = result.brief;
    expect(merged.changeGroups.find((g) => g.id === "g1")?.title).toBe("alpha");
    expect(merged.changeGroups.find((g) => g.id === "g3")?.title).toBe("gamma");
    expect(
      merged.changeGroups.find((g) => g.title === "alpha and gamma mashed"),
    ).toBeUndefined();
  });
});

describe("stitchBrief, the carried chunk set", () => {
  const previous = brief(
    [group("g1", "alpha"), group("g2", "beta")],
    [chunk("c1", "g1", "a.ts", 5, 8), chunk("c2", "g2", "b.ts", 1, 2)],
  );

  function planFor(): AnchorPlan {
    return planAnchoredGeneration({
      previousBrief: previous,
      span: SPAN_B,
    });
  }

  it("reports exactly the chunks that carried, not the re-minted ones", () => {
    // The model re-emits b.ts under a colliding chunk id: the mint moves it,
    // and a carried set naming it would mark unopened code as read.
    const generated = brief(
      [group("tmpB", "beta v2")],
      [chunk("c1", "tmpB", "b.ts", 1, 3)],
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts"],
    });
    expect(result.carriedChunkIds).toEqual(["c1"]);
    const carriedChunk = result.brief.chunks.find((c) => c.id === "c1");
    expect(carriedChunk?.file).toBe("a.ts");
    expect(result.brief.chunks.find((c) => c.file === "b.ts")?.id).not.toBe(
      "c1",
    );
  });

  it("is empty when a claim cancels the only carry", () => {
    // A claimed group unfreezes: its chunks are the model's, not carried.
    const generated = brief(
      [group("g1", "alpha claimed"), group("tmpB", "beta v2")],
      [
        chunk("x1", "g1", "a.ts", 5, 8),
        chunk("x3", "g1", "b.ts", 1, 3),
        chunk("x2", "tmpB", "z.ts", 1, 2),
      ],
    );
    const result = stitchBrief({
      generated,
      plan: planFor(),
      prFiles: ["a.ts", "b.ts", "z.ts"],
    });
    expect(result.carriedGroupIds).toEqual([]);
    expect(result.carriedChunkIds).toEqual([]);
  });
});
