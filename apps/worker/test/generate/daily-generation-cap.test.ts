import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createTenantRepository,
  createGenerationProjection,
  type PullRequestRow,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import { APIConnectionError } from "@anthropic-ai/sdk";
import { RepoConfigPaths } from "repo-config";
import {
  BASE,
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  makeReviewerId,
  makeTarget,
  makeTask,
  PUBLIC_URL,
  setUpHarness,
  stubGenerator,
  stubGitHub,
  trigger,
} from "./helpers";

setUpHarness();

describe("generate task, daily generation cap", () => {
  const UNCAPPED = { maxGenerationsPerDay: null };

  /** Burn one STARTED run so the instance cap has something to count. */
  async function burnOneRun(): Promise<{
    pr: PullRequestRow;
    payload: unknown;
  }> {
    const triggered = await trigger(HEAD_1);
    await makeTask({ spend: UNCAPPED })(triggered.payload);
    return triggered;
  }

  it("a job over a stored brief skips the gate and counts nothing", async () => {
    const { pr, payload } = await burnOneRun();
    const generator = stubGenerator();
    const { logger, readLines } = captureLogger();
    const task = makeTask({
      generator,
      spend: { maxGenerationsPerDay: 2 },
      log: logger,
    });

    await task(payload);

    expect(generator.calls).toEqual([]);
    expect(readLines().find((line) => line["evt"] === "spend.cap.trip")).toBe(
      undefined,
    );
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    // The stored-brief run made no attempt of its own.
    expect(
      await createGenerationProjection(harness.handle, ctx).countStartedRuns({
        from: new Date(Date.now() - 60_000),
        to: new Date(Date.now() + 60_000),
      }),
    ).toBe(1);
  });

  it("a review over a stored brief still builds its delta", async () => {
    const first = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    await makeTask({ github, spend: UNCAPPED })(first.payload);
    github.info = { ...github.info, headSha: HEAD_2 };
    const second = await trigger(HEAD_2);
    await makeTask({ github, spend: UNCAPPED })(second.payload);
    const written = await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: second.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: HEAD_1,
      submittedAt: new Date(),
    });
    expect(written.ok).toBe(true);

    const generator = stubGenerator();
    await makeTask({ generator, github, spend: { maxGenerationsPerDay: 3 } })(
      second.payload,
    );

    expect(generator.calls).toEqual(["delta"]);
    const store = createArtifactStore(harness.handle, ctx);
    expect(await store.deltas.get(second.pr.id, HEAD_1, HEAD_2)).toBeDefined();
    expect(
      await createGenerationProjection(harness.handle, ctx).countStartedRuns({
        from: new Date(Date.now() - 60_000),
        to: new Date(Date.now() + 60_000),
      }),
    ).toBe(2);
  });

  it("at the cap a stored-brief run owing a delta is refused", async () => {
    const first = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    await makeTask({ github, spend: UNCAPPED })(first.payload);
    const written = await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: first.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: BASE,
      submittedAt: new Date(),
    });
    expect(written.ok).toBe(true);
    const generator = stubGenerator();
    const { logger, readLines } = captureLogger();

    await makeTask({
      generator,
      github,
      spend: { maxGenerationsPerDay: 1 },
      log: logger,
    })(first.payload);

    expect(generator.calls).toEqual([]);
    const trip = readLines().find((line) => line["evt"] === "spend.cap.trip");
    expect(trip?.["level"]).toBe("warn");
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(first.pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("at the cap a ready flip over a stored brief still posts its Entry", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, draft: true };
    const optOut = "version: 1\nentryCommentOnDrafts: false\n";
    github.repoFiles.set(RepoConfigPaths.SETTINGS, {
      kind: "file",
      content: optOut,
      blobSha: "sha-s",
      size: optOut.length,
    });
    await makeTask({ github, spend: UNCAPPED })(payload);
    expect(github.comments.size).toBe(0);

    // The ready flip queues the same job again without a projection write.
    github.info = { ...github.info, draft: false };
    const generator = stubGenerator();
    const { logger, readLines } = captureLogger();
    await makeTask({
      generator,
      github,
      spend: { maxGenerationsPerDay: 1 },
      log: logger,
    })(payload);

    expect(generator.calls).toEqual([]);
    expect(readLines().some((line) => line["evt"] === "spend.cap.trip")).toBe(
      true,
    );
    expect(github.comments.size).toBe(1);
  });

  it("a run over a moved base projects itself and counts", async () => {
    const { pr, payload } = await burnOneRun();
    const github = stubGitHub(HEAD_1);
    github.info = { ...github.info, baseSha: "d".repeat(40) };
    const generator = stubGenerator();

    await makeTask({ generator, github, spend: UNCAPPED })(payload);

    expect(generator.calls).toEqual(["brief"]);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(row?.attempts).toBe(1);
    expect(
      await createArtifactStore(harness.handle, ctx).briefs.get(
        pr.id,
        "d".repeat(40),
        HEAD_1,
      ),
    ).toBeDefined();
  });

  it("a failure over a stored brief leaves the row succeeded", async () => {
    const { pr, payload } = await burnOneRun();
    const github = stubGitHub(HEAD_1);
    github.fetchPullRequestFilesError = {
      code: "not-found",
      status: 404,
      message: "failed to fetch files: GitHub API returned status 404",
    };
    const task = makeTask({ github, spend: UNCAPPED });

    await expect(task(payload)).resolves.toBeUndefined();

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(row?.errorCode).toBeNull();
  });

  it("proceeds while the instance is under its cap", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    const task = makeTask({ generator, spend: { maxGenerationsPerDay: 5 } });

    await task(payload);

    expect(generator.calls).toEqual(["brief"]);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("excludes the deciding run from the cap so a first run can proceed", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    await makeTask({ generator, spend: { maxGenerationsPerDay: 1 } })(payload);

    expect(generator.calls).toEqual(["brief"]);
    expect(
      (
        await createGenerationProjection(harness.handle, ctx).get(
          makeTarget(pr, HEAD_1),
        )
      )?.status,
    ).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("caps before provider calls and records capped state and cap events", async () => {
    await burnOneRun();
    const { pr, payload } = await trigger(HEAD_2);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_2);
    const { logger, readLines } = captureLogger();
    const task = makeTask({
      generator,
      github,
      spend: { maxGenerationsPerDay: 1 },
      log: logger,
    });

    await task(payload);

    // No provider call, and no brief for the capped head.
    expect(generator.calls).toEqual([]);
    expect(
      await createArtifactStore(harness.handle, ctx).briefs.get(
        pr.id,
        BASE,
        HEAD_2,
      ),
    ).toBeUndefined();

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_2),
    );
    expect(row?.status).toBe(GenerationStatuses.CAPPED);
    // Not a failure: no error code, no attempt consumed.
    expect(row?.errorCode).toBeNull();
    expect(row?.attempts).toBe(0);

    const trip = readLines().find((line) => line["evt"] === "spend.cap.trip");
    expect(trip).toBeDefined();
    expect(trip?.["level"]).toBe("warn");
    expect(trip?.["repo"]).toBe("acme/widget");
    expect(trip?.["prId"]).toBe(String(pr.id));
    expect(trip?.["cap"]).toBe(1);
    expect(typeof trip?.["dayUtc"]).toBe("string");
    // Nothing interpolated into msg.
    expect(String(trip?.["msg"])).not.toContain("acme/widget");
  });

  it("at the cap: UPDATES an existing Entry comment and never creates one", async () => {
    // The first run posts the Entry comment; the second is capped.
    await burnOneRun();
    const { pr, payload } = await trigger(HEAD_2);
    const github = stubGitHub(HEAD_2);
    const prRow = await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.getById(pr.id);
    // Re-seed the live comment the first run posted into this run's stub.
    const liveId = prRow?.entryCommentId;
    expect(liveId).not.toBeNull();
    if (liveId === null || liveId === undefined) {
      throw new Error("no entry comment to update");
    }
    github.comments.set(liveId, "the ready body from the previous run");

    await makeTask({ github, spend: { maxGenerationsPerDay: 1 } })(payload);

    // Replace-never-duplicate: still exactly ONE comment, now the capped body.
    expect(github.comments.size).toBe(1);
    const body = [...github.comments.values()][0] ?? "";
    expect(body).toContain("Daily generation cap reached");
    expect(body).toContain(`${PUBLIC_URL}/repos/7/pulls/7`);
    expect(body).toContain(HEAD_2.slice(0, 7));
  });

  it("at the cap with NO Entry comment: creates none", async () => {
    await burnOneRun();
    const { pr, payload } = await trigger(HEAD_2);
    const github = stubGitHub(HEAD_2);
    // Clear the tracked comment: this PR has none on the thread.
    await createTenantRepository(
      harness.handle,
      ctx,
    ).pullRequests.setEntryComment(pr.id, null);

    await makeTask({ github, spend: { maxGenerationsPerDay: 1 } })(payload);

    expect(github.comments.size).toBe(0);
    expect(github.commentCalls).toEqual([]);
  });

  it("counts ATTEMPTS: one row re-run to attempts=3 fills a cap of 3", async () => {
    // graphile/webhook re-queues make ONE row several paid runs; the gate
    // must see the spend, not the row count.
    await burnOneRun();
    await harness.raw(
      "update generation set attempts = 3 where head_sha = '" + HEAD_1 + "'",
    );
    const { pr, payload } = await trigger(HEAD_2);
    const generator = stubGenerator();
    const github = stubGitHub(HEAD_2);

    await makeTask({ generator, github, spend: { maxGenerationsPerDay: 3 } })(
      payload,
    );

    expect(generator.calls).toEqual([]);
    expect(
      (
        await createGenerationProjection(harness.handle, ctx).get(
          makeTarget(pr, HEAD_2),
        )
      )?.status,
    ).toBe(GenerationStatuses.CAPPED);
  });

  it("preserves failed rows when retries reach the cap", async () => {
    await burnOneRun();
    // The PR's own run failed; graphile will retry it. Meanwhile the
    // instance sits at its cap, so the retry lands in the gate.
    const { pr, payload } = await trigger(HEAD_2);
    const failing = stubGenerator();
    failing.failNextWith = new APIConnectionError({});
    await expect(
      makeTask({ generator: failing, github: stubGitHub(HEAD_2) })(payload),
    ).rejects.toThrow("Connection error");
    const failed = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_2),
    );
    expect(failed?.status).toBe(GenerationStatuses.FAILED);
    expect(failed?.errorCode).not.toBeNull();

    // The retry: at cap now, so the run is skipped, but the record stays.
    const generator = stubGenerator();
    await makeTask({
      generator,
      github: stubGitHub(HEAD_2),
      spend: { maxGenerationsPerDay: 1 },
    })(payload);

    expect(generator.calls).toEqual([]);
    const afterRetry = await createGenerationProjection(
      harness.handle,
      ctx,
    ).get(makeTarget(pr, HEAD_2));
    expect(afterRetry?.status).toBe(GenerationStatuses.FAILED);
    expect(afterRetry?.errorCode).toBe(failed?.errorCode);
  });

  it("leaves zero-config jobs uncapped", async () => {
    await burnOneRun();
    const { pr, payload } = await trigger(HEAD_2);
    const generator = stubGenerator();
    await makeTask({ generator, github: stubGitHub(HEAD_2) })(payload);

    expect(generator.calls).toContain("brief");
    expect(
      (
        await createGenerationProjection(harness.handle, ctx).get(
          makeTarget(pr, HEAD_2),
        )
      )?.status,
    ).toBe(GenerationStatuses.SUCCEEDED);
  });
});
