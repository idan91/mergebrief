import { describe, expect, it } from "vitest";

import { ChangeGroupCategories } from "types";
import { appI18n } from "../../../../i18n/I18nProvider";
import { type Brief } from "../types";
import { GroupViewKinds } from "./remainder";
import { parseBrief } from "./validation";
import {
  buildAttributeRail,
  buildBriefViewModel,
  getCategoryLabel,
  isAttributedGroupView,
  riskChipView,
  type AttributedGroupView,
  type GroupView,
} from "./view-model";

function parseBriefBody(body: object) {
  return parseBrief(JSON.stringify(body));
}

function requireAttributed(group: GroupView | undefined): AttributedGroupView {
  if (group === undefined || !isAttributedGroupView(group)) {
    throw new Error("expected an attributed group");
  }
  return group;
}

type TwoGroupBrief = Omit<Brief, "artifactKind" | "readingOrder"> & {
  readingOrder?: unknown;
};

function twoGroupBrief(readingOrder?: unknown): TwoGroupBrief {
  const brief: TwoGroupBrief = {
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
        role: "core",
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
        role: "core",
        loc: { added: 6, deleted: 0 },
        addedRanges: [{ start: 1, end: 6 }],
        removedRanges: [],
        riskSurface: [],
      },
    ],
    concernView: [{ concern: "implementation", added: 10, deleted: 1 }],
  };

  if (readingOrder !== undefined) {
    brief.readingOrder = readingOrder;
  }

  return brief;
}

describe("getCategoryLabel", () => {
  it("labels move-with-edits without a stray hyphen", () => {
    expect(
      getCategoryLabel(appI18n.t, ChangeGroupCategories.MOVE_WITH_EDITS),
    ).toBe("move with edits");
  });

  it("labels every ChangeGroupCategory from the catalog", () => {
    for (const category of Object.values(ChangeGroupCategories)) {
      const label = getCategoryLabel(appI18n.t, category);
      const spokenKey = category.replaceAll("-", " ");

      expect(label).toBe(spokenKey);
    }
  });
});

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
  it("groups chunks by changeGroupId into core and supporting buckets", () => {
    const parsed = parseBriefBody({
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
          role: "core",
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
    if (!parsed.ok) {
      return;
    }

    const model = buildBriefViewModel(parsed.value);
    const group = requireAttributed(model.groups[0]);

    expect(group.chunks.map((chunk) => chunk.id)).toEqual(["c1", "c2"]);
    expect(group.coreChunks.map((chunk) => chunk.id)).toEqual(["c1"]);
    expect(group.supportingChunks.map((chunk) => chunk.id)).toEqual(["c2"]);
    expect(model.chunkToGroup.get("c1")).toBe("g1");
    expect(model.flags[0]?.groupId).toBe("g1");
  });

  it("sums core-only lines beside full group and brief totals", () => {
    const parsed = parseBriefBody({
      ...twoGroupBrief(),
      chunks: [
        {
          id: "c1",
          changeGroupId: "g1",
          file: "src/consumer.ts",
          concern: "implementation",
          role: "core",
          loc: { added: 4, deleted: 1 },
          addedRanges: [{ start: 1, end: 4 }],
          removedRanges: [{ start: 1, end: 1 }],
          riskSurface: [],
        },
        {
          id: "c2",
          changeGroupId: "g1",
          file: "src/consumer.test.ts",
          concern: "test",
          role: "supporting",
          loc: { added: 8, deleted: 2 },
          addedRanges: [{ start: 1, end: 8 }],
          removedRanges: [{ start: 1, end: 2 }],
          riskSurface: [],
        },
        {
          id: "c3",
          changeGroupId: "g2",
          file: "src/schema.ts",
          concern: "implementation",
          role: "core",
          loc: { added: 0, deleted: 5 },
          addedRanges: [],
          removedRanges: [{ start: 1, end: 5 }],
          riskSurface: [],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const model = buildBriefViewModel(parsed.value);

    expect(requireAttributed(model.groups[0])).toMatchObject({
      added: 12,
      deleted: 3,
      coreAdded: 4,
      coreDeleted: 1,
    });
    // Deletion-only core set stays a plain sum, no special casing.
    expect(requireAttributed(model.groups[1])).toMatchObject({
      coreAdded: 0,
      coreDeleted: 5,
    });
    expect(model.totalAdded).toBe(12);
    expect(model.totalDeleted).toBe(8);
    expect(model.totalCoreAdded).toBe(4);
    expect(model.totalCoreDeleted).toBe(6);
  });

  it("falls back to source order when the Brief has no readingOrder", () => {
    const parsed = parseBriefBody(twoGroupBrief());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const model = buildBriefViewModel(parsed.value);

    expect(model.groups.map((group) => group.id)).toEqual(["g1", "g2"]);
    expect(model.groups.map((group) => group.readingOrderStep)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("attaches step indexes and reasons in valid reading order", () => {
    const parsed = parseBriefBody(
      twoGroupBrief([
        { groupId: "g2", why: "establishes the schema the rest builds on" },
        { groupId: "g1", why: "wires the schema into call sites" },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const model = buildBriefViewModel(parsed.value);

    expect(model.groups.map((group) => group.id)).toEqual(["g2", "g1"]);
    expect(model.groups.map((group) => group.readingOrderStep)).toEqual([1, 2]);
    expect(
      model.groups.map((group) =>
        isAttributedGroupView(group) ? group.readingOrderWhy : undefined,
      ),
    ).toEqual([
      "establishes the schema the rest builds on",
      "wires the schema into call sites",
    ]);
    expect(model.groups.map((group) => group.index)).toEqual([0, 1]);
  });

  it("threads a chunk's riskNotes entry onto the matching flag", () => {
    const base = twoGroupBrief();
    const parsed = parseBriefBody({
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
    if (!parsed.ok) {
      return;
    }

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
    const parsed = parseBriefBody({
      ...base,
      chunks: [
        base.chunks[0],
        { ...base.chunks[1], riskSurface: ["new-abstraction"] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const model = buildBriefViewModel(parsed.value);

    const flag = model.flags.find((f) => f.attr === "new-abstraction");
    expect(flag).toBeDefined();
    expect(flag?.note).toBeUndefined();
    expect(flag?.descriptionKey).toBe("brief.risk.newAbstraction");
  });

  it("uses source order for invalid readingOrder without parser validation", () => {
    // Exercises the viewModel's own defensive re-check (validation.ts already
    // drops an invalid readingOrder at the parse boundary, this covers a
    // Brief constructed outside that parser, e.g. fixtures or partial mocks).
    const invalid: Brief = {
      ...(parseBriefBody(twoGroupBrief()) as { ok: true; value: Brief }).value,
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

describe("buildBriefViewModel, repo-config display weight", () => {
  function briefWithRisk() {
    const base = twoGroupBrief();
    // The fixture's empty arrays infer never[]; push through a typed view.
    const chunks: { riskSurface: string[] }[] = base.chunks;
    chunks[0]?.riskSurface.push("touches-billing", "widens-error-handling");
    chunks[1]?.riskSurface.push("touches-auth", "widens-error-handling");
    const parsed = parseBriefBody(base);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
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

  it("marks sources and quiets firings unless a floor attribute co-fires", () => {
    const model = buildBriefViewModel(briefWithRisk(), snapshot);

    const billing = model.flags.find((f) => f.attr === "touches-billing");
    expect(billing?.source).toBe("repo-policy");
    expect(billing?.implication).toBe("needs finance review");
    // Repo-defined attributes carry the repo's own criteria verbatim.
    expect(billing?.descriptionKey).toBeUndefined();
    expect(billing?.criteria).toContain("modifies invoicing code");

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

  it("renders loud built-in flags when the snapshot is absent", () => {
    const model = buildBriefViewModel(briefWithRisk());
    expect(
      model.flags.every((f) => f.source === "built-in" && !f.deEmphasized),
    ).toBe(true);
  });
});

describe("buildAttributeRail, jump-rail", () => {
  const railSnapshot = {
    files: [],
    collisions: [],
    policy: {
      firedCustomAttributes: [{ name: "touches-billing", criteria: "c" }],
      deEmphasize: [{ attribute: "widens-error-handling" }],
    },
  };

  function railBrief() {
    const base = twoGroupBrief();
    const chunks: { riskSurface: string[] }[] = base.chunks;
    // g1/c1: custom + quiet built-in; g2/c2: floor + the same custom.
    chunks[0]?.riskSurface.push("touches-billing", "widens-error-handling");
    chunks[1]?.riskSurface.push("touches-auth", "touches-billing");
    const parsed = parseBriefBody(base);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    return parsed.value;
  }

  it("floor first, loud firings only, carrying groups in display order", () => {
    const rail = buildAttributeRail(
      buildBriefViewModel(railBrief(), railSnapshot),
    );
    expect(rail.floorFired).toBe(true);
    expect(rail.entries.map((entry) => entry.attr)).toEqual([
      "touches-auth",
      "touches-billing",
    ]);
    // widens-error-handling: only firing is de-emphasized → excluded.
    expect(rail.entries.some((e) => e.attr === "widens-error-handling")).toBe(
      false,
    );
    const billing = rail.entries.find((e) => e.attr === "touches-billing");
    expect(billing?.groupIds).toEqual(["g1", "g2"]);
    expect(billing?.source).toBe("repo-policy");
    expect(rail.entries.find((e) => e.attr === "touches-auth")?.floor).toBe(
      true,
    );
  });

  it("shows a collapsed rail when no floor attribute fires", () => {
    const base = twoGroupBrief();
    const chunks: { riskSurface: string[] }[] = base.chunks;
    chunks[0]?.riskSurface.push("hot-path");
    const parsed = parseBriefBody(base);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const rail = buildAttributeRail(buildBriefViewModel(parsed.value));
    expect(rail.floorFired).toBe(false);
    expect(rail.entries).toHaveLength(1);
  });
});

describe("buildBriefViewModel, unattributed", () => {
  it("includes per-file counts and totals in the brief totals", () => {
    const parsed = parseBriefBody({
      ...twoGroupBrief(),
      unattributed: [
        {
          file: "src/orphan.ts",
          addedRanges: [
            { start: 1, end: 3 },
            { start: 10, end: 10 },
          ],
          removedRanges: [{ start: 2, end: 2 }],
        },
        {
          file: "src/other.ts",
          addedRanges: [],
          removedRanges: [{ start: 5, end: 6 }],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const model = buildBriefViewModel(parsed.value);

    expect(model.unattributed).toEqual({
      files: [
        {
          file: "src/orphan.ts",
          addedRanges: [
            { start: 1, end: 3 },
            { start: 10, end: 10 },
          ],
          removedRanges: [{ start: 2, end: 2 }],
          added: 4,
          deleted: 1,
        },
        {
          file: "src/other.ts",
          addedRanges: [],
          removedRanges: [{ start: 5, end: 6 }],
          added: 0,
          deleted: 2,
        },
      ],
      added: 4,
      deleted: 3,
    });
    // Chunk sums (4/1 from twoGroupBrief's chunks) plus the remainder.
    const chunkAdded = parsed.value.chunks.reduce(
      (sum, chunk) => sum + chunk.loc.added,
      0,
    );
    const chunkDeleted = parsed.value.chunks.reduce(
      (sum, chunk) => sum + chunk.loc.deleted,
      0,
    );
    expect(model.totalAdded).toBe(chunkAdded + 4);
    expect(model.totalDeleted).toBe(chunkDeleted + 3);
  });

  it("exposes zero totals for an empty array and stays absent pre-feature", () => {
    const withEmpty = parseBriefBody({ ...twoGroupBrief(), unattributed: [] });
    expect(withEmpty.ok).toBe(true);
    if (!withEmpty.ok) {
      return;
    }
    const emptyModel = buildBriefViewModel(withEmpty.value);
    expect(emptyModel.unattributed).toEqual({
      files: [],
      added: 0,
      deleted: 0,
    });
    expect(emptyModel.groups.every(isAttributedGroupView)).toBe(true);

    const absent = parseBriefBody(twoGroupBrief());
    expect(absent.ok).toBe(true);
    if (!absent.ok) {
      return;
    }
    expect(buildBriefViewModel(absent.value).unattributed).toBeUndefined();
  });
});

describe("buildBriefViewModel, remainder group", () => {
  it("appends the remainder after attributed groups in source order", () => {
    const parsed = parseBriefBody({
      ...twoGroupBrief(),
      unattributed: [
        {
          file: "src/orphan.ts",
          addedRanges: [{ start: 1, end: 3 }],
          removedRanges: [{ start: 2, end: 2 }],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const brief = parsed.value;
    const leftover = brief.unattributed?.[0];
    if (leftover === undefined) {
      throw new Error("expected leftover file");
    }
    leftover.diff = [{ kind: "add", content: "leftover()", newLine: 1 }];

    const model = buildBriefViewModel(brief);
    const remainder = model.groups[2];
    expect(remainder?.kind).toBe(GroupViewKinds.UNATTRIBUTED_REMAINDER);
    expect(remainder?.readingOrderStep).toBeUndefined();
    expect(remainder?.index).toBe(2);
    expect(remainder?.chunks.map((chunk) => chunk.id)).toEqual(["u-7e7f21ef"]);
    expect(model.chunkToGroup.get("u-7e7f21ef")).toBe(
      GroupViewKinds.UNATTRIBUTED_REMAINDER,
    );
    expect(remainder?.chunks[0]?.diff).toEqual([
      { kind: "add", content: "leftover()", newLine: 1 },
    ]);
  });

  it("places the remainder at step N+1 after a valid reading order", () => {
    const parsed = parseBriefBody({
      ...twoGroupBrief([
        { groupId: "g2", why: "establishes the schema the rest builds on" },
        { groupId: "g1", why: "wires the schema into call sites" },
      ]),
      unattributed: [
        {
          file: "src/orphan.ts",
          addedRanges: [{ start: 1, end: 1 }],
          removedRanges: [],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const model = buildBriefViewModel(parsed.value);
    expect(model.groups.map((group) => group.id)).toEqual([
      "g2",
      "g1",
      GroupViewKinds.UNATTRIBUTED_REMAINDER,
    ]);
    expect(model.groups.map((group) => group.readingOrderStep)).toEqual([
      1, 2, 3,
    ]);
    expect(
      model.groups.map((group) =>
        isAttributedGroupView(group) ? group.readingOrderWhy : undefined,
      ),
    ).toEqual([
      "establishes the schema the rest builds on",
      "wires the schema into call sites",
      undefined,
    ]);
  });

  it("does not add a remainder when the field is absent", () => {
    const parsed = parseBriefBody(twoGroupBrief());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(buildBriefViewModel(parsed.value).groups).toHaveLength(2);
  });
});

describe("buildBriefViewModel, exact totals under overlaps", () => {
  it("prefers diffTotals to overlapping chunk sums", () => {
    const parsed = parseBriefBody({
      ...twoGroupBrief(),
      diffTotals: { added: 10, deleted: 3 },
      unattributed: [
        {
          file: "src/orphan.ts",
          addedRanges: [{ start: 1, end: 2 }],
          removedRanges: [],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const model = buildBriefViewModel(parsed.value);
    expect(model.totalAdded).toBe(10);
    expect(model.totalDeleted).toBe(3);
  });

  it("falls back to chunk sums + remainder on pre-diffTotals briefs", () => {
    const parsed = parseBriefBody({
      ...twoGroupBrief(),
      unattributed: [
        {
          file: "src/orphan.ts",
          addedRanges: [{ start: 1, end: 2 }],
          removedRanges: [],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const model = buildBriefViewModel(parsed.value);
    const chunkAdded = parsed.value.chunks.reduce(
      (sum, chunk) => sum + chunk.loc.added,
      0,
    );
    expect(model.totalAdded).toBe(chunkAdded + 2);
  });
});
