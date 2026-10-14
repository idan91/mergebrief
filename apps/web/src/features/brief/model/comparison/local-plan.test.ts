import type { StoredRevisionNarrative } from "brief-core/artifact";
import {
  Concerns,
  RevisionNarrativeSkipReasons,
  Roles,
} from "brief-core/types";
import { QueryClient } from "@tanstack/react-query";
import { ChangeGroupCategories } from "types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildLocalBriefDiffsQueryOptions,
  buildLocalBriefQueryOptions,
} from "../../queries";
import type { Brief, ComparisonMarks } from "../types";
import { buildLocalComparisonPlan } from "./local-plan";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../data/apiFetch", async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch,
}));

const MARKS_PREV_PATH = "/api/local-briefs/marks-prev/comparison-marks";
const NARRATIVE_PATH = "/api/local-briefs/narrative-1/revision-narrative";
const DELTA_PATH = "/api/local-briefs/delta-1";
const DELTA_DIFFS_PATH = "/api/local-briefs/delta-1/diffs";

function stubJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function stubStatus(status: number): Response {
  return new Response(null, { status });
}

/** Answers each path from `routes`; any other path is a 404. */
function stubApi(routes: Record<string, () => Promise<Response>>): void {
  apiFetch.mockImplementation(async (path: string) => {
    const route = routes[path];
    return route === undefined ? stubStatus(404) : route();
  });
}

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
  changeGroups: [
    {
      id: "g1",
      title: "g",
      summary: "g",
      dominantCategory: ChangeGroupCategories.BUGFIX,
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
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

const DELTA_VIEW = { artifactKind: "brief", body: DELTA_BRIEF };

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
    stubApi({ [MARKS_PREV_PATH]: async () => stubJson(MARKS) });
    const plan = buildLocalComparisonPlan({
      previousBrief: {
        marksId: "marks-prev",
        baselineSha: "p",
        baselineIndex: 1,
      },
    });

    const marks = await makeQueryClient().fetchQuery(plan.previousBrief!.marks);

    expect(marks).toEqual(MARKS);
    expect(apiFetch).toHaveBeenCalledWith(MARKS_PREV_PATH, { method: "GET" });
    expect(plan.lastReview).toBeUndefined();
  });

  it("answers no marks when the named sidecar reads as missing", async () => {
    stubApi({});
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
    stubApi({});
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
    stubApi({ [NARRATIVE_PATH]: async () => stubJson(SKIPPED_NARRATIVE) });
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

    expect(narrative).toEqual(SKIPPED_NARRATIVE);
    expect(apiFetch).toHaveBeenCalledWith(NARRATIVE_PATH, { method: "GET" });
  });

  it("offers a marks-only last review when no delta was written", async () => {
    stubApi({
      "/api/local-briefs/marks-chk/comparison-marks": async () =>
        stubJson(MARKS),
    });
    const plan = buildLocalComparisonPlan({
      lastReview: { marksId: "marks-chk", baselineSha: "c", baselineIndex: 1 },
    });

    const marks = await makeQueryClient().fetchQuery(plan.lastReview!.marks);

    expect(marks).toEqual(MARKS);
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
    stubApi({
      [DELTA_PATH]: async () => stubJson(DELTA_VIEW),
      [DELTA_DIFFS_PATH]: async () =>
        stubJson([{ file: "src/leak.test.ts", patch: DELTA_TEST_FILE_PATCH }]),
    });
    const plan = buildLocalComparisonPlan(LAST_REVIEW_WITH_DELTA);

    const delta = await makeQueryClient().fetchQuery(plan.lastReview!.delta!);

    expect(apiFetch).toHaveBeenCalledWith(DELTA_PATH, { method: "GET" });
    expect(apiFetch).toHaveBeenCalledWith(DELTA_DIFFS_PATH, { method: "GET" });
    const rows = delta.chunks[0]?.diff ?? [];
    expect(rows.map((row) => row.kind)).toEqual(["hunk", "add"]);
  });

  it("stays loading until both delta sidecars have landed", async () => {
    let releaseDiffs: (() => void) | undefined;
    stubApi({
      [DELTA_PATH]: async () => stubJson(DELTA_VIEW),
      [DELTA_DIFFS_PATH]: () =>
        new Promise((resolve) => {
          releaseDiffs = () => resolve(stubJson([]));
        }),
    });
    const client = makeQueryClient();
    const plan = buildLocalComparisonPlan(LAST_REVIEW_WITH_DELTA);
    const descriptor = plan.lastReview!.delta!;

    const pending = client.fetchQuery(descriptor);
    await vi.waitFor(() => expect(releaseDiffs).toBeDefined());

    expect(client.getQueryData(descriptor.queryKey)).toBeUndefined();
    releaseDiffs?.();
    await expect(pending).resolves.toEqual(DELTA_BRIEF);
  });

  it("fails rather than answer row-less when the diffs sidecar fails", async () => {
    stubApi({
      [DELTA_PATH]: async () => stubJson(DELTA_VIEW),
      [DELTA_DIFFS_PATH]: async () => stubStatus(500),
    });
    const plan = buildLocalComparisonPlan(LAST_REVIEW_WITH_DELTA);

    await expect(
      makeQueryClient().fetchQuery(plan.lastReview!.delta!),
    ).rejects.toMatchObject({ code: "internal-error" });
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
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
