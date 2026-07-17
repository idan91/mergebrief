import { describe, expect, it } from "vitest";

import type { Brief } from "./types";
import { parseBrief } from "./validation";
import { buildBriefViewModel, riskChipView } from "./viewModel";

function twoGroupBrief(readingOrder?: unknown) {
  return {
    pr: {
      repo: "Idan91/components",
      number: 5,
      title: "feat: Add schema and call sites",
      url: "https://github.com/Idan91/components/pull/5",
      sha: "b02bcf1db649b18404dddc9d61b9dd1b3cc75dfd",
      description: "Adds schema and wires it up.",
    },
    summary: "Adds schema and wires it up.",
    changeGroups: [
      {
        id: "g1",
        title: "Call sites",
        summary: "Wires the new schema into call sites.",
        dominantCategory: "logic-refactor",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
      {
        id: "g2",
        title: "Schema",
        summary: "Adds the schema types.",
        dominantCategory: "schema-change",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks: [
      {
        id: "c1",
        changeGroupId: "g1",
        file: "src/consumer.ts",
        concern: "implementation",
        role: "carrier",
        loc: { added: 4, deleted: 1 },
        addedRanges: [{ start: 1, end: 4 }],
        removedRanges: [{ start: 1, end: 1 }],
        riskSurface: [],
      },
      {
        id: "c2",
        changeGroupId: "g2",
        file: "src/schema.ts",
        concern: "implementation",
        role: "carrier",
        loc: { added: 6, deleted: 0 },
        addedRanges: [{ start: 1, end: 6 }],
        removedRanges: [],
        riskSurface: [],
      },
    ],
    concernView: [{ concern: "implementation", added: 10, deleted: 1 }],
    ...(readingOrder !== undefined ? { readingOrder } : {}),
  };
}

describe("riskChipView", () => {
  it("shows all attributes as chips when there are two or fewer", () => {
    expect(riskChipView([])).toEqual({ shown: [], overflow: [] });
    expect(riskChipView(["no-tests"])).toEqual({
      shown: ["no-tests"],
      overflow: [],
    });
    expect(riskChipView(["no-tests", "dense-logic"])).toEqual({
      shown: ["no-tests", "dense-logic"],
      overflow: [],
    });
  });

  it("folds attributes beyond the second into the overflow chip", () => {
    expect(
      riskChipView([
        "dense-logic",
        "mutates-state",
        "comment-contradicts-code",
        "new-abstraction",
      ]),
    ).toEqual({
      shown: ["dense-logic", "mutates-state"],
      overflow: ["comment-contradicts-code", "new-abstraction"],
    });
  });
});

describe("buildBriefViewModel", () => {
  it("groups chunks by chunk.changeGroupId and derives carrier/supporting buckets", () => {
    const parsed = parseBrief({
      pr: {
        repo: "Idan91/components",
        number: 4,
        title: "feat: Add Accordion And Collapsible Components",
        url: "https://github.com/Idan91/components/pull/4",
        sha: "a01bcf1db649b18404dddc9d61b9dd1b3cc75dfd",
        description: "Adds accordion and collapsible components.",
      },
      summary: "Adds accordion and collapsible components.",
      changeGroups: [
        {
          id: "g1",
          title: "Typed state",
          summary: "Adds typed state constants.",
          dominantCategory: "logic-refactor",
          secondaryCategories: [],
          uncertain: false,
          uncertainBetween: [],
        },
      ],
      chunks: [
        {
          id: "c1",
          changeGroupId: "g1",
          file: "src/component.tsx",
          concern: "implementation",
          role: "carrier",
          loc: { added: 4, deleted: 1 },
          addedRanges: [{ start: 1, end: 4 }],
          removedRanges: [{ start: 1, end: 1 }],
          riskSurface: ["dense-logic"],
        },
        {
          id: "c2",
          changeGroupId: "g1",
          file: "src/component.test.tsx",
          concern: "test",
          role: "supporting",
          loc: { added: 8, deleted: 0 },
          addedRanges: [{ start: 1, end: 8 }],
          removedRanges: [],
          riskSurface: [],
        },
      ],
      concernView: [
        { concern: "implementation", added: 4, deleted: 1 },
        { concern: "test", added: 8, deleted: 0 },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const model = buildBriefViewModel(parsed.value);

    expect(model.groups[0]?.chunks.map((chunk) => chunk.id)).toEqual([
      "c1",
      "c2",
    ]);
    expect(model.groups[0]?.carrierChunks.map((chunk) => chunk.id)).toEqual([
      "c1",
    ]);
    expect(model.groups[0]?.supportingChunks.map((chunk) => chunk.id)).toEqual([
      "c2",
    ]);
    expect(model.chunkToGroup.get("c1")).toBe("g1");
    expect(model.flags[0]?.groupId).toBe("g1");
  });

  it("falls back to source order when the Brief has no readingOrder", () => {
    const parsed = parseBrief(twoGroupBrief());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const model = buildBriefViewModel(parsed.value);

    expect(model.groups.map((group) => group.id)).toEqual(["g1", "g2"]);
    expect(model.groups.map((group) => group.readingOrderStep)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("orders groups by a valid readingOrder and attaches step index + why-line", () => {
    const parsed = parseBrief(
      twoGroupBrief([
        { groupId: "g2", why: "establishes the schema the rest builds on" },
        { groupId: "g1", why: "wires the schema into call sites" },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const model = buildBriefViewModel(parsed.value);

    expect(model.groups.map((group) => group.id)).toEqual(["g2", "g1"]);
    expect(model.groups.map((group) => group.readingOrderStep)).toEqual([1, 2]);
    expect(model.groups.map((group) => group.readingOrderWhy)).toEqual([
      "establishes the schema the rest builds on",
      "wires the schema into call sites",
    ]);
    expect(model.groups.map((group) => group.index)).toEqual([0, 1]);
  });

  it("threads a chunk's riskNotes entry onto the matching flag", () => {
    const base = twoGroupBrief();
    const parsed = parseBrief({
      ...base,
      chunks: [
        {
          ...base.chunks[0],
          riskSurface: ["comment-contradicts-code", "no-tests"],
          riskNotes: [
            {
              attr: "comment-contradicts-code",
              note: "comment says X (L12), code does Y (L15)",
            },
          ],
        },
        base.chunks[1],
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const model = buildBriefViewModel(parsed.value);

    const withNote = model.flags.find(
      (flag) => flag.attr === "comment-contradicts-code",
    );
    expect(withNote?.note).toBe("comment says X (L12), code does Y (L15)");
    const withoutNote = model.flags.find((flag) => flag.attr === "no-tests");
    expect(withoutNote).toBeDefined();
    expect(withoutNote?.note).toBeUndefined();
  });

  it("builds a note-less flag for a trio attribute without riskNotes", () => {
    const base = twoGroupBrief();
    const parsed = parseBrief({
      ...base,
      chunks: [
        base.chunks[0],
        { ...base.chunks[1], riskSurface: ["new-abstraction"] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const model = buildBriefViewModel(parsed.value);

    const flag = model.flags.find((f) => f.attr === "new-abstraction");
    expect(flag).toBeDefined();
    expect(flag?.note).toBeUndefined();
    expect(flag?.description.length).toBeGreaterThan(0);
  });

  it("falls back to source order when readingOrder is not a valid permutation, even bypassing the parser", () => {
    // Exercises the viewModel's own defensive re-check (validation.ts already
    // drops an invalid readingOrder at the parse boundary — this covers a
    // Brief constructed outside that parser, e.g. fixtures or partial mocks).
    const invalid: Brief = {
      ...(parseBrief(twoGroupBrief()) as { ok: true; value: Brief }).value,
      readingOrder: [
        { groupId: "g2", why: "only one step, not a permutation" },
      ],
    };

    const model = buildBriefViewModel(invalid);

    expect(model.groups.map((group) => group.id)).toEqual(["g1", "g2"]);
    expect(
      model.groups.every((group) => group.readingOrderStep === undefined),
    ).toBe(true);
  });
});

describe("buildBriefViewModel — repo-config display weight (BRIEF-52)", () => {
  function briefWithRisk() {
    const base = twoGroupBrief();
    // The fixture's empty arrays infer never[]; push through a typed view.
    const chunks: { riskSurface: string[] }[] = base.chunks;
    chunks[0]?.riskSurface.push("touches-billing", "widens-error-handling");
    chunks[1]?.riskSurface.push("touches-auth", "widens-error-handling");
    const parsed = parseBrief(base);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.value;
  }

  const snapshot = {
    files: [],
    collisions: [],
    policy: {
      firedCustomAttributes: [
        {
          name: "touches-billing",
          criteria: "modifies invoicing code",
          implication: "needs finance review",
        },
      ],
      deEmphasize: [{ attribute: "widens-error-handling" }],
    },
  };

  it("marks sources, quiets de-emphasized firings, and un-quiets on floor co-fire", () => {
    const model = buildBriefViewModel(briefWithRisk(), snapshot);

    const billing = model.flags.find((f) => f.attr === "touches-billing");
    expect(billing?.source).toBe("repo-policy");
    expect(billing?.implication).toBe("needs finance review");
    expect(billing?.description).toContain("modifies invoicing code");

    // c1 has no floor attribute → its widens-error-handling firing is quiet.
    const quiet = model.flags.find(
      (f) => f.attr === "widens-error-handling" && f.chunkId === "c1",
    );
    expect(quiet?.deEmphasized).toBe(true);
    // c2 co-fires touches-auth (floor) → the same attribute renders loud there.
    const loud = model.flags.find(
      (f) => f.attr === "widens-error-handling" && f.chunkId === "c2",
    );
    expect(loud?.deEmphasized).toBe(false);
    // Floor attribute itself is never quiet.
    expect(
      model.flags.find((f) => f.attr === "touches-auth")?.deEmphasized,
    ).toBe(false);
  });

  it("group header union: floor first, fully-quiet attributes collapse, loud firings keep a chip", () => {
    const model = buildBriefViewModel(briefWithRisk(), snapshot);
    const byId = new Map(model.groups.map((g) => [g.id, g]));

    // g1 (c1 only): billing loud, widens-error-handling fully quiet → +n bucket.
    expect(byId.get("g1")?.headerRisk.shown).toEqual(["touches-billing"]);
    expect(byId.get("g1")?.headerRisk.deEmphasized).toEqual([
      "widens-error-handling",
    ]);

    // g2 (c2): touches-auth is floor → pinned first; widens-error-handling is
    // loud there (co-fire) → stays a chip.
    expect(byId.get("g2")?.headerRisk.shown).toEqual([
      "touches-auth",
      "widens-error-handling",
    ]);
    expect(byId.get("g2")?.headerRisk.deEmphasized).toEqual([]);
  });

  it("without a snapshot everything is a plain built-in loud chip (back-compat)", () => {
    const model = buildBriefViewModel(briefWithRisk());
    expect(
      model.flags.every((f) => f.source === "built-in" && !f.deEmphasized),
    ).toBe(true);
    const g1 = model.groups.find((g) => g.id === "g1");
    expect(g1?.headerRisk.deEmphasized).toEqual([]);
    expect(g1?.headerRisk.shown).toEqual([
      "touches-billing",
      "widens-error-handling",
    ]);
  });
});
