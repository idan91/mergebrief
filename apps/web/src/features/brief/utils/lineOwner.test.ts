import { describe, expect, it } from "vitest";

import { Concerns, Roles, type BriefChunk } from "../types";
import { GroupViewKinds } from "./remainder";
import { appI18n } from "../../../i18n/I18nProvider";
import {
  buildLineOwnersByFile,
  resolveLineOwner,
  resolveNearestLineOwner,
  resolveSpanOwner,
} from "./lineOwner";
import type { BriefViewModel } from "./viewModel";

function stubChunk(overrides: Partial<BriefChunk>): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: Concerns.IMPLEMENTATION,
    role: Roles.CORE,
    loc: { added: 0, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    ...overrides,
  };
}

const CHUNKS: BriefChunk[] = [
  stubChunk({ id: "c1", addedRanges: [{ start: 10, end: 12 }] }),
  stubChunk({
    id: "c2",
    changeGroupId: "g2",
    addedRanges: [{ start: 40, end: 41 }],
    removedRanges: [{ start: 38, end: 39 }],
  }),
  stubChunk({
    id: "other",
    file: "src/b.ts",
    addedRanges: [{ start: 40, end: 41 }],
  }),
  stubChunk({
    id: "u-1",
    changeGroupId: GroupViewKinds.UNATTRIBUTED_REMAINDER,
    addedRanges: [{ start: 60, end: 60 }],
    removedRanges: [{ start: 58, end: 58 }],
  }),
];

describe("resolveLineOwner", () => {
  it("names the chunk whose added ranges hold a new-side line", () => {
    expect(resolveLineOwner("new", 41, CHUNKS)?.id).toBe("c2");
  });

  it("names the chunk whose removed ranges hold an old-side line", () => {
    expect(resolveLineOwner("old", 38, CHUNKS)?.id).toBe("c2");
  });

  it("falls to the remainder when no attributed chunk holds the line", () => {
    expect(resolveLineOwner("new", 60, CHUNKS)?.id).toBe("u-1");
    expect(resolveLineOwner("old", 58, CHUNKS)?.id).toBe("u-1");
  });

  it("answers undefined for a line no chunk of the file changed", () => {
    expect(resolveLineOwner("new", 99, CHUNKS)).toBeUndefined();
    expect(resolveLineOwner("old", 10, CHUNKS)).toBeUndefined();
  });

  it("prefers the narrowest range when two chunks overlap on a line", () => {
    const wide = stubChunk({
      id: "wide",
      addedRanges: [{ start: 1, end: 50 }],
    });
    const narrow = stubChunk({
      id: "narrow",
      addedRanges: [{ start: 10, end: 12 }],
    });

    expect(resolveLineOwner("new", 11, [wide, narrow])?.id).toBe("narrow");
    expect(resolveLineOwner("new", 11, [narrow, wide])?.id).toBe("narrow");
    expect(resolveLineOwner("new", 30, [wide, narrow])?.id).toBe("wide");
  });
});

describe("resolveNearestLineOwner", () => {
  it("keeps an exact holder", () => {
    expect(resolveNearestLineOwner("new", 11, CHUNKS)?.id).toBe("c1");
  });

  it("lands a context line on the chunk whose change is closest", () => {
    // 20 is 8 past c1's 10-12 and 20 short of c2's 40-41.
    expect(resolveNearestLineOwner("new", 20, CHUNKS)?.id).toBe("c1");
    expect(resolveNearestLineOwner("new", 35, CHUNKS)?.id).toBe("c2");
    expect(resolveNearestLineOwner("old", 45, CHUNKS)?.id).toBe("c2");
    // The remainder is a real owner when its change is the closest.
    expect(resolveNearestLineOwner("old", 55, CHUNKS)?.id).toBe("u-1");
  });

  it("measures on the requested side only", () => {
    // Only c2 and u-1 removed anything; c1's added lines never count.
    expect(resolveNearestLineOwner("old", 12, CHUNKS)?.id).toBe("c2");
  });

  it("answers undefined when no chunk changed that side", () => {
    const addsOnly = [CHUNKS[0]!];
    expect(resolveNearestLineOwner("old", 12, addsOnly)).toBeUndefined();
    expect(resolveNearestLineOwner("new", 1, [])).toBeUndefined();
  });
});

describe("buildLineOwnersByFile and resolveSpanOwner", () => {
  const model = {
    groups: [
      {
        kind: GroupViewKinds.ATTRIBUTED,
        index: 0,
        id: "g2",
        group: { title: "Fix the leak", summary: "" },
        chunks: [{ ...CHUNKS[1]!, summary: "Adds the guard" }],
      },
      {
        kind: GroupViewKinds.UNATTRIBUTED_REMAINDER,
        index: 1,
        id: "unattributed-remainder",
        chunks: [CHUNKS[3]!],
      },
    ],
  } as unknown as BriefViewModel;
  const byFile = buildLineOwnersByFile(model, appI18n.t);

  it("labels an attributed chunk with its summary and group", () => {
    const index = byFile.get("src/a.ts")!;

    expect(
      resolveSpanOwner(index, { kind: "add", content: "", newLine: 40 }),
    ).toEqual({
      chunkId: "c2",
      groupName: "Fix the leak",
      groupIndex: 1,
      groupCount: 2,
      summary: "Adds the guard",
      remainder: false,
    });
  });

  it("labels the remainder as such and reads a deletion by its old line", () => {
    const index = byFile.get("src/a.ts")!;

    expect(
      resolveSpanOwner(index, { kind: "del", content: "", oldLine: 58 }),
    ).toEqual({
      chunkId: "u-1",
      groupName: "Unattributed remainder",
      groupIndex: 2,
      groupCount: 2,
      remainder: true,
    });
  });

  it("answers undefined for a context row or an unowned line", () => {
    const index = byFile.get("src/a.ts")!;

    expect(
      resolveSpanOwner(index, {
        kind: "ctx",
        content: "",
        oldLine: 1,
        newLine: 1,
      }),
    ).toBeUndefined();
    expect(
      resolveSpanOwner(index, { kind: "add", content: "", newLine: 99 }),
    ).toBeUndefined();
  });
});
