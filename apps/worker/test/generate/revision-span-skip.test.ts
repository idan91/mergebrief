import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
} from "persistence";
import { FakeFailures, type FakeFailure } from "github/testing";
import { GenerationStatuses } from "types/generations";
import { describe, expect, it } from "vitest";
import {
  arrangeCompare,
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
  type TaskOverrides,
} from "./helpers";

setUpHarness();

/** Briefs HEAD_1, then pushes HEAD_2 with its revision span refused. */
async function runSecondHeadWithSpanRefused(
  failure: FakeFailure,
  overrides: TaskOverrides = {},
) {
  const first = await trigger(HEAD_1);
  const generator = stubGenerator();
  const github = makeGitHub(HEAD_1);
  const { logger, readLines } = captureLogger();
  const task = makeTask({ ...overrides, generator, github, log: logger });
  await task(first.payload);

  github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
  github.failOn("fetchCompareDiff", failure);
  const second = await trigger(HEAD_2);
  return { second: { ...second, github }, task, generator, readLines };
}

describe("generate task, a refused revision span", () => {
  it("writes the span-too-large record on a 406 and still succeeds", async () => {
    const { second, task, generator, readLines } =
      await runSecondHeadWithSpanRefused(FakeFailures.NOT_ACCEPTABLE);

    await task(second.payload);

    const projection = createGenerationProjection(harness.handle, ctx);
    const row = await projection.get(makeTarget(second.pr, HEAD_2));
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    const store = createArtifactStore(harness.handle, ctx);
    const narrative = await store.revisionNarratives.get(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    expect(JSON.parse(narrative?.body ?? "{}")).toMatchObject({
      artifactKind: "revisionNarrativeSkipped",
      prevHeadSha: HEAD_1,
      headSha: HEAD_2,
      skipped: "span too large",
    });
    expect(
      await store.comparisonMarks.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeUndefined();
    expect(generator.calls).not.toContain("revision narrative");
    expect(readLines()).toContainEqual(
      expect.objectContaining({ msg: expect.stringContaining("skip stub") }),
    );
  });

  it("records a disabled narrative as disabled on a 406 span", async () => {
    const { second, task } = await runSecondHeadWithSpanRefused(
      FakeFailures.NOT_ACCEPTABLE,
      { revisionNarrative: { enabled: false } },
    );

    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const narrative = await store.revisionNarratives.get(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    expect(JSON.parse(narrative?.body ?? "{}")).toMatchObject({
      artifactKind: "revisionNarrativeSkipped",
      skipped: "disabled by config",
    });
  });

  it("warns on another permanent refusal and writes no span artifact", async () => {
    const { second, task, readLines } = await runSecondHeadWithSpanRefused(
      FakeFailures.NOT_FOUND,
    );

    await task(second.payload);

    const projection = createGenerationProjection(harness.handle, ctx);
    const row = await projection.get(makeTarget(second.pr, HEAD_2));
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    const store = createArtifactStore(harness.handle, ctx);
    expect(
      await store.revisionNarratives.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeUndefined();
    expect(readLines()).toContainEqual(
      expect.objectContaining({
        level: "warn",
        msg: expect.stringContaining("revision span"),
      }),
    );
  });

  it("reads a refused span once when a checkpoint sits at the last head", async () => {
    const { second, task, generator } = await runSecondHeadWithSpanRefused(
      FakeFailures.NOT_ACCEPTABLE,
    );
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: second.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: HEAD_1,
      submittedAt: new Date(),
    });
    const github = second.github;

    await task(second.payload);

    const spanReads = github
      .listCalls("fetchCompareDiff")
      .filter((call) => JSON.stringify(call.input).includes(HEAD_1));
    expect(spanReads).toHaveLength(1);
    expect(generator.calls).not.toContain("delta");
    const delta = await createArtifactStore(harness.handle, ctx).deltas.get(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    expect(JSON.parse(delta?.body ?? "{}")).toMatchObject({
      artifactKind: "deltaSkipped",
      skipped: "span-too-large",
    });
  });

  it("writes the narrative skip record on a short compare diff", async () => {
    const { second, task } = await runSecondHeadWithSpanRefused(
      FakeFailures.DIFF_INCOMPLETE,
    );

    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const narrative = await store.revisionNarratives.get(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    expect(JSON.parse(narrative?.body ?? "{}")).toMatchObject({
      skipped: "span too large",
    });
  });

  it("writes the span-too-large record on a 422 and still succeeds", async () => {
    const { second, task } = await runSecondHeadWithSpanRefused(
      FakeFailures.DIFF_RENDER_TIMEOUT,
    );

    await task(second.payload);

    const projection = createGenerationProjection(harness.handle, ctx);
    const row = await projection.get(makeTarget(second.pr, HEAD_2));
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    const store = createArtifactStore(harness.handle, ctx);
    const narrative = await store.revisionNarratives.get(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    expect(JSON.parse(narrative?.body ?? "{}")).toMatchObject({
      artifactKind: "revisionNarrativeSkipped",
      skipped: "span too large",
    });
  });

  it("warns past a 5xx span failure and still succeeds", async () => {
    const { second, task, readLines } = await runSecondHeadWithSpanRefused(
      FakeFailures.SERVER_ERROR,
    );

    await task(second.payload);

    const projection = createGenerationProjection(harness.handle, ctx);
    const row = await projection.get(makeTarget(second.pr, HEAD_2));
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    const store = createArtifactStore(harness.handle, ctx);
    expect(
      await store.revisionNarratives.get(second.pr.id, HEAD_1, HEAD_2),
    ).toBeUndefined();
    expect(readLines()).toContainEqual(
      expect.objectContaining({
        level: "warn",
        msg: expect.stringContaining("revision span"),
      }),
    );
  });
});

describe("generate task, a revision span past the call limits", () => {
  it("writes both skip records and calls neither model", async () => {
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1, LARGE_PR_FILES);
    const task = makeTask({ generator, github });
    const first = await trigger(HEAD_1);
    await task(first.payload);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: first.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: HEAD_1,
      submittedAt: new Date(),
    });
    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    arrangeCompare(github, { base: HEAD_1, head: HEAD_2 }, MANY_HUNKS_DIFF);
    const second = await trigger(HEAD_2);

    await task(second.payload);

    const store = createArtifactStore(harness.handle, ctx);
    const narrative = await store.revisionNarratives.get(
      second.pr.id,
      HEAD_1,
      HEAD_2,
    );
    const delta = await store.deltas.get(second.pr.id, HEAD_1, HEAD_2);
    expect(JSON.parse(narrative?.body ?? "{}")).toMatchObject({
      artifactKind: "revisionNarrativeSkipped",
      skipped: "span too large",
    });
    expect(JSON.parse(delta?.body ?? "{}")).toMatchObject({
      artifactKind: "deltaSkipped",
      skipped: "span-too-large",
    });
    expect(generator.calls).toEqual(["brief", "brief"]);
  });
});
