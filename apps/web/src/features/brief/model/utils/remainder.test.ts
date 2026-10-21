import { describe, expect, it } from "vitest";

import { Concerns, Roles } from "brief-core/types";
import { type UnattributedFile } from "../types";
import {
  GroupViewKinds,
  hydrateRemainderGroup,
  isUnattributedRemainderChunk,
  getRemainderChunkId,
} from "./remainder";

/**
 * Hydration invariants (spec):
 * - absent field → no group
 * - empty array → no group
 * - files whose ranges sum to 0 → no group
 * - one leftover file → one chunk, persisted order
 * - two leftover files → two chunks, persisted order
 * - collision with an existing id → append an index
 * - same path → same id across loads
 */

const ORPHAN_ID = "u-7e7f21ef";
const OTHER_ID = "u-956a5ffb";

const orphanFile: UnattributedFile = {
  file: "src/orphan.ts",
  addedRanges: [
    { start: 1, end: 3 },
    { start: 10, end: 10 },
  ],
  removedRanges: [{ start: 2, end: 2 }],
  diff: [{ kind: "add", content: "leftover()", newLine: 1 }],
};

const otherFile: UnattributedFile = {
  file: "src/other.ts",
  addedRanges: [],
  removedRanges: [{ start: 5, end: 6 }],
};

describe("getRemainderChunkId", () => {
  it("mints a stable u-<hex> id from the file path", () => {
    expect(getRemainderChunkId("src/orphan.ts", new Set())).toBe(ORPHAN_ID);
    expect(getRemainderChunkId("src/other.ts", new Set())).toBe(OTHER_ID);
  });

  it("appends an index when the natural id is already taken", () => {
    expect(getRemainderChunkId("src/orphan.ts", new Set([ORPHAN_ID]))).toBe(
      `${ORPHAN_ID}-1`,
    );
    expect(
      getRemainderChunkId(
        "src/orphan.ts",
        new Set([ORPHAN_ID, `${ORPHAN_ID}-1`]),
      ),
    ).toBe(`${ORPHAN_ID}-2`);
  });
});

describe("isUnattributedRemainderChunk", () => {
  it("recognises a chunk by the remainder group id, not by role", () => {
    expect(
      isUnattributedRemainderChunk({
        id: ORPHAN_ID,
        changeGroupId: GroupViewKinds.UNATTRIBUTED_REMAINDER,
        file: "src/orphan.ts",
        concern: Concerns.IMPLEMENTATION,
        role: Roles.CORE,
        loc: { added: 4, deleted: 1 },
        addedRanges: orphanFile.addedRanges,
        removedRanges: orphanFile.removedRanges,
        riskSurface: [],
      }),
    ).toBe(true);
    expect(
      isUnattributedRemainderChunk({
        id: "c1",
        changeGroupId: "g1",
        file: "src/orphan.ts",
        concern: Concerns.IMPLEMENTATION,
        role: Roles.CORE,
        loc: { added: 4, deleted: 1 },
        addedRanges: [],
        removedRanges: [],
        riskSurface: [],
      }),
    ).toBe(false);
  });
});

describe("hydrateRemainderGroup", () => {
  it("returns nothing when the field is absent", () => {
    expect(hydrateRemainderGroup(undefined, new Set())).toBeUndefined();
  });

  it("returns nothing when every file has zero leftover lines", () => {
    expect(
      hydrateRemainderGroup(
        [
          {
            file: "src/empty.ts",
            addedRanges: [],
            removedRanges: [],
          },
        ],
        new Set(),
      ),
    ).toBeUndefined();
  });

  it("hydrates one leftover file as one chunk and copies its diff", () => {
    const hydration = hydrateRemainderGroup([orphanFile], new Set());

    expect(hydration?.added).toBe(4);
    expect(hydration?.deleted).toBe(1);
    expect(hydration?.chunks).toHaveLength(1);
    const chunk = hydration?.chunks[0];
    expect(chunk).toMatchObject({
      id: ORPHAN_ID,
      changeGroupId: GroupViewKinds.UNATTRIBUTED_REMAINDER,
      file: "src/orphan.ts",
      concern: Concerns.IMPLEMENTATION,
      role: Roles.CORE,
      loc: { added: 4, deleted: 1 },
      addedRanges: orphanFile.addedRanges,
      removedRanges: orphanFile.removedRanges,
      riskSurface: [],
    });
    expect(chunk?.diff).toEqual(orphanFile.diff);
  });

  it("keeps persisted file order across two leftover files", () => {
    const hydration = hydrateRemainderGroup([orphanFile, otherFile], new Set());

    expect(hydration?.chunks.map((chunk) => chunk.file)).toEqual([
      "src/orphan.ts",
      "src/other.ts",
    ]);
    expect(hydration?.chunks.map((chunk) => chunk.id)).toEqual([
      ORPHAN_ID,
      OTHER_ID,
    ]);
    expect(hydration?.added).toBe(4);
    expect(hydration?.deleted).toBe(3);
    expect(hydration?.chunks[1]?.diff).toBeUndefined();
  });

  it("skips a zero-line file sitting among leftovers", () => {
    const hydration = hydrateRemainderGroup(
      [
        {
          file: "src/empty.ts",
          addedRanges: [],
          removedRanges: [],
        },
        orphanFile,
      ],
      new Set(),
    );

    expect(hydration?.chunks.map((chunk) => chunk.file)).toEqual([
      "src/orphan.ts",
    ]);
  });

  it("disambiguates a collision with an attributed chunk id", () => {
    const hydration = hydrateRemainderGroup([orphanFile], new Set([ORPHAN_ID]));

    expect(hydration?.chunks[0]?.id).toBe(`${ORPHAN_ID}-1`);
  });
});
