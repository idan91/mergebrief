import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createTenantRepository,
  type PullRequestRow,
} from "persistence";
import { claimTestRun } from "persistence/testing";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import type { z } from "zod/v4";
import type { Effort, GenerateRequest, Generator } from "generators";
import {
  BASE,
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  makeConnectionError,
  makeGitHub,
  makeRecoveryTask,
  makeReviewerId,
  makeTarget,
  makeTask,
  setUpHarness,
  stubGenerator,
  trigger,
} from "./helpers";

setUpHarness();

const LEASE_SECONDS = 120;
const DELAY_BOUND_SECONDS = 30;
const FIRST_ATTEMPT = {
  attempts: 1,
  max_attempts: 3,
  run_at: new Date(),
} as const;
const SECOND_ATTEMPT = { ...FIRST_ATTEMPT, attempts: 2 } as const;

async function readRecoveryJobs(): Promise<Record<string, unknown>[]> {
  return harness.raw(
    "select key, extract(epoch from (run_at - now()))::float8 as delay from graphile_worker.jobs where task_identifier = 'recover-generation' and locked_at is null",
  );
}

async function countAttempts(): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as total from generation_attempt",
  );
  return Number(rows[0]?.["total"]);
}

const OTHER_RUN_ID = "00000000-0000-4000-8000-000000000000";

async function holdRowForOtherRun(): Promise<void> {
  await harness.raw(
    "update generation set status = 'running', run_id = $1, lease_expires_at = now() + interval '2 minutes'",
    [OTHER_RUN_ID],
  );
}

/** The brief is stored and a reviewer's checkpoint still owes a delta. */
async function storeBriefOwingDelta(): Promise<{
  pr: PullRequestRow;
  payload: unknown;
}> {
  const triggered = await trigger(HEAD_1);
  await makeTask()(triggered.payload);
  await createTenantRepository(harness.handle, ctx).checkpoints.upsertOnSubmit({
    pullRequestId: triggered.pr.id,
    reviewerId: makeReviewerId(100n),
    lastSubmittedSha: BASE,
    submittedAt: new Date(),
  });
  return triggered;
}

async function readQueuedGenerateJobs(): Promise<Record<string, unknown>[]> {
  return harness.raw(
    "select extract(epoch from (run_at - now()))::float8 as delay from graphile_worker.jobs where task_identifier = 'generate' and locked_at is null",
  );
}

/** The holder claimed and died: its lease has lapsed, its job stays locked. */
async function leaveDeadHolder(): Promise<void> {
  await harness.raw("update graphile_worker.jobs set locked_at = now()");
  await harness.raw(
    "update generation set lease_expires_at = now() - interval '1 second'",
  );
}

describe("generate task, claim recovery", () => {
  it("a claim queues one recovery job per head for after the lease", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const failing = stubGenerator();
    failing.failNextWith = makeConnectionError();
    await expect(makeTask({ generator: failing })(payload)).rejects.toThrow(
      "Connection error",
    );

    await makeTask()(payload);

    const jobs = await readRecoveryJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["key"]).toBe(`recover-generation:${pr.id}:${HEAD_1}`);
    const delay = Number(jobs[0]?.["delay"]);
    expect(delay).toBeGreaterThan(LEASE_SECONDS);
    expect(delay).toBeLessThan(LEASE_SECONDS + DELAY_BOUND_SECONDS);
  });

  it("a lapsed claim is taken over and the dead job later does nothing", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const projection = createGenerationProjection(harness.handle, ctx);
    await claimTestRun(projection, makeTarget(pr, HEAD_1));
    await leaveDeadHolder();
    const generator = stubGenerator();

    await makeRecoveryTask({ generator })(payload, { job: FIRST_ATTEMPT });

    expect(generator.calls).toEqual(["brief"]);
    const row = await projection.get(makeTarget(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(row?.runId).toBeNull();
    expect(await countAttempts()).toBe(2);
    expect(await readRecoveryJobs()).toEqual([]);

    const original = stubGenerator();
    await makeTask({ generator: original })(payload);
    expect(original.calls).toEqual([]);
    expect(await countAttempts()).toBe(2);
    expect(await projection.get(makeTarget(pr, HEAD_1))).toEqual(row);
  });

  it("a live holder is not stolen and recovery moves after its lease", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const projection = createGenerationProjection(harness.handle, ctx);
    const holder = await claimTestRun(projection, makeTarget(pr, HEAD_1));
    const generator = stubGenerator();

    await makeRecoveryTask({ generator })(payload, { job: FIRST_ATTEMPT });

    expect(generator.calls).toEqual([]);
    const row = await projection.get(makeTarget(pr, HEAD_1));
    expect(row?.runId).toBe(holder);
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
    expect(await countAttempts()).toBe(1);
    const jobs = await readRecoveryJobs();
    expect(jobs).toHaveLength(1);
    expect(Number(jobs[0]?.["delay"])).toBeGreaterThan(LEASE_SECONDS);
  });

  it("a finished run leaves the recovery job a no-op without reads", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await makeTask()(payload);
    const projection = createGenerationProjection(harness.handle, ctx);
    const before = await projection.get(makeTarget(pr, HEAD_1));
    const github = makeGitHub(HEAD_1);
    let opened = 0;
    github.bindInstallationGitHub = () => {
      opened += 1;
      throw new Error("the recovery job must not open a source");
    };
    const generator = stubGenerator();

    await makeRecoveryTask({ generator, github })(payload, {
      job: FIRST_ATTEMPT,
    });

    expect(opened).toBe(0);
    expect(generator.calls).toEqual([]);
    expect(await projection.get(makeTarget(pr, HEAD_1))).toEqual(before);
    expect(await countAttempts()).toBe(1);
  });

  it("a retry of a failed takeover runs the head again", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const projection = createGenerationProjection(harness.handle, ctx);
    await claimTestRun(projection, makeTarget(pr, HEAD_1));
    await leaveDeadHolder();
    const failing = stubGenerator();
    failing.failNextWith = makeConnectionError();
    await expect(
      makeRecoveryTask({ generator: failing })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow("Connection error");
    const generator = stubGenerator();

    await makeRecoveryTask({ generator })(payload, { job: SECOND_ATTEMPT });

    expect(generator.calls).toEqual(["brief"]);
    const row = await projection.get(makeTarget(pr, HEAD_1));
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("a retry beside a live holder over a stored brief waits, unpaid", async () => {
    const { pr, payload } = await storeBriefOwingDelta();
    await holdRowForOtherRun();
    const generator = stubGenerator();

    await makeRecoveryTask({ generator })(payload, { job: SECOND_ATTEMPT });

    expect(generator.calls).toEqual([]);
    expect(await countAttempts()).toBe(1);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.runId).toBe(OTHER_RUN_ID);
    const jobs = await readRecoveryJobs();
    expect(jobs).toHaveLength(1);
    expect(Number(jobs[0]?.["delay"])).toBeGreaterThan(LEASE_SECONDS);
  });

  it("a stored-brief run yields to a live claim and pays nothing", async () => {
    const { pr, payload } = await storeBriefOwingDelta();
    await holdRowForOtherRun();
    await harness.raw("update graphile_worker.jobs set locked_at = now()");
    const generator = stubGenerator();

    await makeTask({ generator })(payload);

    expect(generator.calls).toEqual([]);
    expect(await countAttempts()).toBe(1);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
    expect(row?.runId).toBe(OTHER_RUN_ID);
    const queued = await readQueuedGenerateJobs();
    expect(queued).toHaveLength(1);
    expect(Number(queued[0]?.["delay"])).toBeGreaterThan(LEASE_SECONDS);
  });

  it("a takeover over a stored brief claims the row and pays once", async () => {
    const { pr, payload } = await storeBriefOwingDelta();
    await holdRowForOtherRun();
    await leaveDeadHolder();
    const generator = stubGenerator();
    const { logger, readLines } = captureLogger();

    await makeRecoveryTask({ generator, log: logger })(payload, {
      job: FIRST_ATTEMPT,
    });

    expect(generator.calls).toEqual(["delta"]);
    expect(
      readLines().some((line) =>
        String(line["msg"]).includes("made no provider call"),
      ),
    ).toBe(false);
    expect(await countAttempts()).toBe(2);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(row?.runId).toBeNull();
    expect(row?.claims).toBe(2);
  });

  it("a head whose attempts are spent ends failed with no new spend", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await holdRowForOtherRun();
    await harness.raw("update generation set claims = 3");
    await leaveDeadHolder();
    const generator = stubGenerator();
    const { logger, readLines } = captureLogger();

    await makeRecoveryTask({ generator, log: logger })(payload, {
      job: FIRST_ATTEMPT,
    });

    expect(generator.calls).toEqual([]);
    expect(await countAttempts()).toBe(0);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.ATTEMPTS_EXHAUSTED);
    expect(row?.errorParams).toBeNull();
    expect(row?.runId).toBeNull();
    expect(await readRecoveryJobs()).toEqual([]);
    const exhausted = readLines().find(
      (line) => line["evt"] === "job.retries.exhausted",
    );
    expect(exhausted?.["level"]).toBe("error");
    expect(exhausted?.["attempt"]).toBe(3);
    expect(exhausted?.["maxAttempts"]).toBe(3);
  });

  it("a takeover with nothing owed warns that its claim still counts", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await makeTask()(payload);
    await holdRowForOtherRun();
    await leaveDeadHolder();
    const generator = stubGenerator();
    const { logger, readLines } = captureLogger();

    await makeRecoveryTask({ generator, log: logger })(payload, {
      job: FIRST_ATTEMPT,
    });

    expect(generator.calls).toEqual([]);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(row?.claims).toBe(2);
    const warned = readLines().filter((line) =>
      String(line["msg"]).includes("made no provider call"),
    );
    expect(warned).toHaveLength(1);
    expect(warned[0]?.["level"]).toBe("warn");
    expect(warned[0]?.["attempt"]).toBe(2);
    expect(warned[0]?.["maxAttempts"]).toBe(3);
  });

  it("a failed claim check reports job.fail and leaves the row", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await holdRowForOtherRun();
    const projection = createGenerationProjection(harness.handle, ctx);
    const before = await projection.get(makeTarget(pr, HEAD_1));
    // The reschedule past the live lease reaches a queue that is gone.
    await harness.raw("alter schema graphile_worker rename to queue_offline");
    const { logger, readLines } = captureLogger();

    await expect(
      makeRecoveryTask({ log: logger })(payload, { job: FIRST_ATTEMPT }),
    ).rejects.toThrow(/graphile_worker/);

    expect(readLines().map((line) => line["evt"])).toContain("job.fail");
    expect(await projection.get(makeTarget(pr, HEAD_1))).toEqual(before);
  });

  it("a run over a lapsed claim and the recovery pay one delta", async () => {
    const { payload } = await storeBriefOwingDelta();
    await holdRowForOtherRun();
    await leaveDeadHolder();
    const inner = stubGenerator();
    let enterCall: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      enterCall = resolve;
    });
    let releaseCall: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      releaseCall = resolve;
    });
    const parked: Generator = {
      async generate<S extends z.ZodType>(
        req: GenerateRequest<S>,
      ): Promise<z.infer<S>> {
        enterCall();
        await released;
        return inner.generate(req);
      },
      origin: (effort: Effort) => inner.origin(effort),
    };
    const regularRun = makeTask({ generator: parked })(payload);
    await entered;

    const recovery = stubGenerator();
    await makeRecoveryTask({ generator: recovery })(payload, {
      job: FIRST_ATTEMPT,
    });
    releaseCall();
    await regularRun;

    expect(inner.calls).toEqual(["delta"]);
    expect(recovery.calls).toEqual([]);
    expect(await countAttempts()).toBe(2);
  });
});
