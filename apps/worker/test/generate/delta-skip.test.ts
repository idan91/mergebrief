import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
  type PullRequestRow,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import {
  GeneratorError,
  GeneratorErrorKinds,
  type Effort,
  type GenerateRequest,
  type Generator,
} from "generators";
import { FakeFailures, type FakeGitHub } from "github/testing";
import {
  arrangeRevisionSpan,
  BASE,
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  LARGE_PR_FILES,
  makeGitHub,
  MANY_HUNKS_DIFF,
  makeReviewerId,
  makeTarget,
  makeTask,
  PR_REF,
  setUpHarness,
  stubGenerator,
  trigger,
  type StubGenerator,
} from "./helpers";

setUpHarness();

const FILE_HEADER = "diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n";

/** One changed line in b.ts: a span the delta call reads. */
const SMALL_SPAN_DIFF = `${FILE_HEADER}@@ -1 +1 @@\n-x\n+y\n`;

/** 8 changed lines, huge against a 10-line whole-PR churn (ratio 0.8). */
const RATIO_HUGE_DIFF = `${FILE_HEADER}@@ -1,8 +1,8 @@\n${"+x\n".repeat(8)}`;

/** Past the hunk limit, with a changed lockfile the skip must not read. */
const MANY_HUNKS_LOCKFILE_DIFF = `${MANY_HUNKS_DIFF}diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n--- a/pnpm-lock.yaml\n+++ b/pnpm-lock.yaml\n@@ -1 +1 @@\n-a\n+b\n`;

interface CheckpointedSecondHead {
  readonly pr: PullRequestRow;
  readonly payload: unknown;
  readonly github: FakeGitHub;
}

async function checkpointReviewerAt(
  pr: PullRequestRow,
  sha: string,
): Promise<void> {
  const repo = createTenantRepository(harness.handle, ctx);
  await repo.checkpoints.upsertOnSubmit({
    pullRequestId: pr.id,
    reviewerId: makeReviewerId(100n),
    lastSubmittedSha: sha,
    submittedAt: new Date(),
  });
}

/** Briefs HEAD_1, checkpoints a reviewer there, and pushes HEAD_2 with `spanDiff`. */
async function pushPastCheckpoint(
  task: (payload: unknown) => Promise<void>,
  github: FakeGitHub,
  spanDiff: string,
): Promise<CheckpointedSecondHead> {
  const first = await trigger(HEAD_1);
  await task(first.payload);
  await checkpointReviewerAt(first.pr, HEAD_1);

  github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
  arrangeRevisionSpan(github, spanDiff);
  const second = await trigger(HEAD_2);
  return { ...second, github };
}

async function readDeltaRow(pr: PullRequestRow) {
  return createArtifactStore(harness.handle, ctx).deltas.get(
    pr.id,
    HEAD_1,
    HEAD_2,
  );
}

function countDeltaCalls(generator: StubGenerator): number {
  return generator.calls.filter((label) => label === "delta").length;
}

/** `generator`, except every delta call stops at its output cap. */
function stubCutDeltaGenerator(generator: StubGenerator): Generator {
  return {
    async generate<S extends z.ZodType>(
      req: GenerateRequest<S>,
    ): Promise<z.infer<S>> {
      if (req.label === "delta") {
        generator.calls.push(req.label);
        throw new GeneratorError(
          GeneratorErrorKinds.OUTPUT_CUT,
          "delta: output reached max_tokens",
        );
      }
      return generator.generate(req);
    },
    origin: (effort: Effort) => generator.origin(effort),
  };
}

describe("generate task, a checkpoint span too large for its delta", () => {
  it("writes the skip record at the huge-span ratio, marks kept", async () => {
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    const task = makeTask({ generator, github });
    const second = await pushPastCheckpoint(task, github, RATIO_HUGE_DIFF);

    await task(second.payload);

    const row = await readDeltaRow(second.pr);
    expect(JSON.parse(row?.body ?? "{}")).toMatchObject({
      artifactKind: "deltaSkipped",
      baselineSha: HEAD_1,
      headSha: HEAD_2,
      baselineIndex: 1,
      headIndex: 2,
      skipped: "span-too-large",
    });
    const store = createArtifactStore(harness.handle, ctx);
    expect(
      await store.comparisonMarks.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeDefined();
    expect(countDeltaCalls(generator)).toBe(0);
  });

  it("writes the skip record past 120 hunks without a delta call", async () => {
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1, LARGE_PR_FILES);
    const task = makeTask({ generator, github });
    const second = await pushPastCheckpoint(task, github, MANY_HUNKS_DIFF);

    await task(second.payload);

    const row = await readDeltaRow(second.pr);
    expect(JSON.parse(row?.body ?? "{}")).toMatchObject({
      artifactKind: "deltaSkipped",
      skipped: "span-too-large",
    });
    expect(countDeltaCalls(generator)).toBe(0);
  });

  it("skips a span past the call limits without reading its lockfiles", async () => {
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1, LARGE_PR_FILES);
    const task = makeTask({ generator, github });
    const second = await pushPastCheckpoint(
      task,
      github,
      MANY_HUNKS_LOCKFILE_DIFF,
    );

    await task(second.payload);

    const row = await readDeltaRow(second.pr);
    expect(JSON.parse(row?.body ?? "{}")).toMatchObject({
      skipped: "span-too-large",
    });
    const lockfileReads = github.calls.filter((call) => {
      const { path, ref } = call.input as { path?: string; ref?: string };
      const isSummaryRead = path === "pnpm-lock.yaml" && ref === BASE;
      return call.operation === "fetchMergeBase" || isSummaryRead;
    });
    expect(lockfileReads).toEqual([]);
  });

  it("turns a delta cut at its output cap into a skip record", async () => {
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    const task = makeTask({
      generator: stubCutDeltaGenerator(generator),
      github,
    });
    const second = await pushPastCheckpoint(task, github, SMALL_SPAN_DIFF);

    await task(second.payload);

    const projection = createGenerationProjection(harness.handle, ctx);
    const status = (await projection.get(makeTarget(second.pr, HEAD_2)))
      ?.status;
    expect(status).toBe(GenerationStatuses.SUCCEEDED);
    const row = await readDeltaRow(second.pr);
    expect(JSON.parse(row?.body ?? "{}")).toMatchObject({
      artifactKind: "deltaSkipped",
      skipped: "output-cut",
    });
    expect(countDeltaCalls(generator)).toBe(1);
  });

  it("logs a cut delta call as skipped, not failed", async () => {
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    const { logger, readLines } = captureLogger();
    const task = makeTask({
      generator: stubCutDeltaGenerator(generator),
      github,
      log: logger,
    });
    const second = await pushPastCheckpoint(task, github, SMALL_SPAN_DIFF);

    await task(second.payload);

    const deltaCalls = readLines().filter(
      (line) =>
        line["evt"] === "generation.complete" && line["kind"] === "delta",
    );
    expect(deltaCalls.map((line) => line["outcome"])).toEqual(["skipped"]);
  });

  it("writes the skip record when GitHub refuses a fetched span", async () => {
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    const task = makeTask({ generator, github });
    const first = await trigger(HEAD_1);
    await task(first.payload);
    await checkpointReviewerAt(first.pr, BASE);
    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    github.failOn("fetchCheckedCompareDiff", FakeFailures.NOT_ACCEPTABLE);
    const second = await trigger(HEAD_2);

    await task(second.payload);

    const row = await createArtifactStore(harness.handle, ctx).deltas.get(
      second.pr.id,
      BASE,
      HEAD_2,
    );
    expect(JSON.parse(row?.body ?? "{}")).toMatchObject({
      artifactKind: "deltaSkipped",
      baselineSha: BASE,
      headSha: HEAD_2,
      skipped: "span-too-large",
    });
    expect(countDeltaCalls(generator)).toBe(0);
  });

  it("writes no record when the span's commits are gone", async () => {
    const github = makeGitHub(HEAD_1);
    const task = makeTask({ github });
    const first = await trigger(HEAD_1);
    await task(first.payload);
    await checkpointReviewerAt(first.pr, BASE);
    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    github.failOn("fetchCheckedCompareDiff", FakeFailures.NOT_FOUND);
    const second = await trigger(HEAD_2);

    await task(second.payload);

    const row = await createArtifactStore(harness.handle, ctx).deltas.get(
      second.pr.id,
      BASE,
      HEAD_2,
    );
    expect(row).toBeUndefined();
  });

  it("never asks again for a span it already skipped", async () => {
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);
    const task = makeTask({ generator, github });
    const second = await pushPastCheckpoint(task, github, RATIO_HUGE_DIFF);
    await task(second.payload);
    arrangeRevisionSpan(github, SMALL_SPAN_DIFF);

    await task(second.payload);

    expect(countDeltaCalls(generator)).toBe(0);
  });

  it("stamps the skip record with the stored brief's origin", async () => {
    const github = makeGitHub(HEAD_1);
    const briefTask = makeTask({ github, effort: "high" });
    const first = await trigger(HEAD_1);
    await briefTask(first.payload);
    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await briefTask(second.payload);
    await checkpointReviewerAt(second.pr, HEAD_1);
    arrangeRevisionSpan(github, RATIO_HUGE_DIFF);

    await makeTask({ github, effort: "low" })(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const brief = await store.briefs.get(second.pr.id, BASE, HEAD_2);
    expect(brief?.effort).toBe("high");
    expect(await readDeltaRow(second.pr)).toMatchObject({
      provider: brief?.provider,
      model: brief?.model,
      effort: "high",
    });
  });
});
