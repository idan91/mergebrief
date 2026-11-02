import { describe, expect, it } from "vitest";
import { indexDiff } from "../../src/diff/hunk-index";
import type { FileId } from "../../src/diff/hunk-index/types";
import { resolveHunkMap } from "../../src/generation/multi-call/hunk-map";
import type { HunkMapInput } from "../../src/generation/multi-call/types";
import { createWarningCollector } from "../../src/generation/warnings";
import {
  GenerationWarningKinds,
  type GenerationWarning,
} from "../../src/generation/warnings/types";
import type { HunkMapEntry } from "../../src/types";

function makeFile(path: string, hunks: number): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    ...Array.from({ length: hunks }, (_, index) => [
      `@@ -${index * 10 + 1},1 +${index * 10 + 1},1 @@`,
      "-old",
      "+new",
    ]).flat(),
    "",
  ].join("\n");
}

/** f1 has three hunks, f2 two, f3 is a lockfile shown as one line. */
const files = indexDiff(
  makeFile("src/a.ts", 3) + makeFile("src/b.ts", 2) + makeFile("yarn.lock", 4),
);
const SHORTENED: ReadonlySet<FileId> = new Set<FileId>(["f3"]);
const GROUPS = ["g1", "g2", "g3"];

interface Resolved {
  result: ReturnType<typeof resolveHunkMap>;
  warnings: GenerationWarning[];
}

function resolve(
  entries: HunkMapEntry[],
  overrides: Partial<HunkMapInput> = {},
): Resolved {
  const warnings = createWarningCollector(() => {});
  const result = resolveHunkMap({
    entries,
    files,
    shortenedFileIds: SHORTENED,
    groupIds: GROUPS,
    warnings,
    ...overrides,
  });
  return { result, warnings: warnings.listWarnings() };
}

function readHunkOwner(resolved: Resolved, hunkId: string): string | undefined {
  const owner = [...resolved.result.hunksByGroup].find(([, hunkIds]) =>
    hunkIds.some((id) => id === hunkId),
  );
  return owner?.[0];
}

function readOwners(resolved: Resolved): Record<string, string> {
  const hunkOwners = [...resolved.result.hunksByGroup].flatMap(
    ([groupId, hunkIds]) => hunkIds.map((hunkId) => [hunkId, groupId]),
  );
  return Object.fromEntries([
    ...hunkOwners,
    ...resolved.result.groupByShortenedFile,
  ]);
}

describe("resolveHunkMap", () => {
  it("assigns whole files, single hunks and runs to their groups", () => {
    const resolved = resolve([
      { groupId: "g1", hunks: ["f1:h1-h2", "f2 : h2"] },
      { groupId: "g2", hunks: ["f1:h3", "f2:h1", "f3"] },
    ]);

    expect(readOwners(resolved)).toEqual({
      f1h1: "g1",
      f1h2: "g1",
      f2h2: "g1",
      f1h3: "g2",
      f2h1: "g2",
      f3: "g2",
    });
    expect(resolved.warnings).toEqual([]);
  });

  it("accepts hunk ids spelled as the markers show them", () => {
    const resolved = resolve([
      { groupId: "g1", hunks: ["f1h1-h2", "f2h2"] },
      { groupId: "g2", hunks: ["f1h3-f1h3", "f2 h1", "f3"] },
    ]);

    expect(readOwners(resolved)).toEqual({
      f1h1: "g1",
      f1h2: "g1",
      f2h2: "g1",
      f1h3: "g2",
      f2h1: "g2",
      f3: "g2",
    });
    expect(resolved.warnings).toEqual([]);
  });

  it("a run of whole files claims every file it covers", () => {
    const resolved = resolve([
      { groupId: "g1", hunks: ["f1-f2"] },
      { groupId: "g2", hunks: ["f3 - f3"] },
    ]);

    expect(readOwners(resolved)).toEqual({
      f1h1: "g1",
      f1h2: "g1",
      f1h3: "g1",
      f2h1: "g1",
      f2h2: "g1",
      f3: "g2",
    });
    expect(resolved.warnings).toEqual([]);
  });

  it("a run of whole files over a shortened file claims it whole", () => {
    const resolved = resolve([
      { groupId: "g1", hunks: ["f1"] },
      { groupId: "g2", hunks: ["f2-f3"] },
    ]);

    expect(readHunkOwner(resolved, "f2h2")).toBe("g2");
    expect(resolved.result.groupByShortenedFile.get("f3")).toBe("g2");
    expect(resolved.warnings).toEqual([]);
  });

  it("a run of whole files steps over a file the outline left out", () => {
    const resolved = resolve([{ groupId: "g1", hunks: ["f1-f3"] }], {
      files: files.filter((file) => file.id !== "f2"),
      omittedFileIds: new Set<FileId>(["f2"]),
    });

    expect(readOwners(resolved)).toEqual({
      f1h1: "g1",
      f1h2: "g1",
      f1h3: "g1",
      f3: "g1",
    });
    expect(resolved.warnings).toEqual([]);
  });

  it("rejects a run ending on a file the outline left out", () => {
    const resolved = resolve([{ groupId: "g1", hunks: ["f1-f2"] }], {
      files: files.filter((file) => file.id !== "f2"),
      omittedFileIds: new Set<FileId>(["f2"]),
    });

    expect(resolved.warnings).toContainEqual(
      expect.objectContaining({
        kind: GenerationWarningKinds.HUNK_MAP_REJECTED,
        items: ["f1-f2"],
      }),
    );
  });

  it("rejects an inverted file run or one naming a file outside the diff", () => {
    const resolved = resolve([
      {
        groupId: "g1",
        hunks: ["f1", "f2", "f3", "f2-f1", "f2-f4", "f0-f1", "f1-f9999999"],
      },
    ]);

    expect(resolved.warnings).toEqual([
      expect.objectContaining({
        kind: GenerationWarningKinds.HUNK_MAP_REJECTED,
        items: ["f2-f1", "f2-f4", "f0-f1", "f1-f9999999"],
      }),
    ]);
  });

  it("a file run overlapping another group keeps the earlier group", () => {
    const resolved = resolve([
      { groupId: "g3", hunks: ["f1-f3"] },
      { groupId: "g1", hunks: ["f2"] },
    ]);

    expect(readHunkOwner(resolved, "f1h1")).toBe("g3");
    expect(readHunkOwner(resolved, "f2h1")).toBe("g1");
    expect(resolved.result.groupByShortenedFile.get("f3")).toBe("g3");
    expect(resolved.warnings).toEqual([
      expect.objectContaining({
        kind: GenerationWarningKinds.HUNK_MAP_LISTED_TWICE,
        hunkIds: ["f2h1", "f2h2"],
        fileIds: [],
      }),
    ]);
  });

  it("skips repeated file runs once the claim budget is spent", () => {
    const repeated = Array.from({ length: 1000 }, () => "f1-f3");
    const resolved = resolve([{ groupId: "g1", hunks: repeated }]);

    expect(readHunkOwner(resolved, "f2h2")).toBe("g1");
    expect(resolved.result.groupByShortenedFile.get("f3")).toBe("g1");
    expect(resolved.warnings).toEqual([
      expect.objectContaining({
        kind: GenerationWarningKinds.HUNK_MAP_REJECTED,
        message: expect.stringContaining("past the claim budget"),
      }),
    ]);
    const [warning] = resolved.warnings;
    const skipped =
      warning !== undefined && "items" in warning ? warning.items : [];
    expect(skipped.length).toBeGreaterThan(990);
  });

  it("a per-hunk map listed under three groups stays within budget", () => {
    const perHunk = ["f1h1", "f1h2", "f1h3", "f2h1", "f2h2", "f3"];
    const resolved = resolve([
      { groupId: "g1", hunks: perHunk },
      { groupId: "g2", hunks: perHunk },
      { groupId: "g3", hunks: perHunk },
    ]);

    expect(readHunkOwner(resolved, "f2h2")).toBe("g1");
    expect(resolved.warnings.map((warning) => warning.kind)).toEqual([
      GenerationWarningKinds.HUNK_MAP_LISTED_TWICE,
    ]);
  });

  it("rejects a run whose end names another file", () => {
    const resolved = resolve([
      { groupId: "g1", hunks: ["f1h1-f2h2", "f1:h1-f2:h2", "f1", "f2", "f3"] },
    ]);

    expect(resolved.warnings).toEqual([
      expect.objectContaining({
        kind: GenerationWarningKinds.HUNK_MAP_REJECTED,
        items: ["f1h1-f2h2", "f1:h1-f2:h2"],
      }),
    ]);
  });

  it("rejects an item longer than any hunk id without parsing it", () => {
    const padded = `f1${" ".repeat(100_000)}x`;
    const resolved = resolve([{ groupId: "g1", hunks: [padded, "f2", "f3"] }]);

    expect(resolved.warnings[0]).toMatchObject({
      kind: GenerationWarningKinds.HUNK_MAP_REJECTED,
    });
    expect(readHunkOwner(resolved, "f1h1")).toBeUndefined();
  });

  it("lists each group's hunks in diff order", () => {
    const resolved = resolve([
      { groupId: "g2", hunks: ["f2", "f1:h2"] },
      { groupId: "g1", hunks: ["f1:h3", "f1:h1", "f3"] },
    ]);

    expect([...resolved.result.hunksByGroup]).toEqual([
      ["g1", ["f1h1", "f1h3"]],
      ["g2", ["f1h2", "f2h1", "f2h2"]],
    ]);
  });

  it("a whole-file item on a file read in full claims every hunk", () => {
    const resolved = resolve([
      { groupId: "g1", hunks: ["f1"] },
      { groupId: "g2", hunks: ["f2", "f3"] },
    ]);

    expect(readHunkOwner(resolved, "f1h3")).toBe("g1");
    expect(resolved.result.unlistedHunkIds).toEqual([]);
  });

  it("a hunk item on a shortened file claims the file whole", () => {
    const resolved = resolve([
      { groupId: "g1", hunks: ["f1", "f2", "f3:h2-h3"] },
    ]);

    expect(resolved.result.groupByShortenedFile.get("f3")).toBe("g1");
    expect(resolved.warnings).toEqual([]);
  });

  it("rejects unknown files, malformed items and runs past the last hunk", () => {
    const resolved = resolve([
      {
        groupId: "g1",
        hunks: ["f1", "f2", "f3", "f9", "f2:h3", "f1:h3-h2", "src/a.ts", ""],
      },
    ]);

    expect(resolved.warnings).toEqual([
      {
        kind: GenerationWarningKinds.HUNK_MAP_REJECTED,
        message: expect.stringContaining("5 item(s)"),
        items: ["f9", "f2:h3", "f1:h3-h2", "src/a.ts", ""],
      },
    ]);
    expect(resolved.result.unlistedHunkIds).toEqual([]);
  });

  it("rejects every item of an entry for a group the grouping never produced", () => {
    const resolved = resolve([
      { groupId: "g1", hunks: ["f1", "f2", "f3"] },
      { groupId: "g9", hunks: ["f1:h1"] },
    ]);

    expect(readHunkOwner(resolved, "f1h1")).toBe("g1");
    expect(resolved.warnings[0]).toMatchObject({
      kind: GenerationWarningKinds.HUNK_MAP_REJECTED,
      items: ["f1:h1"],
    });
  });

  it("a hunk two groups list goes to the earlier group in reading order", () => {
    const resolved = resolve([
      { groupId: "g3", hunks: ["f1:h1-h3", "f3"] },
      { groupId: "g1", hunks: ["f1:h2", "f2", "f3"] },
    ]);

    expect(readHunkOwner(resolved, "f1h2")).toBe("g1");
    expect(readHunkOwner(resolved, "f1h1")).toBe("g3");
    expect(resolved.result.groupByShortenedFile.get("f3")).toBe("g1");
    expect(resolved.warnings).toEqual([
      {
        kind: GenerationWarningKinds.HUNK_MAP_LISTED_TWICE,
        message: expect.stringContaining("2 hunk(s) or shortened file(s)"),
        hunkIds: ["f1h2"],
        fileIds: ["f3"],
      },
    ]);
  });

  it("the same hunk listed twice under one group is no conflict", () => {
    const resolved = resolve([
      { groupId: "g1", hunks: ["f1", "f1:h2", "f2", "f3"] },
    ]);

    expect(resolved.warnings).toEqual([]);
  });

  it("leaves what no group lists to the unattributed remainder", () => {
    const resolved = resolve([{ groupId: "g1", hunks: ["f1:h1", "f2"] }]);

    expect(resolved.result.unlistedHunkIds).toEqual(["f1h2", "f1h3"]);
    expect(resolved.result.unlistedFileIds).toEqual(["f3"]);
    expect(resolved.warnings).toEqual([
      {
        kind: GenerationWarningKinds.HUNK_MAP_UNLISTED,
        message: expect.stringContaining("3 hunk(s) or shortened file(s)"),
        hunkIds: ["f1h2", "f1h3"],
        fileIds: ["f3"],
      },
    ]);
  });

  it("cuts a long model item in the rejection warning", () => {
    const item = `f1:${"h".repeat(80)}`;

    const resolved = resolve([
      { groupId: "g1", hunks: ["f1", "f2", "f3", item] },
    ]);

    expect(resolved.warnings[0]).toMatchObject({
      items: [`${item.slice(0, 40)}...`],
    });
  });
});
