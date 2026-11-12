import type { z } from "zod/v4";
import type {
  Effort,
  GenerateRequest,
  Generation,
  Generator,
} from "generators";
import {
  BeforeSources,
  DeltaSkipReasons,
  ProductChangeAreas,
  ProductDiffAvailabilities,
  RevisionNarrativeSkipReasons,
  type Brief,
  type ChangeGroup,
  type Chunk,
  type DeltaBrief,
  type DeltaSkipped,
  type DeltaUnchanged,
  type ProductChange,
  type ProductDiff,
  type RevisionNarrative,
  type RevisionNarrativeSkipped,
  type RevisionNarrativeUnchanged,
} from "../src/types";

/** A file turned into a symlink: git writes a deletion and a creation under one path. */
export const FILE_TO_SYMLINK_DIFF = [
  "diff --git a/config.json b/config.json",
  "deleted file mode 100644",
  "--- a/config.json",
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
  "-a",
  "-b",
  "-c",
  "diff --git a/config.json b/config.json",
  "new file mode 120000",
  "--- /dev/null",
  "+++ b/config.json",
  "@@ -0,0 +1 @@",
  "+shared/config.json",
  "",
].join("\n");

const pr = {
  repo: "o/r",
  number: 1,
  title: "t",
  url: "https://github.com/o/r/pull/1",
  sha: "deadbeef",
  description: "d",
};

const generation = {
  provider: "anthropic",
  model: "claude-opus-4-8",
  effort: "medium",
} as const;

const changeGroup: ChangeGroup = {
  id: "g1",
  title: "g title",
  summary: "g",
  dominantCategory: "bugfix",
  secondaryCategories: [],
  uncertain: false,
  uncertainBetween: [],
};

const chunk: Chunk = {
  id: "c1",
  changeGroupId: "g1",
  file: "a.ts",
  concern: "implementation",
  role: "core",
  loc: { added: 1, deleted: 0 },
  addedRanges: [{ start: 5, end: 5 }],
  removedRanges: [],
  riskSurface: ["mutates-state"],
};

export function makeValidBrief(): Brief {
  return structuredClone({
    pr,
    index: 1,
    commitRange: { base: "base0000", head: "deadbeef", commitCount: 2 },
    generation,
    summary: "s",
    changeGroups: [changeGroup],
    chunks: [chunk],
    concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
  });
}

/** One valid Product change, with the fields a test cares about overridden. */
export function makeProductChange(
  overrides: Partial<ProductChange> = {},
): ProductChange {
  return {
    when: "a user creates an item whose name matches an archived one",
    before: "a second item was created beside the archived one",
    after: "the archived item is restored",
    affects: ProductChangeAreas.BUSINESS_RULE,
    beforeSource: BeforeSources.DIFF,
    groupIds: ["g1"],
    ...overrides,
  };
}

/** An available Product diff listing `changes`, claiming no more. */
export function makeProductDiffListing(changes: ProductChange[]): ProductDiff {
  return {
    availability: ProductDiffAvailabilities.AVAILABLE,
    changes,
    hasMore: false,
  };
}

export function makeValidProductDiff(): ProductDiff {
  return makeProductDiffListing([makeProductChange()]);
}

/** The valid Product diff with its one change overridden: junk values included. */
export function makeProductDiffWithChange(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const productDiff = makeValidProductDiff();
  return {
    ...productDiff,
    changes: [{ ...productDiff.changes[0], ...overrides }],
  };
}

/** The valid Product diff with its one change listed `length` times. */
export function makeProductDiffOfLength(length: number): ProductDiff {
  const change = makeProductChange();
  return makeProductDiffListing(Array.from({ length }, () => change));
}

const secondChunk = { ...chunk, id: "c2", changeGroupId: "g2", file: "b.ts" };

export function makeTwoGroupBrief(): Brief {
  return {
    ...makeValidBrief(),
    changeGroups: [structuredClone(changeGroup), { ...changeGroup, id: "g2" }],
    chunks: [structuredClone(chunk), structuredClone(secondChunk)],
  };
}

export function makeValidDeltaBrief(): DeltaBrief {
  return structuredClone({
    pr,
    baselineSha: "1111111",
    headSha: "2222222",
    baselineIndex: 1,
    headIndex: 2,
    generation,
    summary: "since you last looked, the author added a test",
    commentsAddressed: "addresses the request to add a test",
    changedGroups: [changeGroup],
    chunks: [
      {
        ...chunk,
        summary: "adds a unit test for the fix",
        addressesComments: ["101"],
      },
    ],
    wholePrImpact: "completes the original intent",
  });
}

export function makeSkippedDelta(): DeltaSkipped {
  return {
    artifactKind: "deltaSkipped",
    pr: structuredClone(pr),
    baselineSha: "1111111",
    headSha: "2222222",
    baselineIndex: 1,
    headIndex: null,
    skipped: DeltaSkipReasons.SPAN_TOO_LARGE,
  };
}

export function makeValidRevisionNarrative(): RevisionNarrative {
  return structuredClone({
    artifactKind: "revisionNarrative",
    pr,
    prevHeadSha: "prev0000",
    headSha: "deadbeef",
    prevIndex: 1,
    headIndex: 2,
    generation,
    overview: "This revision tightens error handling.",
    chunks: [
      {
        id: "rc1",
        briefChangeGroupId: "g1",
        file: "a.ts",
        addedRanges: [{ start: 5, end: 6 }],
        removedRanges: [],
        summary: "wraps the call in a guard",
      },
    ],
  });
}

export function makeSkippedRevisionNarrative(): RevisionNarrativeSkipped {
  return {
    artifactKind: "revisionNarrativeSkipped",
    pr: structuredClone(pr),
    prevHeadSha: "prev0000",
    headSha: "deadbeef",
    prevIndex: 1,
    headIndex: 2,
    skipped: RevisionNarrativeSkipReasons.SPAN_TOO_LARGE,
  };
}

export function makeUnchangedDelta(): DeltaUnchanged {
  return {
    artifactKind: "deltaUnchanged",
    pr: structuredClone(pr),
    baselineSha: "1111111",
    headSha: "2222222",
    baselineIndex: 1,
    headIndex: 2,
  };
}

export function makeUnchangedRevisionNarrative(): RevisionNarrativeUnchanged {
  return {
    artifactKind: "revisionNarrativeUnchanged",
    pr: structuredClone(pr),
    prevHeadSha: "prev0000",
    headSha: "deadbeef",
    prevIndex: 1,
    headIndex: 2,
  };
}

/** One request a `FakeGenerator` received, in call order. */
export interface RecordedRequest {
  label: string;
  system: string;
  user: string;
  userPrefix?: string;
  effort: Effort;
  schema: z.ZodType;
  salvageFields: readonly string[];
}

/** Picks the raw model answer for the request at `index` (0-based). */
export type FakeAnswer = (request: RecordedRequest, index: number) => unknown;

/**
 * Mocked Generator (no API key, no network): records each request and parses
 * the answer through the request's own schema, so a fixture that drifts from
 * the schema fails loudly.
 */
export class FakeGenerator implements Generator {
  readonly requests: RecordedRequest[] = [];

  constructor(private readonly answer: FakeAnswer) {}

  origin(effort: Effort): Generation {
    return { provider: "fake", model: "fake-model", effort };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    const request: RecordedRequest = {
      label: req.label,
      system: req.system,
      user: req.user,
      effort: req.effort,
      schema: req.schema,
      salvageFields: req.salvageFields ?? [],
    };
    if (req.userPrefix !== undefined) {
      request.userPrefix = req.userPrefix;
    }
    const index = this.requests.push(request) - 1;

    return req.schema.parse(this.answer(request, index));
  }
}

/** A `FakeGenerator` that answers every request with the same fixture. */
export function makeFakeGenerator(fixture: unknown): FakeGenerator {
  return new FakeGenerator(() => fixture);
}
