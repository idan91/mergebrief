import type { StoredRevisionNarrative } from "brief-core/artifact";
import {
  Concerns,
  RevisionNarrativeSkipReasons,
  Roles,
} from "brief-core/types";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildLocalBriefDiffsQueryOptions,
  buildLocalBriefQueryOptions,
} from "../../queries";
import type { Brief, ComparisonMarks } from "../types";
import { buildLocalComparisonPlan } from "./local-plan";

const serverFunctions = vi.hoisted(() => ({
  getLocalBrief: vi.fn(),
  getLocalBriefDiffs: vi.fn(),
  getLocalBriefs: vi.fn(),
  getLocalComparisonMarks: vi.fn(),
  getLocalRevisionChanges: vi.fn(),
  getLocalRevisionNarrative: vi.fn(),
}));
vi.mock("../server/brief.functions", () => serverFunctions);

afterEach(() => {
  vi.resetAllMocks();
});

const MARKS: ComparisonMarks = {
  baselineSha: "chk1234",
  headSha: "head1234",
  baselineLabel: "checkpoint",
  baselineIndex: 1,
  files: [],
};

const DELTA_BRIEF: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 42,
    title: "t",
    url: "https://example.com/pr/42",
    sha: "head1234",
    description: "",
  },
  summary: "s",
  changeGroups: [],
  chunks: [
    {
      id: "chunk-test",
      changeGroupId: "g1",
      file: "src/leak.test.ts",
      concern: Concerns.TEST,
      role: Roles.SUPPORTING,
      loc: { added: 1, deleted: 0 },
      addedRanges: [{ start: 1, end: 1 }],
      removedRanges: [],
      riskSurface: [],
    },
  ],
  concernView: [],
};

const SKIPPED_NARRATIVE: StoredRevisionNarrative = {
  artifactKind: "revisionNarrativeSkipped",
  pr: DELTA_BRIEF.pr,
  prevHeadSha: "prev1234",
  headSha: "head1234",
  prevIndex: 1,
  headIndex: 2,
  skipped: RevisionNarrativeSkipReasons.DISABLED_BY_CONFIG,
};

const DELTA_TEST_FILE_PATCH = "@@ -0,0 +1,1 @@\n+export {};";

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("buildLocalComparisonPlan", () => {
  it("offers no baseline without a comparison file", () => {
    expect(buildLocalComparisonPlan(undefined)).toEqual({});
    expect(buildLocalComparisonPlan({})).toEqual({});
  });

  it("reads previous-brief marks from the marks sidecar", async () => {
    serverFunctions.getLocalComparisonMarks.mockResolvedValue(MARKS);
    const plan = buildLocalComparisonPlan({
      previousBrief: {
        marksId: "marks-prev",
        baselineSha: "p",
        baselineIndex: 1,
      },
    });

    const marks = await makeQueryClient().fetchQuery(plan.previousBrief!.marks);

    expect(marks).toBe(MARKS);
    expect(serverFunctions.getLocalComparisonMarks).toHaveBeenCalledWith({
      data: { id: "marks-prev" },
    });
    expect(plan.lastReview).toBeUndefined();
  });

  it("answers no marks when the named sidecar reads as missing", async () => {
    serverFunctions.getLocalComparisonMarks.mockResolvedValue(null);
    const plan = buildLocalComparisonPlan({
      previousBrief: {
        marksId: "marks-prev",
        baselineSha: "p",
        baselineIndex: 1,
      },
    });

    await expect(
      makeQueryClient().fetchQuery(plan.previousBrief!.marks),
    ).rejects.toThrow("sidecar missing");
  });

  it("answers no narrative when the named sidecar reads as missing", async () => {
    serverFunctions.getLocalRevisionNarrative.mockResolvedValue(null);
    const plan = buildLocalComparisonPlan({
      previousBrief: {
        marksId: "marks-prev",
        narrativeId: "narrative-1",
        baselineSha: "p",
        baselineIndex: 1,
      },
    });

    await expect(
      makeQueryClient().fetchQuery(plan.previousBrief!.narrative!),
    ).rejects.toThrow("sidecar missing");
  });

  it("carries no narrative or raw diff without a narrative sidecar", () => {
    const plan = buildLocalComparisonPlan({
      previousBrief: {
        marksId: "marks-prev",
        baselineSha: "p",
        baselineIndex: 1,
      },
    });

    expect(plan.previousBrief?.narrative).toBeUndefined();
    expect(plan.previousBrief?.rawDiff).toBeUndefined();
  });

  it("reads the narrative sidecar, skip stubs included", async () => {
    serverFunctions.getLocalRevisionNarrative.mockResolvedValue(
      SKIPPED_NARRATIVE,
    );
    const plan = buildLocalComparisonPlan({
      previousBrief: {
        marksId: "marks-prev",
        narrativeId: "narrative-1",
        baselineSha: "p",
        baselineIndex: 1,
      },
    });

    const narrative = await makeQueryClient().fetchQuery(
      plan.previousBrief!.narrative!,
    );

    expect(narrative).toBe(SKIPPED_NARRATIVE);
    expect(serverFunctions.getLocalRevisionNarrative).toHaveBeenCalledWith({
      data: { id: "narrative-1" },
    });
  });

  it("offers a marks-only last review when no delta was written", async () => {
    serverFunctions.getLocalComparisonMarks.mockResolvedValue(MARKS);
    const plan = buildLocalComparisonPlan({
      lastReview: { marksId: "marks-chk", baselineSha: "c", baselineIndex: 1 },
    });

    const marks = await makeQueryClient().fetchQuery(plan.lastReview!.marks);

    expect(marks).toBe(MARKS);
    expect(plan.lastReview?.delta).toBeUndefined();
    expect(plan.lastReview?.rawDiff).toBeUndefined();
    expect(plan.previousBrief).toBeUndefined();
  });
});

describe("buildLocalComparisonPlan delta", () => {
  const LAST_REVIEW_WITH_DELTA = {
    lastReview: {
      marksId: "marks-chk",
      deltaId: "delta-1",
      baselineSha: "c",
      baselineIndex: 1,
    },
  };

  it("slices the delta's rows from its own diffs sidecar", async () => {
    serverFunctions.getLocalBrief.mockResolvedValue(DELTA_BRIEF);
    serverFunctions.getLocalBriefDiffs.mockResolvedValue([
      { file: "src/leak.test.ts", patch: DELTA_TEST_FILE_PATCH },
    ]);
    const plan = buildLocalComparisonPlan(LAST_REVIEW_WITH_DELTA);

    const delta = await makeQueryClient().fetchQuery(plan.lastReview!.delta!);

    expect(serverFunctions.getLocalBrief).toHaveBeenCalledWith({
      data: { briefId: "delta-1" },
    });
    expect(serverFunctions.getLocalBriefDiffs).toHaveBeenCalledWith({
      data: { briefId: "delta-1" },
    });
    const rows = delta.chunks[0]?.diff ?? [];
    expect(rows.map((row) => row.kind)).toEqual(["hunk", "add"]);
  });

  it("stays loading until both delta sidecars have landed", async () => {
    let releaseDiffs: (() => void) | undefined;
    serverFunctions.getLocalBrief.mockResolvedValue(DELTA_BRIEF);
    serverFunctions.getLocalBriefDiffs.mockReturnValue(
      new Promise((resolve) => {
        releaseDiffs = () => resolve([]);
      }),
    );
    const client = makeQueryClient();
    const plan = buildLocalComparisonPlan(LAST_REVIEW_WITH_DELTA);
    const descriptor = plan.lastReview!.delta!;

    const pending = client.fetchQuery(descriptor);
    await vi.waitFor(() =>
      expect(serverFunctions.getLocalBrief).toHaveBeenCalled(),
    );

    expect(client.getQueryData(descriptor.queryKey)).toBeUndefined();
    releaseDiffs?.();
    await expect(pending).resolves.toEqual(DELTA_BRIEF);
  });

  it("fails rather than answer row-less when the diffs sidecar fails", async () => {
    serverFunctions.getLocalBrief.mockResolvedValue(DELTA_BRIEF);
    serverFunctions.getLocalBriefDiffs.mockRejectedValue(
      new Error("sidecar unreadable"),
    );
    const plan = buildLocalComparisonPlan(LAST_REVIEW_WITH_DELTA);

    await expect(
      makeQueryClient().fetchQuery(plan.lastReview!.delta!),
    ).rejects.toThrow("sidecar unreadable");
  });

  it("reuses delta sidecars the cache already holds", async () => {
    const client = makeQueryClient();
    client.setQueryData(
      buildLocalBriefQueryOptions("delta-1").queryKey,
      DELTA_BRIEF,
    );
    client.setQueryData(
      buildLocalBriefDiffsQueryOptions("delta-1").queryKey,
      [],
    );
    const plan = buildLocalComparisonPlan(LAST_REVIEW_WITH_DELTA);

    const delta = await client.fetchQuery(plan.lastReview!.delta!);

    expect(delta).toEqual(DELTA_BRIEF);
    expect(serverFunctions.getLocalBrief).not.toHaveBeenCalled();
    expect(serverFunctions.getLocalBriefDiffs).not.toHaveBeenCalled();
  });
});
