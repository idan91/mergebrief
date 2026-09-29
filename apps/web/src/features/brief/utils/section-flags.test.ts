import { describe, expect, it } from "vitest";

import { Concerns, Roles, type BriefChunk } from "../types";
import { resolveSectionFlags, type SectionRegion } from "./section-flags";
import type { RiskFlag } from "./viewModel";

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

function stubFlag(id: string, chunkId: string, file: string): RiskFlag {
  return {
    id,
    attr: "dense-logic",
    chunkId,
    file,
    groupId: "g1",
    source: "built-in",
    deEmphasized: false,
  };
}

const CHUNKS: BriefChunk[] = [
  stubChunk({ id: "c1", addedRanges: [{ start: 10, end: 14 }] }),
  stubChunk({
    id: "c2",
    addedRanges: [{ start: 40, end: 41 }],
    removedRanges: [{ start: 38, end: 39 }],
  }),
  stubChunk({
    id: "c3",
    file: "src/b.ts",
    addedRanges: [{ start: 10, end: 14 }],
  }),
  stubChunk({ id: "c4", removedRanges: [{ start: 70, end: 72 }] }),
];

const FLAGS: RiskFlag[] = [
  stubFlag("f1", "c1", "src/a.ts"),
  stubFlag("f2", "c2", "src/a.ts"),
  stubFlag("f3", "c3", "src/b.ts"),
  stubFlag("f4", "c4", "src/a.ts"),
];

describe("resolveSectionFlags", () => {
  it("keeps the flags whose chunk shares a file and an added line", () => {
    const section: SectionRegion[] = [
      {
        file: "src/a.ts",
        addedRanges: [{ start: 12, end: 20 }],
        removedRanges: [],
      },
    ];

    expect(
      resolveSectionFlags(FLAGS, CHUNKS, section).map((flag) => flag.id),
    ).toEqual(["f1"]);
  });

  it("never matches a chunk of another file on the same lines", () => {
    const section: SectionRegion[] = [
      {
        file: "src/b.ts",
        addedRanges: [{ start: 10, end: 10 }],
        removedRanges: [],
      },
    ];

    expect(
      resolveSectionFlags(FLAGS, CHUNKS, section).map((flag) => flag.id),
    ).toEqual(["f3"]);
  });

  it("attaches no flag to a deletion-only region", () => {
    const section: SectionRegion[] = [
      {
        file: "src/a.ts",
        addedRanges: [],
        removedRanges: [{ start: 71, end: 71 }],
      },
    ];

    expect(resolveSectionFlags(FLAGS, CHUNKS, section)).toEqual([]);
  });

  it("leaves out a flag overlapping no region of the section", () => {
    const section: SectionRegion[] = [
      {
        file: "src/a.ts",
        addedRanges: [{ start: 100, end: 120 }],
        removedRanges: [],
      },
    ];

    expect(resolveSectionFlags(FLAGS, CHUNKS, section)).toEqual([]);
  });

  it("keeps the brief's flag order across several regions", () => {
    const section: SectionRegion[] = [
      {
        file: "src/a.ts",
        addedRanges: [{ start: 41, end: 41 }],
        removedRanges: [],
      },
      {
        file: "src/a.ts",
        addedRanges: [{ start: 10, end: 10 }],
        removedRanges: [],
      },
    ];

    expect(
      resolveSectionFlags(FLAGS, CHUNKS, section).map((flag) => flag.id),
    ).toEqual(["f1", "f2"]);
  });
});
