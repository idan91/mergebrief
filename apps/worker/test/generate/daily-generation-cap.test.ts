import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createTenantRepository,
  createGenerationProjection,
  type PullRequestRow,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import type { z } from "zod/v4";
import type { Effort, GenerateRequest, Generator } from "generators";
import { RepoConfigPaths } from "repo-config";
import { FakeFailures } from "github/testing";
import {
  BASE,
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  interceptInstallationRepo,
  listCommentCalls,
  makeConnectionError,
  makeGitHub,
  makeReviewerId,
  makeTarget,
  makeTask,
  PR_REF,
  PUBLIC_URL,
  REPO,
  setUpHarness,
  stubGenerator,
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

  /** A paid run another slot started, written straight to the ledger. */
  async function burnRunElsewhere(): Promise<void> {
    await harness.raw(
      "insert into generation_attempt (installation_id, run_id, generation_id) values (42, gen_random_uuid(), 0)",
    );
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
    const github = makeGitHub(HEAD_1);
    await makeTask({ github, spend: UNCAPPED })(first.payload);
    github.updatePullRequest(PR_REF, { headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await makeTask({ github, spend: UNCAPPED })(second.payload);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: second.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: HEAD_1,
      submittedAt: new Date(),
    });

    const generator = stubGenerator();
    await makeTask({ generator, github, spend: { maxGenerationsPerDay: 3 } })(
      second.payload,
    );

    expect(generator.calls).toEqual(["delta"]);
    const store = createArtifactStore(harness.handle, ctx);
    expect(await store.deltas.get(second.pr.id, HEAD_1, HEAD_2)).toBeDefined();
    // Two fresh runs plus the delta this run paid for.
    expect(
      await createGenerationProjection(harness.handle, ctx).countStartedRuns({
        from: new Date(Date.now() - 60_000),
        to: new Date(Date.now() + 60_000),
      }),
    ).toBe(3);
  });

  it("a paid retry over a stored brief counts toward the cap", async () => {
    const CAP = { maxGenerationsPerDay: 2 };
    const first = await trigger(HEAD_1);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: first.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: BASE,
      submittedAt: new Date(),
    });
    const inner = stubGenerator();
    const failingDelta: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        if (req.label === "delta") {
          throw makeConnectionError();
        }
        return inner.generate(req);
      },
      origin: (effort: Effort) => inner.origin(effort),
    };
    await expect(
      makeTask({ generator: failingDelta, spend: CAP })(first.payload),
    ).rejects.toThrow("Connection error");

    const retry = stubGenerator();
    await makeTask({ generator: retry, spend: CAP })(first.payload);

    expect(retry.calls).toEqual(["delta"]);
    expect(
      await createGenerationProjection(harness.handle, ctx).countStartedRuns({
        from: new Date(Date.now() - 60_000),
        to: new Date(Date.now() + 60_000),
      }),
    ).toBe(2);
    const second = await trigger(HEAD_2);
    const fresh = stubGenerator();
    await makeTask({
      generator: fresh,
      github: makeGitHub(HEAD_2),
      spend: CAP,
    })(second.payload);
    expect(fresh.calls).toEqual([]);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(second.pr, HEAD_2),
    );
    expect(row?.status).toBe(GenerationStatuses.CAPPED);
  });

  it("a stored-brief run refused at its first paid call writes no row", async () => {
    const first = await trigger(HEAD_1);
    await makeTask({ spend: UNCAPPED })(first.payload);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: first.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: BASE,
      submittedAt: new Date(),
    });
    const projection = createGenerationProjection(harness.handle, ctx);
    const before = await projection.get(makeTarget(first.pr, HEAD_1));
    const inner = stubGenerator();
    // Another slot spends the last unit between the gate and the delta call.
    const github = makeGitHub(HEAD_1);
    interceptInstallationRepo(github, (client) => ({
      ...client,
      async fetchPullRequestFiles(prNumber) {
        await burnRunElsewhere();
        return client.fetchPullRequestFiles(prNumber);
      },
    }));
    const { logger, readLines } = captureLogger();

    await expect(
      makeTask({
        generator: inner,
        github,
        spend: { maxGenerationsPerDay: 2 },
        log: logger,
      })(first.payload),
    ).resolves.toBeUndefined();

    expect(inner.calls).toEqual([]);
    expect(await projection.get(makeTarget(first.pr, HEAD_1))).toEqual(before);
    const trip = readLines().find((line) => line["evt"] === "spend.cap.trip");
    expect(trip?.["level"]).toBe("warn");
    expect(readLines().map((line) => line["evt"])).not.toContain("job.fail");
  });

  it("at the cap a stored-brief run owing a delta is refused", async () => {
    const first = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    await makeTask({ github, spend: UNCAPPED })(first.payload);
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId: first.pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: BASE,
      submittedAt: new Date(),
    });
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
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const optOut = "version: 1\nentryCommentOnDrafts: false\n";
    github.addRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      {
        kind: "file",
        content: optOut,
        blobSha: "sha-s",
        size: optOut.length,
      },
    );
    await makeTask({ github, spend: UNCAPPED })(payload);
    expect(github.readComments(REPO).size).toBe(0);

    // The ready flip queues the same job again without a projection write.
    github.updatePullRequest(PR_REF, { draft: false });
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
    expect(github.readComments(REPO).size).toBe(1);
  });

  it("a run over a moved base projects itself and counts", async () => {
    const { pr, payload } = await burnOneRun();
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { baseSha: "d".repeat(40) });
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
    const github = makeGitHub(HEAD_1);
    github.failOn("fetchPullRequestFiles", FakeFailures.NOT_FOUND);
    const task = makeTask({ github, spend: UNCAPPED });

    await expect(task(payload)).resolves.toBeUndefined();

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(row?.errorCode).toBeNull();
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
    const github = makeGitHub(HEAD_2);
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
    const github = makeGitHub(HEAD_2);
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
    github.addComment(REPO, liveId, "the ready body from the previous run");

    await makeTask({ github, spend: { maxGenerationsPerDay: 1 } })(payload);

    // Replace-never-duplicate: still exactly ONE comment, now the capped body.
    expect(github.readComments(REPO).size).toBe(1);
    const body = [...github.readComments(REPO).values()][0] ?? "";
    expect(body).toContain("reached its daily generation cap");
    expect(body).toContain(`${PUBLIC_URL}/repos/7/pulls/7`);
    expect(body).toContain(HEAD_2.slice(0, 7));
  });

  it("at the cap with NO Entry comment: creates none", async () => {
    await burnOneRun();
    const { pr, payload } = await trigger(HEAD_2);
    const github = makeGitHub(HEAD_2);
    // Clear the tracked comment: this PR has none on the thread.
    const { pullRequests } = createTenantRepository(harness.handle, ctx);
    const tracked = await pullRequests.getById(pr.id);
    await pullRequests.swapEntryComment(pr.id, {
      seen: tracked?.entryCommentId ?? null,
      next: null,
    });

    await makeTask({ github, spend: { maxGenerationsPerDay: 1 } })(payload);

    expect(github.readComments(REPO).size).toBe(0);
    expect(listCommentCalls(github)).toEqual([]);
  });

  it("counts every retry: one head run three times fills a cap of 3", async () => {
    // graphile retries make ONE row several paid runs; the gate must see the
    // spend, not the row count.
    const first = await trigger(HEAD_1);
    for (let failedRuns = 0; failedRuns < 2; failedRuns += 1) {
      const failing = stubGenerator();
      failing.failNextWith = makeConnectionError();
      await expect(
        makeTask({ generator: failing, spend: UNCAPPED })(first.payload),
      ).rejects.toThrow("Connection error");
    }
    await makeTask({ spend: UNCAPPED })(first.payload);
    const { pr, payload } = await trigger(HEAD_2);
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_2);

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
    failing.failNextWith = makeConnectionError();
    await expect(
      makeTask({ generator: failing, github: makeGitHub(HEAD_2) })(payload),
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
      github: makeGitHub(HEAD_2),
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
});
