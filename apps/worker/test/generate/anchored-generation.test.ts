import { describe, expect, it } from "vitest";
import { createArtifactStore, createGenerationProjection } from "persistence";
import { GenerationStatuses } from "types/generations";
import { GeneratorError } from "generators";
import type { Mutable } from "types/utils";
import { RepoConfigPaths } from "repo-config";
import { RepoFileKinds, type PullRequestInfo } from "github";
import { TransientJobError } from "../../src/task/failure";
import { FakeFailures, type FakeFailure } from "github/testing";
import {
  arrangeCompare,
  BASE,
  buildRepoFile,
  captureLogger,
  ctx,
  CUSTOM_RISK,
  CUSTOM_RISK_POLICY,
  harness,
  HEAD_1,
  HEAD_2,
  makeConnectionError,
  makeGitHub,
  makeTarget,
  makeTask,
  PR_REF,
  REPO,
  setUpHarness,
  stubGenerator,
  trigger,
  type TaskOverrides,
} from "./helpers";

/** Incremental diff touching only b.ts. */
const DIFF_TOUCHING_B = `diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,3 @@
 line
+added
 line2
`;

/** A two-group brief generation output over a.ts + b.ts. */
function makeTwoGroupBriefOutput(
  idA: string,
  titleA: string,
  idB: string,
  titleB: string,
): unknown {
  return {
    summary: "stub brief",
    intentCheck: {
      ticketUrls: [],
      ticketTitles: [],
      specificity: "none",
      scopeNote: "",
      items: [],
      alignment: { read: "", goal: "", response: "" },
    },
    changeGroups: [
      {
        id: idA,
        title: titleA,
        summary: `${titleA} summary`,
        dominantCategory: "bugfix",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
      {
        id: idB,
        title: titleB,
        summary: `${titleB} summary`,
        dominantCategory: "bugfix",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      },
    ],
    chunks: [
      {
        id: `${idA}c`,
        changeGroupId: idA,
        file: "a.ts",
        concern: "implementation",
        role: "core",
        loc: { added: 4, deleted: 0 },
        addedRanges: [{ start: 5, end: 8 }],
        removedRanges: [],
        riskSurface: [],
      },
      {
        id: `${idB}c`,
        changeGroupId: idB,
        file: "b.ts",
        concern: "implementation",
        role: "core",
        loc: { added: 2, deleted: 0 },
        addedRanges: [{ start: 1, end: 2 }],
        removedRanges: [],
        riskSurface: [],
      },
    ],
    concernView: [{ concern: "implementation", added: 6, deleted: 0 }],
  };
}

const BUILT_IN_RISK = "dense-logic";

/** Every hunk_span insert throws a Postgres error, as a lost connection would. */
async function refuseHopWrites(): Promise<void> {
  await harness.raw(
    "create function refuse_hop() returns trigger language plpgsql as $$ begin raise exception 'hop write refused'; end $$",
  );
  await harness.raw(
    "create trigger refuse_hop before insert on hunk_span for each row execute function refuse_hop()",
  );
}

setUpHarness();

describe("generate task, anchored generation", () => {
  const SPAN = { base: HEAD_1, head: HEAD_2 };

  /** Two-revision run: rev1 with gA/gB, then rev2 with the given output. */
  async function runTwoRevisions(options: {
    rev2Output?: unknown;
    fullRegeneration?: "always" | "on-model-swap" | "never";
    rev2Model?: string;
    rev2BaseSha?: string;
    compareFilesEntry?: {
      files: { filename: string; status: string }[];
      complete: boolean;
      status?: string;
    };
    /** Make the second revision's model call fail (the hop must survive). */
    rev2FailWith?: unknown;
    /** Make the second revision's hop write throw. */
    rev2HopRefused?: boolean;
    /** Fail the second revision's compare-files fetch. */
    rev2CompareFilesError?: FakeFailure;
    rev1Output?: unknown;
    /** A repo policy the first revision sees and the second no longer does. */
    rev1OnlyPolicy?: string;
  }) {
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.outputs["brief"] =
      options.rev1Output ??
      makeTwoGroupBriefOutput("gA", "alpha", "gB", "beta");
    const github = makeGitHub(HEAD_1, [
      { path: "a.ts", additions: 4, deletions: 0 },
      { path: "b.ts", additions: 2, deletions: 0 },
    ]);
    if (options.rev1OnlyPolicy !== undefined) {
      github.addRepoFile(
        REPO,
        { path: RepoConfigPaths.POLICY },
        buildRepoFile(options.rev1OnlyPolicy, "sha-p"),
      );
    }
    const { logger, readLines } = captureLogger();
    arrangeCompare(
      github,
      SPAN,
      DIFF_TOUCHING_B,
      options.compareFilesEntry ?? {
        files: [{ filename: "b.ts", status: "modified" }],
        complete: true,
        status: "ahead",
      },
    );
    const overrides: Mutable<TaskOverrides> = {
      generator,
      github,
      log: logger,
    };

    if (options.fullRegeneration !== undefined) {
      overrides.fullRegeneration = options.fullRegeneration;
    }

    const task = makeTask(overrides);
    await task(first.payload);
    github.addRepoFile(
      REPO,
      { path: RepoConfigPaths.POLICY },
      { kind: RepoFileKinds.ABSENT },
    );

    const revisedInfo: Mutable<Partial<PullRequestInfo>> = { headSha: HEAD_2 };

    if (options.rev2BaseSha !== undefined) {
      revisedInfo.baseSha = options.rev2BaseSha;
    }

    github.updatePullRequest(PR_REF, revisedInfo);
    generator.outputs["brief"] =
      options.rev2Output ??
      makeTwoGroupBriefOutput("tmpA", "alpha rewritten", "tmpB", "beta v2");
    if (options.rev2Model !== undefined) {
      const model = options.rev2Model;
      generator.origin = (effort) => ({
        provider: "stub",
        model,
        effort,
      });
    }
    if (options.rev2CompareFilesError !== undefined) {
      github.failOn("fetchCompareFiles", options.rev2CompareFilesError);
    }
    const second = await trigger(HEAD_2);
    if (options.rev2FailWith !== undefined) {
      generator.failNextWith = options.rev2FailWith;
      // oxlint-disable-next-line vitest/no-conditional-expect -- asserts the failure the caller staged.
      await expect(task(second.payload)).rejects.toThrow(GeneratorError);
    } else if (options.rev2HopRefused === true) {
      await refuseHopWrites();
      // oxlint-disable-next-line vitest/no-conditional-expect -- asserts the failure the caller staged.
      await expect(task(second.payload)).rejects.toThrow(TransientJobError);
    } else {
      await task(second.payload);
    }
    return { pr: second.pr, generator, github, readLines };
  }

  it("carries frozen groups verbatim and stamps anchored origin", async () => {
    const { pr } = await runTwoRevisions({});
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(row?.anchorState).toBe("anchored");
    expect(row?.anchorReason).toBeNull();
    const body = JSON.parse(row?.body ?? "{}") as {
      anchor?: unknown;
      anchoring?: unknown;
      changeGroups?: { id: string; title: string }[];
      chunks?: { id: string; file: string; changeGroupId: string }[];
    };
    expect(body.anchor).toEqual({ state: "anchored" });
    expect(body.anchoring).toEqual({ carried: ["gA"], regenerated: ["gB"] });
    // The untouched group survives byte-identical; the touched one is the
    // model's fresh take under its DESCENDED (previous) id.
    expect(body.changeGroups).toContainEqual(
      expect.objectContaining({ id: "gA", title: "alpha" }),
    );
    expect(body.changeGroups).toContainEqual(
      expect.objectContaining({ id: "gB", title: "beta v2" }),
    );
    const carried = body.chunks?.find((chunk) => chunk.file === "a.ts");
    expect(carried?.changeGroupId).toBe("gA");
  });

  it("passes the write check on a carried chunk whose attribute is gone", async () => {
    const rev1Output = makeTwoGroupBriefOutput("gA", "alpha", "gB", "beta") as {
      chunks: { file: string }[];
    };
    const firingChunks = rev1Output.chunks.map((chunk) =>
      chunk.file === "a.ts" ? { ...chunk, riskSurface: [CUSTOM_RISK] } : chunk,
    );
    const { pr, readLines } = await runTwoRevisions({
      rev1Output: { ...rev1Output, chunks: firingChunks },
      rev1OnlyPolicy: CUSTOM_RISK_POLICY,
    });

    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(row?.anchorState).toBe("anchored");
    expect(row?.carriedChunkIds).toEqual(["gAc"]);
    const body = JSON.parse(row?.body ?? "{}") as {
      chunks: { id: string; riskSurface: string[] }[];
    };
    const carried = body.chunks.find((chunk) => chunk.id === "gAc");
    expect(carried?.riskSurface).toEqual([CUSTOM_RISK]);
    expect(
      readLines().some((line) => line["evt"] === "artifact.check.fail"),
    ).toBe(false);
  });

  it("passes the write check on a carried chunk with a built-in risk", async () => {
    const rev1Output = makeTwoGroupBriefOutput("gA", "alpha", "gB", "beta") as {
      chunks: { file: string }[];
    };
    const firingChunks = rev1Output.chunks.map((chunk) =>
      chunk.file === "a.ts"
        ? { ...chunk, riskSurface: [BUILT_IN_RISK] }
        : chunk,
    );
    const { pr, readLines } = await runTwoRevisions({
      rev1Output: { ...rev1Output, chunks: firingChunks },
    });

    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(row?.anchorState).toBe("anchored");
    expect(row?.carriedChunkIds).toEqual(["gAc"]);
    const body = JSON.parse(row?.body ?? "{}") as {
      chunks: { id: string; riskSurface: string[] }[];
    };
    const carried = body.chunks.find((chunk) => chunk.id === "gAc");
    expect(carried?.riskSurface).toEqual([BUILT_IN_RISK]);
    expect(
      readLines().some((line) => line["evt"] === "artifact.check.fail"),
    ).toBe(false);
  });

  it("persists the hop and the carried chunk set alongside the brief", async () => {
    const { pr } = await runTwoRevisions({});
    const store = createArtifactStore(harness.handle, ctx);
    const hops = await store.hunkSpans.listForPullRequest(pr.id);
    expect(hops).toHaveLength(1);
    expect(hops[0]?.baselineSha).toBe(HEAD_1);
    expect(hops[0]?.headSha).toBe(HEAD_2);
    expect(JSON.parse(hops[0]?.spans ?? "[]")).toEqual([
      { file: "b.ts", hunks: [expect.objectContaining({ oldStart: 1 })] },
    ]);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    const body = JSON.parse(row?.body ?? "{}") as {
      chunks?: { id: string; file: string }[];
    };
    // Exactly the carried chunks: the a.ts chunk froze, b.ts was regenerated.
    const carriedIds = (body.chunks ?? [])
      .filter((chunk) => chunk.file === "a.ts")
      .map((chunk) => chunk.id);
    expect(row?.carriedChunkIds).toEqual(carriedIds);
    expect(carriedIds).toHaveLength(1);
  });

  it("accumulates the chain's used group ids on the anchored path", async () => {
    const { pr } = await runTwoRevisions({});
    const store = createArtifactStore(harness.handle, ctx);
    const rev1 = await store.briefs.get(pr.id, BASE, HEAD_1);
    expect(rev1?.usedGroupIds).toEqual(["gA", "gB"]);
    // Rev 2's groups descend back onto gA/gB, the union gains nothing.
    const rev2 = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(rev2?.usedGroupIds).toEqual(["gA", "gB"]);
  });

  it("a fresh restart still accumulates the chain's used ids", async () => {
    // `always` writes the model's raw ids, the chain set must still union
    // them with history, or the next descent could resurrect gA/gB.
    const { pr } = await runTwoRevisions({ fullRegeneration: "always" });
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(row?.usedGroupIds).toEqual(["gA", "gB", "tmpA", "tmpB"]);
  });

  it("a same-head base retarget keeps the chain's used ids", async () => {
    // One briefed head, then the base retargets under it: `prevBrief` (a
    // DIFFERENT head) is undefined, so the chain must read off the newest
    // row itself. `gZ` lives only in the stored column, in no body, the
    // assertion fails if the read falls back to the body or resets.
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.outputs["brief"] = makeTwoGroupBriefOutput(
      "gA",
      "alpha",
      "gB",
      "beta",
    );
    const github = makeGitHub(HEAD_1, [
      { path: "a.ts", additions: 4, deletions: 0 },
      { path: "b.ts", additions: 2, deletions: 0 },
    ]);
    const task = makeTask({ generator, github });
    await task(first.payload);
    await harness.raw(
      `update brief set used_group_ids = '{gA,gB,gZ}' where head_sha = '${HEAD_1}'`,
    );

    const BASE_2 = "d".repeat(40);
    github.updatePullRequest(PR_REF, { baseSha: BASE_2 });
    generator.outputs["brief"] = makeTwoGroupBriefOutput(
      "tmpA",
      "alpha again",
      "tmpB",
      "beta again",
    );
    const again = await trigger(HEAD_1);
    await task(again.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(again.pr.id, BASE_2, HEAD_1);
    expect(row?.usedGroupIds).toEqual(["gA", "gB", "gZ", "tmpA", "tmpB"]);
  });

  it("heals a NULL chain column from the previous body", async () => {
    // Rev 1 predates the column (NULL): the fresh rev-2 union must still
    // hold rev 1's ids, seeded from the recovered body.
    const first = await trigger(HEAD_1);
    const generator = stubGenerator();
    generator.outputs["brief"] = makeTwoGroupBriefOutput(
      "gA",
      "alpha",
      "gB",
      "beta",
    );
    const github = makeGitHub(HEAD_1, [
      { path: "a.ts", additions: 4, deletions: 0 },
      { path: "b.ts", additions: 2, deletions: 0 },
    ]);
    const task = makeTask({ generator, github, fullRegeneration: "always" });
    await task(first.payload);
    await harness.raw(
      `update brief set used_group_ids = null where head_sha = '${HEAD_1}'`,
    );

    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    generator.outputs["brief"] = makeTwoGroupBriefOutput(
      "tmpA",
      "alpha v2",
      "tmpB",
      "beta v2",
    );
    const second = await trigger(HEAD_2);
    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(second.pr.id, BASE, HEAD_2);
    expect(row?.usedGroupIds).toEqual(["gA", "gB", "tmpA", "tmpB"]);
  });

  it("leaves the hop behind when the model call fails", async () => {
    const { pr } = await runTwoRevisions({
      rev2FailWith: makeConnectionError(),
    });
    const store = createArtifactStore(harness.handle, ctx);
    // No brief for the failed head, but the hop is durable: the next session
    // can still place its anchors across the push.
    expect(await store.briefs.get(pr.id, BASE, HEAD_2)).toBeUndefined();
    expect(await store.hunkSpans.listForPullRequest(pr.id)).toHaveLength(1);
  });

  it("rethrows a hop write the database refuses so graphile retries it", async () => {
    const { pr, generator, readLines } = await runTwoRevisions({
      rev2HopRefused: true,
    });

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_2),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe("unknown");
    const briefRequests = generator.requests.filter(
      (request) => request.label === "brief",
    );
    expect(briefRequests).toHaveLength(1);
    const lines = readLines();
    const jobFail = lines.find((line) => line["evt"] === "job.fail");
    expect(jobFail?.["permanent"]).toBe(false);
    const failedCall = lines.some(
      (line) =>
        line["evt"] === "generation.complete" &&
        line["outcome"] === GenerationStatuses.FAILED,
    );
    expect(failedCall).toBe(false);
  });

  it("writes an empty carried set when nothing anchors", async () => {
    const { pr } = await runTwoRevisions({ fullRegeneration: "always" });
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(row?.anchorState).toBe("none");
    expect(row?.carriedChunkIds).toEqual([]);
    expect(await store.hunkSpans.listForPullRequest(pr.id)).toHaveLength(0);
  });

  it("always mode keeps fresh ids and stamps anchoring none", async () => {
    const { pr } = await runTwoRevisions({ fullRegeneration: "always" });
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(row?.anchorState).toBe("none");
    const body = JSON.parse(row?.body ?? "{}") as {
      anchor?: unknown;
      anchoring?: unknown;
      changeGroups?: { id: string }[];
    };
    expect(body.anchor).toEqual({ state: "none" });
    expect(body.anchoring).toBeUndefined();
    expect(body.changeGroups?.map((group) => group.id)).toEqual([
      "tmpA",
      "tmpB",
    ]);
  });

  it("on-model-swap restarts fresh and stamps the changed-model reason", async () => {
    const { pr } = await runTwoRevisions({
      fullRegeneration: "on-model-swap",
      rev2Model: "stub-model-2",
    });
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE, HEAD_2);
    expect(row?.anchorState).toBe("fresh-restart");
    expect(row?.anchorReason).toBe("model-swap");
    const body = JSON.parse(row?.body ?? "{}") as {
      anchor?: unknown;
      changeGroups?: { id: string }[];
    };
    expect(body.anchor).toEqual({
      state: "fresh-restart",
      reason: "model-swap",
    });
    expect(body.changeGroups?.map((group) => group.id)).toEqual([
      "tmpA",
      "tmpB",
    ]);
  });

  it("`on-model-swap` with an unchanged model anchors normally", async () => {
    const { pr } = await runTwoRevisions({ fullRegeneration: "on-model-swap" });
    const row = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_2,
    );
    expect(row?.anchorState).toBe("anchored");
  });

  it("reviews everything after a base move while retaining id descent", async () => {
    const BASE_2 = "d".repeat(40);
    const { pr } = await runTwoRevisions({ rev2BaseSha: BASE_2 });
    const store = createArtifactStore(harness.handle, ctx);
    const row = await store.briefs.get(pr.id, BASE_2, HEAD_2);
    expect(row?.anchorState).toBe("anchored");
    const body = JSON.parse(row?.body ?? "{}") as {
      anchoring?: { carried: string[]; regenerated: string[] };
      changeGroups?: { id: string; title: string }[];
    };
    expect(body.anchoring?.carried).toEqual([]);
    // Nothing carried, but descent still maps the fresh groups onto the
    // previous ids, group identity survives the rebase.
    expect(body.changeGroups?.map((group) => group.id).toSorted()).toEqual([
      "gA",
      "gB",
    ]);
    expect(body.changeGroups?.find((group) => group.id === "gA")?.title).toBe(
      "alpha rewritten",
    );
  });

  it("threads the anchor view and anchored prompt into the model call", async () => {
    const { generator } = await runTwoRevisions({});
    const briefRequests = generator.requests.filter(
      (request) => request.label === "brief",
    );
    expect(briefRequests).toHaveLength(2);
    expect(briefRequests[0]?.system).not.toContain("Anchored regeneration");
    expect(briefRequests[0]?.user).not.toContain("<anchor_brief");
    expect(briefRequests[1]?.system).toContain("Anchored regeneration");
    expect(briefRequests[1]?.user).toContain("<anchor_brief");
    // The frozen index names the untouched group; the summary rides verbatim.
    expect(briefRequests[1]?.user).toContain("gA");
  });

  it("degrades to a full re-look when compare files cannot be fetched", async () => {
    const { pr, generator } = await runTwoRevisions({
      rev2CompareFilesError: FakeFailures.SERVER_ERROR,
    });
    const row = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_2,
    );
    // The job still runs and still anchors: the previous brief and the chain's
    // ids survive. Nothing carries, because the compare-files list is what
    // confirms a group untouched, and it never arrived.
    expect(row?.anchorState).toBe("anchored");
    const body = JSON.parse(row?.body ?? "{}") as {
      anchoring?: { carried: string[] };
    };
    expect(body.anchoring?.carried).toEqual([]);
    const briefRequests = generator.requests.filter(
      (request) => request.label === "brief",
    );
    expect(briefRequests[1]?.system).toContain("Anchored regeneration");
  });

  it("carries nothing for diverged same-base spans but remains anchored", async () => {
    const { pr } = await runTwoRevisions({
      compareFilesEntry: {
        files: [{ filename: "b.ts", status: "modified" }],
        complete: true,
        status: "diverged",
      },
    });
    const row = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_2,
    );
    expect(row?.anchorState).toBe("anchored");
    const body = JSON.parse(row?.body ?? "{}") as {
      anchoring?: { carried: string[] };
    };
    expect(body.anchoring?.carried).toEqual([]);
  });

  it("writes a file split across two groups instead of failing", async () => {
    const rev2Output = {
      summary: "stub brief",
      intentCheck: {
        ticketUrls: [],
        ticketTitles: [],
        specificity: "none",
        scopeNote: "",
        items: [],
        alignment: { read: "", goal: "", response: "" },
      },
      changeGroups: [
        {
          id: "tmpA",
          title: "only alpha",
          summary: "s",
          dominantCategory: "bugfix",
          secondaryCategories: [],
          uncertain: false,
          uncertainBetween: [],
        },
        {
          id: "tmpB",
          title: "also beta",
          summary: "s",
          dominantCategory: "bugfix",
          secondaryCategories: [],
          uncertain: false,
          uncertainBetween: [],
        },
      ],
      chunks: [
        {
          id: "c9",
          changeGroupId: "tmpA",
          file: "b.ts",
          concern: "implementation",
          role: "core",
          loc: { added: 2, deleted: 0 },
          addedRanges: [{ start: 1, end: 2 }],
          removedRanges: [],
          riskSurface: [],
        },
        {
          id: "c10",
          changeGroupId: "tmpB",
          file: "b.ts",
          concern: "implementation",
          role: "core",
          loc: { added: 2, deleted: 0 },
          addedRanges: [{ start: 3, end: 4 }],
          removedRanges: [],
          riskSurface: [],
        },
      ],
      concernView: [{ concern: "implementation", added: 4, deleted: 0 }],
    };
    const { pr } = await runTwoRevisions({ rev2Output });
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_2),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_2,
    );
    const body = JSON.parse(brief?.body ?? "{}") as {
      chunks?: { file: string; changeGroupId: string }[];
    };
    const owners = (body.chunks ?? [])
      .filter((chunk) => chunk.file === "b.ts")
      .map((chunk) => chunk.changeGroupId);
    expect(new Set(owners).size).toBe(2);
  });
});
