import { describe, expect, it, vi } from "vitest";
import {
  createArtifactStore,
  createGenerationProjection,
  type PullRequestRow,
} from "persistence";
import { GenerationPhases, GenerationStatuses } from "types/generations";
import type { z } from "zod/v4";
import type { Effort, GenerateRequest, Generator } from "generators";
import {
  BASE,
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  interceptInstallationRepo,
  listCommentCalls,
  makeConnectionError,
  makeGitHub,
  makeTarget,
  makeTask,
  setUpHarness,
  stubGenerator,
  stubHangingGenerator,
  trigger,
} from "./helpers";

setUpHarness();

const OTHER_RUN_ID = "00000000-0000-4000-8000-000000000000";
const LEASE_WAIT_MS = 4_000;
const POLL_MS = 5;
const LIVE_LEASE_SECONDS = 120;
const DELAY_BOUND_SECONDS = 30;

async function lockJobs(): Promise<void> {
  await harness.raw("update graphile_worker.jobs set locked_at = now()");
}

async function readQueuedJobs(): Promise<Record<string, unknown>[]> {
  return harness.raw(
    "select key, max_attempts, payload->>'head_sha' as head, extract(epoch from (run_at - now()))::float8 as delay from graphile_worker.jobs where locked_at is null",
  );
}

async function countAttempts(): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as total from generation_attempt",
  );
  return Number(rows[0]?.["total"]);
}

async function readLeaseEpoch(): Promise<number> {
  const rows = await harness.raw(
    "select extract(epoch from lease_expires_at)::float8 as lease from generation",
  );
  return Number(rows[0]?.["lease"]);
}

async function countGenerationRows(): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as total from generation",
  );
  return Number(rows[0]?.["total"]);
}

/** The cascade takes the generation row with it. */
async function deletePullRequest(): Promise<void> {
  await harness.raw("delete from pull_request");
}

async function getBriefRow(
  pullRequestId: PullRequestRow["id"],
): Promise<unknown> {
  return createArtifactStore(harness.handle, ctx).briefs.get(
    pullRequestId,
    BASE,
    HEAD_1,
  );
}

async function claimRowForOtherRun(): Promise<void> {
  await harness.raw(
    "update generation set status = 'running', run_id = $1, lease_expires_at = now() + interval '2 minutes'",
    [OTHER_RUN_ID],
  );
}

async function waitForLeasePast(lease: number): Promise<number> {
  return vi.waitFor(
    async () => {
      const renewed = await readLeaseEpoch();
      expect(renewed).toBeGreaterThan(lease);
      return renewed;
    },
    { timeout: LEASE_WAIT_MS, interval: POLL_MS },
  );
}

describe("generate task, run claim", () => {
  it("a fresh run claims, marks its phase, and finishes with one attempt", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const inner = stubGenerator();
    const seen: Record<string, unknown>[] = [];
    const generator: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        const rows = await harness.raw("select phase, run_id from generation");
        seen.push(...rows);
        return inner.generate(req);
      },
      origin: (effort: Effort) => inner.origin(effort),
    };

    await makeTask({ generator })(payload);

    expect(seen[0]?.["phase"]).toBe(GenerationPhases.GENERATING);
    expect(seen[0]?.["run_id"]).not.toBeNull();
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(row?.runId).toBeNull();
    expect(row?.leaseExpiresAt).toBeNull();
    expect(await countAttempts()).toBe(1);
  });

  it("stands down on an awaiting-trigger row with no claim or call", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const projection = createGenerationProjection(harness.handle, ctx);
    const target = makeTarget(pr, HEAD_1);
    await projection.markAwaitingTrigger(target);
    const generator = stubGenerator();

    await makeTask({ generator })(payload);

    expect(generator.calls).toEqual([]);
    expect(await countAttempts()).toBe(0);
    const row = await projection.get(target);
    expect(row?.status).toBe(GenerationStatuses.AWAITING_TRIGGER);
    expect(row?.runId).toBeNull();
  });

  it("at a cap of 1 the retry of a failed attempt is capped", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const failing = stubGenerator();
    failing.failNextWith = makeConnectionError();
    await expect(makeTask({ generator: failing })(payload)).rejects.toThrow(
      "Connection error",
    );
    const generator = stubGenerator();

    await makeTask({ generator, spend: { maxGenerationsPerDay: 1 } })(payload);

    expect(generator.calls).toEqual([]);
    expect(await countAttempts()).toBe(1);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
  });

  it("a row another run holds is left as found and nothing is spent", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await claimRowForOtherRun();
    await lockJobs();
    const projection = createGenerationProjection(harness.handle, ctx);
    const before = await projection.get(makeTarget(pr, HEAD_1));
    const generator = stubGenerator();
    const github = makeGitHub(HEAD_1);

    await expect(
      makeTask({ generator, github })(payload),
    ).resolves.toBeUndefined();

    expect(generator.calls).toEqual([]);
    expect(listCommentCalls(github)).toEqual([]);
    expect(await projection.get(makeTarget(pr, HEAD_1))).toEqual(before);
    expect(await countAttempts()).toBe(0);
    const queued = await readQueuedJobs();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.["key"]).toBe(`generate:${pr.id}`);
    expect(queued[0]?.["head"]).toBe(HEAD_1);
    expect(queued[0]?.["max_attempts"]).toBe(3);
    const delay = Number(queued[0]?.["delay"]);
    expect(delay).toBeGreaterThan(LIVE_LEASE_SECONDS);
    expect(delay).toBeLessThan(LIVE_LEASE_SECONDS + DELAY_BOUND_SECONDS);
  });

  it("a claimed row with a job already queued queues nothing new", async () => {
    const { payload } = await trigger(HEAD_1);
    await claimRowForOtherRun();
    const before = await harness.raw(
      "select id, key, run_at, locked_at from graphile_worker.jobs order by id",
    );

    await makeTask()(payload);

    expect(
      await harness.raw(
        "select id, key, run_at, locked_at from graphile_worker.jobs order by id",
      ),
    ).toEqual(before);
  });

  it("a failure whose claim was taken over resolves and leaves the row", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const inner = stubGenerator();
    const generator: Generator = {
      async generate<S extends z.ZodType>(): Promise<z.infer<S>> {
        await claimRowForOtherRun();
        throw makeConnectionError();
      },
      origin: (effort: Effort) => inner.origin(effort),
    };
    const { logger, readLines } = captureLogger();

    await expect(
      makeTask({ generator, log: logger })(payload),
    ).resolves.toBeUndefined();

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.runId).toBe(OTHER_RUN_ID);
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
    expect(row?.errorCode).toBeNull();
    expect(readLines().map((line) => line["evt"])).not.toContain("job.fail");
  });

  it("the head check renews the lease during a slow model call", async () => {
    const { payload } = await trigger(HEAD_1);
    const inner = stubGenerator();
    const leases: number[] = [];
    const generator: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        const leaseBefore = await readLeaseEpoch();
        leases.push(leaseBefore, await waitForLeasePast(leaseBefore));
        return inner.generate(req);
      },
      origin: (effort: Effort) => inner.origin(effort),
    };

    await makeTask({ generator, headPollIntervalMs: POLL_MS })(payload);

    expect(leases[1]).toBeGreaterThan(leases[0] ?? Number.POSITIVE_INFINITY);
  });

  it("a stalled head read does not stop the lease renewal", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    let stallReads = false;
    const readStalled = Promise.withResolvers<void>();
    interceptInstallationRepo(github, (client) => ({
      ...client,
      async fetchPullRequest(prNumber) {
        if (stallReads) {
          readStalled.resolve();
          return new Promise(() => {});
        }
        return client.fetchPullRequest(prNumber);
      },
    }));
    const inner = stubGenerator();
    const leases: number[] = [];
    const generator: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        stallReads = true;
        await readStalled.promise;
        const leaseBefore = await readLeaseEpoch();
        leases.push(leaseBefore, await waitForLeasePast(leaseBefore));
        stallReads = false;
        return inner.generate(req);
      },
      origin: (effort: Effort) => inner.origin(effort),
    };

    await makeTask({ generator, github, headPollIntervalMs: POLL_MS })(payload);

    expect(leases[1]).toBeGreaterThan(leases[0] ?? Number.POSITIVE_INFINITY);
  });

  it("a lost claim stands the run down without writing the row", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubHangingGenerator(claimRowForOtherRun);

    await expect(
      makeTask({ generator, headPollIntervalMs: POLL_MS })(payload),
    ).resolves.toBeUndefined();

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.runId).toBe(OTHER_RUN_ID);
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
    expect(row?.errorCode).toBeNull();
    expect(
      await createArtifactStore(harness.handle, ctx).briefs.get(
        pr.id,
        BASE,
        HEAD_1,
      ),
    ).toBeUndefined();
  });

  it("a pull request deleted before the claim stands the run down", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    interceptInstallationRepo(github, (client) => ({
      ...client,
      async fetchPullRequest(prNumber) {
        const read = await client.fetchPullRequest(prNumber);
        await deletePullRequest();
        return read;
      },
    }));
    const generator = stubGenerator();
    const { logger, readLines } = captureLogger();

    await expect(
      makeTask({ generator, github, log: logger })(payload),
    ).resolves.toBeUndefined();

    expect(generator.calls).toEqual([]);
    expect(await countAttempts()).toBe(0);
    expect(await countGenerationRows()).toBe(0);
    expect(readLines().map((line) => line["evt"])).not.toContain("job.fail");
  });

  it("a pull request deleted after the claim makes no provider call", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    interceptInstallationRepo(github, (client) => ({
      ...client,
      async fetchPullRequestFiles(prNumber) {
        await deletePullRequest();
        return client.fetchPullRequestFiles(prNumber);
      },
    }));
    const generator = stubGenerator();
    const { logger, readLines } = captureLogger();

    await expect(
      makeTask({ generator, github, log: logger })(payload),
    ).resolves.toBeUndefined();

    expect(generator.calls).toEqual([]);
    expect(await countAttempts()).toBe(1);
    expect(await countGenerationRows()).toBe(0);
    expect(await getBriefRow(pr.id)).toBeUndefined();
    expect(readLines().map((line) => line["evt"])).not.toContain("job.fail");
  });

  it("a pull request deleted mid-call stands the run down on the tick", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubHangingGenerator(deletePullRequest);
    const { logger, readLines } = captureLogger();

    await expect(
      makeTask({ generator, headPollIntervalMs: POLL_MS, log: logger })(
        payload,
      ),
    ).resolves.toBeUndefined();

    expect(await countGenerationRows()).toBe(0);
    expect(await getBriefRow(pr.id)).toBeUndefined();
    expect(readLines().map((line) => line["evt"])).not.toContain("job.fail");
  });

  it("a stored-brief rerun settles a failed row to succeeded", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await makeTask()(payload);
    await harness.raw(
      "update generation set status = 'failed', error_code = 'unknown'",
    );
    const generator = stubGenerator();

    await makeTask({ generator })(payload);

    expect(generator.calls).toEqual([]);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(row?.errorCode).toBeNull();
    expect(await countAttempts()).toBe(1);
  });
});
