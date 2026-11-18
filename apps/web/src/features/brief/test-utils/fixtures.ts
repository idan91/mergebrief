import type { LocalBriefSummary } from "contract";
import { ChangeGroupCategories } from "types";
import {
  BeforeSources,
  Concerns,
  ProductChangeAreas,
  ProductDiffAvailabilities,
  Roles,
  type ProductChange,
  type ProductDiff,
} from "brief-core/types";
import { type RowRef, RowRefKinds } from "../model/expansion/types";
import { type Brief, type BriefChunk } from "../model/types";
import type { RepoConfigContext } from "../model/utils/repo-config";
import type { ComparisonOverlayState } from "../model/comparison/comparison-overlay";
import type { ComparisonSource } from "../model/comparison/runs";
import { CompareParams, type CompareParam } from "../model/comparison/types";
import type { FileRowsCache } from "../model/file-rows/cache";
import type { DiffLine } from "@web/utils/diffTokens/types";

/**
 * Hand-built brief used by the screen characterization suite (and reusable by
 * store/receipt tests). Small but exercises the critical couplings: an
 * uncertain group, one core chunk with a risk flag, one supporting chunk.
 */
export const briefFixture: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 42,
    title: "Fixture: tighten the cross-param leak",
    url: "https://example.com/pr/42",
    sha: "abcdef1234567890",
    description: "Fixture PR description.",
  },
  summary: "Fixture brief summary.",
  index: 1,
  changeGroups: [
    {
      id: "g1",
      title: "Fix the cross-param leak",
      summary: "Tightens validation on the shared param path.",
      dominantCategory: ChangeGroupCategories.BUGFIX,
      secondaryCategories: [],
      uncertain: true,
      uncertainBetween: [
        ChangeGroupCategories.BUGFIX,
        ChangeGroupCategories.LOGIC_REFACTOR,
      ],
    },
  ],
  chunks: [
    {
      id: "chunk-a",
      changeGroupId: "g1",
      file: "src/leak.ts",
      concern: Concerns.IMPLEMENTATION,
      role: Roles.CORE,
      loc: { added: 4, deleted: 1 },
      addedRanges: [{ start: 10, end: 13 }],
      removedRanges: [],
      riskSurface: ["no-tests", "comment-contradicts-code"],
      riskNotes: [
        {
          attr: "comment-contradicts-code",
          note: "comment says the param is optional (L10), code throws when absent (L12)",
        },
      ],
      summary: "Core chunk for the fix.",
      diff: [
        { kind: "hunk", content: "@@ -9,2 +9,5 @@" },
        { kind: "ctx", content: "const a = 1;", oldLine: 9, newLine: 9 },
        { kind: "add", content: "validate(a);", newLine: 10 },
      ],
    },
    {
      id: "chunk-b",
      changeGroupId: "g1",
      file: "src/leak.test.ts",
      concern: Concerns.TEST,
      role: Roles.SUPPORTING,
      loc: { added: 6, deleted: 0 },
      addedRanges: [{ start: 1, end: 6 }],
      removedRanges: [],
      riskSurface: [],
    },
  ],
  concernView: [
    { concern: Concerns.IMPLEMENTATION, added: 4, deleted: 1 },
    { concern: Concerns.TEST, added: 6, deleted: 0 },
  ],
};

export const briefSummaryFixture: LocalBriefSummary = {
  id: "fixture-brief-1",
  artifactKind: "brief",
  repo: briefFixture.pr.repo,
  number: briefFixture.pr.number,
  title: briefFixture.pr.title,
  sha: briefFixture.pr.sha,
  index: 1,
};

/** Row refs in order: a number is that base row, `expanded` is spliced context. */
export function makeRowRefs(
  entries: readonly (number | typeof RowRefKinds.EXPANDED)[],
): RowRef[] {
  return entries.map((entry) =>
    entry === RowRefKinds.EXPANDED
      ? { kind: RowRefKinds.EXPANDED }
      : { kind: RowRefKinds.BASE, baseIndex: entry },
  );
}

/** One added line at src/a.ts:10, where the conversation fixture puts its threads. */
export function makeChunk(): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: Concerns.IMPLEMENTATION,
    role: Roles.CORE,
    loc: { added: 1, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [{ kind: "add", content: "b", newLine: 10 }],
  };
}

export const repoConfigContextFixture: RepoConfigContext = {
  files: [
    { path: ".mergebrief/instructions.md", blobSha: "i", outcome: "applied" },
    { path: ".mergebrief/settings.yaml", blobSha: null, outcome: "absent" },
    { path: ".mergebrief/policy.yaml", blobSha: "p", outcome: "applied" },
  ],
  collisions: ["touches-auth"],
  policy: {
    firedCustomAttributes: [
      {
        name: "touches-billing",
        criteria: "modifies invoicing code",
        implication: "needs finance review",
        paths: ["services/billing/**"],
      },
    ],
    deEmphasize: [
      { attribute: "widens-error-handling" },
      { attribute: "no-tests", paths: ["generated/**"] },
    ],
  },
};

/**
 * A rows cache over `getFileRows`. Attaching hands each chunk back as it is:
 * a fixture chunk carries its own rows.
 */
export function stubFileRowsCache(
  getFileRows: (path: string) => DiffLine[] | undefined,
  isEmpty = false,
): FileRowsCache {
  return {
    isEmpty,
    getFileRows,
    attachChunkRows: (chunk) => chunk,
    attachEntryRows: (entry) => entry,
  };
}

/** A copy of an entry whose lazy `diff` counts how often it is read. */
export interface LazyDiffStub<Entry> {
  entry: Entry;
  reads: () => number;
}

/**
 * Defines `diff` as an enumerable, configurable getter, the shape the lazy
 * slice has in production, so spreading or enumerating the stub behaves the
 * same.
 */
export function stubLazyDiff<Entry extends { diff?: DiffLine[] }>(
  entry: Entry,
  rows: DiffLine[] | undefined = entry.diff,
): LazyDiffStub<Entry> {
  let reads = 0;
  const lazy = { ...entry };
  Object.defineProperty(lazy, "diff", {
    enumerable: true,
    configurable: true,
    get: () => {
      reads += 1;
      return rows;
    },
  });
  return { entry: lazy, reads: () => reads };
}

/** The compare overlay at a baseline with this many changed runs; off is unavailable. */
export function makeComparisonState(
  compare: CompareParam,
  runCount: number,
): ComparisonOverlayState {
  const source: ComparisonSource =
    compare === CompareParams.PREVIOUS_BRIEF
      ? { kind: "previous-brief", brief: briefFixture, narrative: null }
      : { kind: "last-review", delta: null };

  return {
    compare,
    marks: null,
    source,
    skipReason: null,
    available: compare !== CompareParams.OFF,
    runCount,
  };
}

/** One Product change with a before the diff shows, overridden where a test cares. */
export function makeProductChange(
  overrides: Partial<ProductChange> = {},
): ProductChange {
  return {
    when: "a user creates an item whose name matches an archived one",
    before: "A second, new item was created.",
    after: "The archived item is restored.",
    affects: ProductChangeAreas.BUSINESS_RULE,
    beforeSource: BeforeSources.DIFF,
    groupIds: ["g1"],
    ...overrides,
  };
}

/** An available Product diff of one change, claiming no more. */
export function makeProductDiff(
  overrides: Partial<ProductDiff> = {},
): ProductDiff {
  return {
    availability: ProductDiffAvailabilities.AVAILABLE,
    changes: [makeProductChange()],
    hasMore: false,
    ...overrides,
  };
}
