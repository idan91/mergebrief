// The transactional ingest boundary: PR upsert + pending generation
// projection + debounced graphile `generate` job, atomically. Runs on the
// PGlite harness because it provides the `graphile_worker` stub the enqueue
// step calls by name.
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import type {
  IngestOutcome,
  TriggerGenerationInput,
} from "../src/stores/ingest";
import { createIngestRoutines } from "../src/stores/ingest";
import { createArtifactStore } from "../src/stores/artifact-store";
import { createGenerationProjection } from "../src/stores/generation";
import { createLiveReadStore } from "../src/stores/live-read";
import type { PullRequestUpsertInput } from "../src/stores/tenant";
import type { Mutable } from "types/utils";
import { createTenantRepository } from "../src/stores/tenant";
import { parseTenantContext } from "../src/stores/scope-context";
import {
  claimTestRun,
  createPgliteHarness,
  succeedTestRun,
  type PgliteHarness,
} from "../src/testing";
import {
  GenerationKinds,
  isGrantRowId,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  UncoveredWorks,
  type PullRequestRowId,
  type UncoveredWork,
} from "../src/types";
import { GenerationPhases, GenerationStatuses } from "types/generations";
import { PrStates } from "types/pull-requests";
import { brandWith, registerSharedPglite, writeJobRunAt } from "./helpers";

const CTX = parseTenantContext({ installationId: 100n });
const REPO_ID = brandWith(isRepoId, 200n);
const HEAD_SHA = "ec26c3e57ca3a959ca5aad62de7213c562f8c821";
/** A `run_at` no trigger computes, so one that moved it cannot match. */
const PINNED_RUN_AT = new Date("2026-01-01T00:00:00Z");

/** Narrow the now-optional generation (absent only on a terminal-preserved trigger). */
function expectGeneration(
  outcome: IngestOutcome,
): NonNullable<IngestOutcome["generation"]> {
  if (outcome.generation === undefined) {
    throw new Error("expected a generation row on this trigger");
  }
  return outcome.generation;
}

/** Coerce a raw timestamptz cell (Date on PGlite) to epoch milliseconds. */
function briefTarget(pullRequestId: PullRequestRowId) {
  return {
    pullRequestId,
    kind: GenerationKinds.BRIEF,
    headSha: HEAD_SHA,
    baselineSha: null,
  } as const;
}

function epochMs(cell: unknown): number {
  if (cell instanceof Date) {
    return cell.getTime();
  }
  if (typeof cell === "string") {
    return new Date(cell).getTime();
  }
  throw new Error(`expected a timestamp cell, got ${typeof cell}`);
}

describe("createIngestRoutines.triggerGeneration", () => {
  const shared = registerSharedPglite();
  let harness: PgliteHarness;

  beforeEach(() => {
    harness = shared.harness;
  });

  async function trigger(overrides?: {
    debounceSeconds?: number;
    regenerationDebounceSeconds?: number;
    reopen?: boolean;
    refreshRunAt?: boolean;
    baseSha?: string;
    headSha?: string;
    githubUpdatedAt?: Date;
    uncoveredWork?: UncoveredWork;
  }): Promise<IngestOutcome> {
    const pullRequest: Mutable<PullRequestUpsertInput> = {
      repoId: REPO_ID,
      prNumber: 7,
      repoSlug: "acme/widgets",
      title: "feat: add widgets",
      state: PrStates.OPEN,
    };

    if (overrides?.baseSha !== undefined) {
      pullRequest.baseSha = overrides.baseSha;
    }
    if (overrides?.githubUpdatedAt !== undefined) {
      pullRequest.githubUpdatedAt = overrides.githubUpdatedAt;
    }

    const input: Mutable<TriggerGenerationInput> = {
      pullRequest,
      headSha: overrides?.headSha ?? HEAD_SHA,
    };

    if (overrides?.debounceSeconds !== undefined) {
      input.debounceSeconds = overrides.debounceSeconds;
    }
    if (overrides?.regenerationDebounceSeconds !== undefined) {
      input.regenerationDebounceSeconds = overrides.regenerationDebounceSeconds;
    }
    if (overrides?.reopen !== undefined) {
      input.reopen = overrides.reopen;
    }
    if (overrides?.refreshRunAt !== undefined) {
      input.refreshRunAt = overrides.refreshRunAt;
    }
    if (overrides?.uncoveredWork !== undefined) {
      input.uncoveredWork = overrides.uncoveredWork;
    }

    return createIngestRoutines(harness.handle, CTX).triggerGeneration(input);
  }

  /** Close the PR out-of-band, as the `pull_request.closed` handler would. */
  async function closePr(): Promise<void> {
    await createTenantRepository(harness.handle, CTX).pullRequests.upsert({
      repoId: REPO_ID,
      prNumber: 7,
      repoSlug: "acme/widgets",
      state: PrStates.CLOSED,
      closedAt: new Date(),
    });
  }

  it("atomically writes PR, pending generation and debounced job rows", async () => {
    const before = Date.now();
    const outcome = await trigger();

    // The returned pull_request row.
    expect(outcome.pullRequest.installationId).toBe(CTX.installationId);
    expect(outcome.pullRequest.repoId).toBe(REPO_ID);
    expect(outcome.pullRequest.prNumber).toBe(7);
    expect(outcome.pullRequest.title).toBe("feat: add widgets");
    expect(outcome.pullRequest.state).toBe(PrStates.OPEN);
    expect(outcome.queued).toBe(true);

    // The returned generation row: kind brief, pending, baseline null.
    const generation = expectGeneration(outcome);
    expect(generation.pullRequestId).toBe(outcome.pullRequest.id);
    expect(generation.kind).toBe(GenerationKinds.BRIEF);
    expect(generation.status).toBe(GenerationStatuses.PENDING);
    expect(generation.headSha).toBe(HEAD_SHA);
    expect(generation.baselineSha).toBeNull();
    expect(generation.attempts).toBe(0);

    // All three rows landed.
    const prs = await harness.raw("select * from pull_request");
    const generations = await harness.raw("select * from generation");
    const jobs = await harness.raw("select * from graphile_worker.jobs");
    expect(prs).toHaveLength(1);
    expect(generations).toHaveLength(1);
    expect(jobs).toHaveLength(1);

    // The job: task, key, payload (STRING ids, JSON can't carry bigint),
    // run_at ≈ now + 60s.
    const job = jobs[0];
    if (job === undefined) {
      throw new Error("expected a jobs row");
    }
    expect(job["task_identifier"]).toBe("generate");
    expect(job["key"]).toBe(`generate:${outcome.pullRequest.id}`);
    expect(job["payload"]).toEqual({
      installation_id: String(CTX.installationId),
      pull_request_id: String(outcome.pullRequest.id),
      head_sha: HEAD_SHA,
    });
    const runAtDelta = epochMs(job["run_at"]) - before;
    expect(runAtDelta).toBeGreaterThan(55_000);
    expect(runAtDelta).toBeLessThan(65_000);
  });

  it("redelivery increments attempts and keeps the one job's run_at", async () => {
    const first = await trigger();
    await writeJobRunAt(harness, PINNED_RUN_AT);

    const second = await trigger();

    // Same aggregate root, projection reset to pending with attempts bumped.
    expect(second.pullRequest.id).toBe(first.pullRequest.id);
    expect(expectGeneration(second).id).toBe(expectGeneration(first).id);
    expect(expectGeneration(second).attempts).toBe(1);
    expect(expectGeneration(second).status).toBe(GenerationStatuses.PENDING);

    const prs = await harness.raw("select id from pull_request");
    const generations = await harness.raw("select id from generation");
    const jobs = await harness.raw(
      "select key, run_at from graphile_worker.jobs",
    );
    expect(prs).toHaveLength(1);
    expect(generations).toHaveLength(1);
    expect(jobs).toHaveLength(1);

    // Leading-edge debounce: the first trigger fixed run_at for good.
    expect(jobs[0]?.["key"]).toBe(`generate:${first.pullRequest.id}`);
    expect(epochMs(jobs[0]?.["run_at"])).toBe(PINNED_RUN_AT.getTime());
  });

  it("a later push keeps the first run_at and carries the new head", async () => {
    const first = await trigger({ headSha: "a".repeat(40) });
    await writeJobRunAt(harness, PINNED_RUN_AT);

    await trigger({ headSha: "b".repeat(40) });

    const jobs = await harness.raw(
      "select payload, run_at from graphile_worker.jobs",
    );
    expect(jobs).toHaveLength(1);
    expect(epochMs(jobs[0]?.["run_at"])).toBe(PINNED_RUN_AT.getTime());
    expect(jobs[0]?.["payload"]).toMatchObject({
      pull_request_id: String(first.pullRequest.id),
      head_sha: "b".repeat(40),
    });
  });

  it("clears a live-read head stamp a newer push moved past", async () => {
    const first = await trigger({ headSha: "a".repeat(40) });
    await createTenantRepository(harness.handle, CTX).pullRequests.upsert({
      repoId: REPO_ID,
      prNumber: 7,
      repoSlug: "acme/widgets",
      state: PrStates.OPEN,
      liveRead: { readAt: new Date(), headSha: "a".repeat(40) },
    });

    const pushed = await trigger({
      headSha: "b".repeat(40),
      githubUpdatedAt: new Date(),
    });

    expect(first.pullRequest.githubHeadSha).toBeNull();
    expect(pushed.pullRequest.githubHeadSha).toBeNull();
  });

  it("never writes an older push's head over a newer stamp", async () => {
    await trigger({ headSha: "a".repeat(40) });
    await createTenantRepository(harness.handle, CTX).pullRequests.upsert({
      repoId: REPO_ID,
      prNumber: 7,
      repoSlug: "acme/widgets",
      state: PrStates.OPEN,
      liveRead: { readAt: new Date(), headSha: "c".repeat(40) },
    });

    const latePush = await trigger({
      headSha: "b".repeat(40),
      githubUpdatedAt: new Date(),
    });

    expect(latePush.pullRequest.githubHeadSha).not.toBe("b".repeat(40));
  });

  it("queues a delayed push after a newer live read of the row", async () => {
    const first = await trigger({
      headSha: "a".repeat(40),
      githubUpdatedAt: new Date("2026-10-01T10:00:00Z"),
    });
    await createLiveReadStore(harness.handle, CTX).record(
      first.pullRequest.id,
      {
        readAt: new Date(),
        headSha: "b".repeat(40),
        repoSlug: "acme/widgets",
        title: "feat: add widgets",
        draft: false,
        githubUpdatedAt: new Date("2026-10-01T10:05:00Z"),
        lifecycle: { state: PrStates.OPEN },
      },
    );

    const delayedPush = await trigger({
      headSha: "b".repeat(40),
      githubUpdatedAt: new Date("2026-10-01T10:02:00Z"),
    });

    expect(delayedPush).toMatchObject({ applied: true, queued: true });
  });

  it("keeps a push's head against a read that raced it in the same second", async () => {
    const pushedAt = new Date("2026-10-01T10:00:00Z");
    await trigger({ headSha: "a".repeat(40) });
    const { pullRequests } = createTenantRepository(harness.handle, CTX);
    const planned = await pullRequests.upsert({
      repoId: REPO_ID,
      prNumber: 7,
      repoSlug: "acme/widgets",
      state: PrStates.OPEN,
      liveRead: { readAt: new Date(), headSha: "a".repeat(40) },
    });
    const pushed = await trigger({
      headSha: "b".repeat(40),
      githubUpdatedAt: pushedAt,
    });
    const reads = createLiveReadStore(harness.handle, CTX);
    const heldRead = {
      readAt: new Date(),
      headSha: "a".repeat(40),
      repoSlug: "acme/widgets",
      title: "feat: add widgets",
      draft: false,
      githubUpdatedAt: pushedAt,
      lifecycle: { state: PrStates.OPEN },
    };

    const row = await reads.record(pushed.pullRequest.id, heldRead, planned);

    expect(row?.githubHeadSha).toBeNull();
  });

  it("keeps the head stamp for an event with no updated_at", async () => {
    await trigger({ headSha: "b".repeat(40) });
    await createTenantRepository(harness.handle, CTX).pullRequests.upsert({
      repoId: REPO_ID,
      prNumber: 7,
      repoSlug: "acme/widgets",
      state: PrStates.OPEN,
      liveRead: { readAt: new Date(), headSha: "b".repeat(40) },
    });

    const lateReview = await trigger({ headSha: "a".repeat(40) });

    expect(lateReview.pullRequest.githubHeadSha).toBe("b".repeat(40));
  });

  it("leaves a row no live read stamped without a head stamp", async () => {
    await trigger({ headSha: "a".repeat(40) });

    const pushed = await trigger({ headSha: "b".repeat(40) });

    expect(pushed.pullRequest.githubHeadSha).toBeNull();
  });

  it("refreshRunAt pulls a pending job in to the new window", async () => {
    await trigger({ debounceSeconds: 900 });
    const before = Date.now();

    await trigger({ debounceSeconds: 10, refreshRunAt: true });

    const jobs = await harness.raw("select run_at from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
    const delta = epochMs(jobs[0]?.["run_at"]) - before;
    expect(delta).toBeGreaterThan(5_000);
    expect(delta).toBeLessThan(15_000);
  });

  it("the previous release's running head keeps its row and gets no job", async () => {
    await trigger();
    await harness.raw(
      "update generation set status = 'running', phase = 'generating', repo_config = '{}'",
    );
    await harness.raw("delete from graphile_worker.jobs");

    const second = await trigger();

    const row = expectGeneration(second);
    expect(row.status).toBe(GenerationStatuses.RUNNING);
    expect(row.phase).toBe(GenerationPhases.GENERATING);
    expect(row.repoConfig).toBe("{}");
    expect(row.attempts).toBe(0);
    const jobs = await harness.raw("select id from graphile_worker.jobs");
    expect(jobs).toHaveLength(0);
  });

  describe("a re-trigger and the claim", () => {
    async function claimHead(pullRequestId: PullRequestRowId): Promise<void> {
      const claimed = await createGenerationProjection(
        harness.handle,
        CTX,
      ).claimRun({
        target: briefTarget(pullRequestId),
        phase: GenerationPhases.GENERATING,
        leaseMs: 120_000,
        from: new Date(0),
        to: new Date("2100-01-01T00:00:00.000Z"),
      });
      if (!claimed.ok) {
        throw new Error(claimed.error.message);
      }
      await harness.raw("delete from graphile_worker.jobs");
    }

    it("a head a live lease holds is kept and not enqueued", async () => {
      const first = await trigger();
      await claimHead(first.pullRequest.id);

      const second = await trigger();

      const row = expectGeneration(second);
      expect(second.queued).toBe(false);
      expect(row.status).toBe(GenerationStatuses.RUNNING);
      expect(row.runId).not.toBeNull();
      expect(await harness.raw("select id from graphile_worker.jobs")).toEqual(
        [],
      );
    });

    it("a running head whose lease lapsed is projected and enqueued", async () => {
      const first = await trigger();
      await claimHead(first.pullRequest.id);
      await harness.raw(
        "update generation set lease_expires_at = now() - interval '1 second'",
      );

      const second = await trigger();

      const row = expectGeneration(second);
      expect(row.status).toBe(GenerationStatuses.PENDING);
      expect(row.runId).toBeNull();
      expect(row.leaseExpiresAt).toBeNull();
      expect(row.phase).toBeNull();
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(1);
    });
  });

  describe("a re-trigger and the queued job", () => {
    const NEXT_HEAD_SHA = "b".repeat(40);

    /** Lock every job, as a worker that picked it up would. */
    async function holdJobs(): Promise<void> {
      await harness.raw("update graphile_worker.jobs set locked_at = now()");
    }

    async function readJobs(): Promise<Record<string, unknown>[]> {
      return harness.raw(
        "select id, key, run_at, locked_at, payload->>'head_sha' as head from graphile_worker.jobs order by id",
      );
    }

    it("a new head while the job is held queues its own job", async () => {
      const first = await trigger();
      await holdJobs();

      await trigger({ headSha: NEXT_HEAD_SHA });

      const jobs = await readJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs[0]?.["key"]).toBeNull();
      expect(jobs[0]?.["locked_at"]).not.toBeNull();
      expect(jobs[0]?.["head"]).toBe(HEAD_SHA);
      expect(jobs[1]?.["key"]).toBe(`generate:${first.pullRequest.id}`);
      expect(jobs[1]?.["locked_at"]).toBeNull();
      expect(jobs[1]?.["head"]).toBe(NEXT_HEAD_SHA);
    });

    // A known duplicate run, not a wanted behaviour: the held job has not
    // marked its row running yet, so the trigger queues the head again.
    it("a same-head trigger while the job is held queues a second job", async () => {
      const first = await trigger();
      await holdJobs();

      await trigger();

      const jobs = await readJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs[0]?.["key"]).toBeNull();
      expect(jobs[0]?.["locked_at"]).not.toBeNull();
      expect(jobs[0]?.["head"]).toBe(HEAD_SHA);
      expect(jobs[1]?.["key"]).toBe(`generate:${first.pullRequest.id}`);
      expect(jobs[1]?.["locked_at"]).toBeNull();
      expect(jobs[1]?.["head"]).toBe(HEAD_SHA);
    });
  });

  describe("requeueGenerateJob", () => {
    const DELAY_SECONDS = 125;
    const DELAY_SLACK_SECONDS = 2;

    async function holdJobs(): Promise<void> {
      await harness.raw("update graphile_worker.jobs set locked_at = now()");
    }

    async function readQueuedJobs(): Promise<Record<string, unknown>[]> {
      return harness.raw(
        "select key, max_attempts, payload::text as payload, extract(epoch from (run_at - now()))::float8 as delay from graphile_worker.jobs where locked_at is null",
      );
    }

    it("adds a delayed job beside the locked job that holds the key", async () => {
      const first = await trigger();
      await holdJobs();

      const requeued = await createIngestRoutines(
        harness.handle,
        CTX,
      ).requeueGenerateJob({
        pullRequestId: first.pullRequest.id,
        headSha: HEAD_SHA,
        delaySeconds: DELAY_SECONDS,
      });

      expect(requeued.queued).toBe(true);
      const jobs = await readQueuedJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.["key"]).toBe(`generate:${first.pullRequest.id}`);
      expect(jobs[0]?.["max_attempts"]).toBe(3);
      expect(JSON.parse(String(jobs[0]?.["payload"]))).toEqual({
        installation_id: "100",
        pull_request_id: String(first.pullRequest.id),
        head_sha: HEAD_SHA,
      });
      const delay = Number(jobs[0]?.["delay"]);
      expect(delay).toBeGreaterThan(DELAY_SECONDS - DELAY_SLACK_SECONDS);
      expect(delay).toBeLessThanOrEqual(DELAY_SECONDS);
    });

    it("leaves an unlocked queued job's payload and run_at as found", async () => {
      const first = await trigger();
      const before = await harness.raw(
        "select id, key, run_at, payload::text as payload from graphile_worker.jobs",
      );

      const requeued = await createIngestRoutines(
        harness.handle,
        CTX,
      ).requeueGenerateJob({
        pullRequestId: first.pullRequest.id,
        headSha: "b".repeat(40),
        delaySeconds: DELAY_SECONDS,
      });

      expect(requeued.queued).toBe(false);
      expect(
        await harness.raw(
          "select id, key, run_at, payload::text as payload from graphile_worker.jobs",
        ),
      ).toEqual(before);
    });

    it("revives a job whose attempts are spent instead of skipping it", async () => {
      const first = await trigger();
      await harness.raw(
        "update graphile_worker.jobs set attempts = max_attempts",
      );

      const requeued = await createIngestRoutines(
        harness.handle,
        CTX,
      ).requeueGenerateJob({
        pullRequestId: first.pullRequest.id,
        headSha: HEAD_SHA,
        delaySeconds: DELAY_SECONDS,
      });

      expect(requeued.queued).toBe(true);
      const jobs = await harness.raw(
        "select attempts, max_attempts from graphile_worker.jobs",
      );
      expect(jobs).toEqual([{ attempts: 0, max_attempts: 3 }]);
    });

    it("builds the owner payload in the url-box world", async () => {
      const ownerCtx = { ownerUserId: brandWith(isReviewerId, 555n) };
      const ingest = createIngestRoutines(harness.handle, ownerCtx);
      const recorded = await ingest.recordState({
        repoId: REPO_ID,
        prNumber: 7,
        state: PrStates.OPEN,
      });
      const grantId = brandWith(isGrantRowId, 9n);

      await ingest.requeueGenerateJob({
        pullRequestId: recorded.pullRequest.id,
        headSha: HEAD_SHA,
        grantId,
        delaySeconds: DELAY_SECONDS,
      });

      const jobs = await readQueuedJobs();
      expect(JSON.parse(String(jobs[0]?.["payload"]))).toEqual({
        owner_user_id: "555",
        grant_id: "9",
        pull_request_id: String(recorded.pullRequest.id),
        head_sha: HEAD_SHA,
      });
    });

    it("queues nothing for a pull request outside the scope", async () => {
      const first = await trigger();
      await holdJobs();
      const otherCtx = parseTenantContext({ installationId: 101n });

      const requeued = await createIngestRoutines(
        harness.handle,
        otherCtx,
      ).requeueGenerateJob({
        pullRequestId: first.pullRequest.id,
        headSha: HEAD_SHA,
        delaySeconds: DELAY_SECONDS,
      });

      expect(requeued.queued).toBe(false);
      expect(await readQueuedJobs()).toEqual([]);
    });

    it("refuses a negative delay", async () => {
      const first = await trigger();

      const requeued = createIngestRoutines(
        harness.handle,
        CTX,
      ).requeueGenerateJob({
        pullRequestId: first.pullRequest.id,
        headSha: HEAD_SHA,
        delaySeconds: -1,
      });

      await expect(requeued).rejects.toThrow(RangeError);
    });
  });

  describe("scheduleClaimRecovery", () => {
    const FIRST_DELAY_SECONDS = 60;
    const LATER_DELAY_SECONDS = 125;
    const DELAY_SLACK_SECONDS = 2;

    async function readRecoveryJobs(): Promise<Record<string, unknown>[]> {
      return harness.raw(
        "select key, max_attempts, locked_at, payload::text as payload, extract(epoch from (run_at - now()))::float8 as delay from graphile_worker.jobs where task_identifier = 'recover-generation' order by id",
      );
    }

    it("keeps one pending recovery job per head at the latest delay", async () => {
      const first = await trigger();
      const ingest = createIngestRoutines(harness.handle, CTX);
      const request = {
        pullRequestId: first.pullRequest.id,
        headSha: HEAD_SHA,
        delaySeconds: FIRST_DELAY_SECONDS,
      };

      await ingest.scheduleClaimRecovery(request);
      const scheduled = await ingest.scheduleClaimRecovery({
        ...request,
        delaySeconds: LATER_DELAY_SECONDS,
      });

      expect(scheduled.queued).toBe(true);
      const jobs = await readRecoveryJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.["key"]).toBe(
        `recover-generation:${first.pullRequest.id}:${HEAD_SHA}`,
      );
      expect(jobs[0]?.["max_attempts"]).toBe(3);
      expect(JSON.parse(String(jobs[0]?.["payload"]))).toEqual({
        installation_id: "100",
        pull_request_id: String(first.pullRequest.id),
        head_sha: HEAD_SHA,
      });
      const delay = Number(jobs[0]?.["delay"]);
      expect(delay).toBeGreaterThan(LATER_DELAY_SECONDS - DELAY_SLACK_SECONDS);
      expect(delay).toBeLessThanOrEqual(LATER_DELAY_SECONDS);
    });

    it("adds a job beside a running recovery and leaves the generate job", async () => {
      const first = await trigger();
      const ingest = createIngestRoutines(harness.handle, CTX);
      const request = {
        pullRequestId: first.pullRequest.id,
        headSha: HEAD_SHA,
        delaySeconds: LATER_DELAY_SECONDS,
      };
      await ingest.scheduleClaimRecovery(request);
      await harness.raw(
        "update graphile_worker.jobs set locked_at = now() where task_identifier = 'recover-generation'",
      );
      const generateJobs = await harness.raw(
        "select id, key, run_at from graphile_worker.jobs where task_identifier = 'generate'",
      );

      await ingest.scheduleClaimRecovery(request);

      const jobs = await readRecoveryJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs[0]?.["key"]).toBeNull();
      expect(jobs[1]?.["locked_at"]).toBeNull();
      expect(
        await harness.raw(
          "select id, key, run_at from graphile_worker.jobs where task_identifier = 'generate'",
        ),
      ).toEqual(generateJobs);
    });

    it("queues nothing for a pull request outside the scope", async () => {
      const first = await trigger();
      const otherCtx = parseTenantContext({ installationId: 101n });

      const scheduled = await createIngestRoutines(
        harness.handle,
        otherCtx,
      ).scheduleClaimRecovery({
        pullRequestId: first.pullRequest.id,
        headSha: HEAD_SHA,
        delaySeconds: LATER_DELAY_SECONDS,
      });

      expect(scheduled.queued).toBe(false);
      expect(await readRecoveryJobs()).toEqual([]);
    });

    it("refuses a negative delay", async () => {
      const first = await trigger();

      const scheduled = createIngestRoutines(
        harness.handle,
        CTX,
      ).scheduleClaimRecovery({
        pullRequestId: first.pullRequest.id,
        headSha: HEAD_SHA,
        delaySeconds: -1,
      });

      await expect(scheduled).rejects.toThrow(RangeError);
    });
  });

  it("refreshRunAt does not re-enqueue a running head", async () => {
    const first = await trigger({ debounceSeconds: 900 });
    const firstJobs = await harness.raw(
      "select run_at from graphile_worker.jobs",
    );
    const firstRunAt = epochMs(firstJobs[0]?.["run_at"]);
    await claimTestRun(
      createGenerationProjection(harness.handle, CTX),
      briefTarget(first.pullRequest.id),
    );

    await trigger({ debounceSeconds: 10, refreshRunAt: true });

    const jobs = await harness.raw("select run_at from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
    expect(epochMs(jobs[0]?.["run_at"])).toBe(firstRunAt);
  });

  it("a succeeded head is reset to pending and enqueued again", async () => {
    const first = await trigger();
    const target = briefTarget(first.pullRequest.id);
    await succeedTestRun(
      createGenerationProjection(harness.handle, CTX),
      target,
    );
    await harness.raw("delete from graphile_worker.jobs");

    const second = await trigger();

    const row = expectGeneration(second);
    expect(row.status).toBe(GenerationStatuses.PENDING);
    expect(row.phase).toBeNull();
    expect(row.attempts).toBe(1);
    const jobs = await harness.raw("select id from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
  });

  it("rejects stale non-reopen triggers for closed PRs without enqueueing", async () => {
    await trigger();
    const jobsBefore = await harness.raw(
      "select run_at from graphile_worker.jobs",
    );
    await closePr();

    // A redelivered synchronize / a review on the now-closed PR: writes
    // state:open too, but must leave the terminal lifecycle intact AND queue
    // nothing (no forever-pending generation row, no dead job).
    const outcome = await trigger();
    expect(outcome.pullRequest.state).toBe(PrStates.CLOSED);
    expect(outcome.pullRequest.closedAt).not.toBeNull();
    expect(outcome.generation).toBeUndefined();

    const prs = await harness.raw("select state, closed_at from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["state"]).toBe(PrStates.CLOSED);
    expect(prs[0]?.["closed_at"]).not.toBeNull();

    // The pre-close generation row is untouched (no attempts bump) and the
    // pre-close job was not replaced (run_at unchanged).
    const generations = await harness.raw("select attempts from generation");
    expect(generations).toHaveLength(1);
    expect(generations[0]?.["attempts"]).toBe(0);
    const jobsAfter = await harness.raw(
      "select run_at from graphile_worker.jobs",
    );
    expect(jobsAfter).toHaveLength(1);
    expect(epochMs(jobsAfter[0]?.["run_at"])).toBe(
      epochMs(jobsBefore[0]?.["run_at"]),
    );
  });

  it("transitions a closed PR back to open on an explicit reopen", async () => {
    await trigger();
    await closePr();

    const outcome = await trigger({ reopen: true });
    expect(outcome.pullRequest.state).toBe(PrStates.OPEN);
    expect(outcome.pullRequest.closedAt).toBeNull();
  });

  it("rolls back the whole transaction when enqueueing fails", async () => {
    harness = await createPgliteHarness();
    onTestFinished(() => harness.close());
    await harness.raw(
      "drop function graphile_worker.add_job(text, json, text, timestamptz, int, text)",
    );

    await expect(trigger()).rejects.toThrow(/add_job/);

    expect(await harness.raw("select id from pull_request")).toHaveLength(0);
    expect(await harness.raw("select id from generation")).toHaveLength(0);
  });

  it("throws on an invalid debounce and writes nothing", async () => {
    await expect(trigger({ debounceSeconds: -1 })).rejects.toThrow(RangeError);

    expect(await harness.raw("select id from pull_request")).toHaveLength(0);
  });

  // recordState: the enqueue-free sibling, state-only events
  // (converted_to_draft) persist PR fields WITHOUT touching the generation
  // projection or scheduling work.
  describe("recordState", () => {
    it("upserts the PR row without a generation row or job", async () => {
      const { pullRequest: row } = await createIngestRoutines(
        harness.handle,
        CTX,
      ).recordState({
        repoId: REPO_ID,
        prNumber: 7,
        repoSlug: "acme/widgets",
        title: "feat: add widgets",
        draft: true,
        authorLogin: "author-octocat",
        state: PrStates.OPEN,
      });
      expect(row.draft).toBe(true);
      expect(row.authorLogin).toBe("author-octocat");
      expect(await harness.raw("select id from pull_request")).toHaveLength(1);
      expect(await harness.raw("select id from generation")).toHaveLength(0);
      expect(
        await harness.raw("select id from graphile_worker.jobs"),
      ).toHaveLength(0);
    });

    it("leaves an existing generation projection untouched", async () => {
      await trigger();
      const before = await harness.raw(
        "select status, attempts from generation",
      );

      await createIngestRoutines(harness.handle, CTX).recordState({
        repoId: REPO_ID,
        prNumber: 7,
        repoSlug: "acme/widgets",
        draft: true,
        state: PrStates.OPEN,
      });
      const after = await harness.raw(
        "select status, attempts from generation",
      );
      expect(after).toEqual(before);
      // Still exactly the one job from the trigger, no new enqueue.
      expect(
        await harness.raw("select id from graphile_worker.jobs"),
      ).toHaveLength(1);
    });

    it("skips an event older than the stored github timestamp", async () => {
      const later = new Date("2026-09-20T10:05:00Z");
      const earlier = new Date("2026-09-20T10:00:00Z");
      const ingest = createIngestRoutines(harness.handle, CTX);
      await ingest.recordState({
        repoId: REPO_ID,
        prNumber: 7,
        title: "newer",
        githubUpdatedAt: later,
        state: PrStates.OPEN,
      });

      const skipped = await ingest.recordState({
        repoId: REPO_ID,
        prNumber: 7,
        title: "older",
        githubUpdatedAt: earlier,
        state: PrStates.OPEN,
      });

      expect(skipped.applied).toBe(false);
      expect(skipped.pullRequest.title).toBe("newer");
      expect(skipped.pullRequest.githubUpdatedAt).toEqual(later);
    });

    it("skips an older event in the owner world too", async () => {
      const later = new Date("2026-09-20T10:05:00Z");
      const earlier = new Date("2026-09-20T10:00:00Z");
      const ingest = createIngestRoutines(harness.handle, {
        ownerUserId: brandWith(isReviewerId, 555n),
      });
      await ingest.recordState({
        repoId: REPO_ID,
        prNumber: 7,
        title: "newer",
        githubUpdatedAt: later,
        state: PrStates.OPEN,
      });

      const skipped = await ingest.recordState({
        repoId: REPO_ID,
        prNumber: 7,
        title: "older",
        githubUpdatedAt: earlier,
        state: PrStates.OPEN,
      });

      expect(skipped.applied).toBe(false);
      expect(skipped.pullRequest.title).toBe("newer");
    });

    it("preserves terminal lifecycle without resurrecting closed PRs", async () => {
      await trigger();
      await closePr();

      const { pullRequest: row } = await createIngestRoutines(
        harness.handle,
        CTX,
      ).recordState({
        repoId: REPO_ID,
        prNumber: 7,
        repoSlug: "acme/widgets",
        draft: true,
        state: PrStates.OPEN,
      });
      expect(row.state).toBe(PrStates.CLOSED);
      expect(row.closedAt).not.toBeNull();
      // The non-lifecycle fields still refreshed.
      expect(row.draft).toBe(true);
    });
  });

  describe("stored brief coverage", () => {
    const BASE_SHA = "f95f852bd8fca8fcc58a9a2d6c842781e32a215e";

    /** Store a brief for the pair and drain the job, as a finished run would. */
    async function storeBrief(pullRequestId: bigint): Promise<bigint> {
      const written = await createArtifactStore(
        harness.handle,
        CTX,
      ).briefs.write({
        pullRequestId: brandWith(isPullRequestRowId, pullRequestId),
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        headIndex: 1,
        commitCount: 1,
        provider: "stub",
        model: "stub",
        effort: "low",
        body: "{}",
        usedGroupIds: [],
      });
      await drainSucceeded();
      return written.id;
    }

    async function checkpointAt(
      pullRequestId: PullRequestRowId,
      lastSubmittedSha: string,
    ): Promise<void> {
      await createTenantRepository(
        harness.handle,
        CTX,
      ).checkpoints.upsertOnSubmit({
        pullRequestId,
        reviewerId: brandWith(isReviewerId, 555n),
        lastSubmittedSha,
        submittedAt: new Date(),
      });
    }

    async function drainSucceeded(): Promise<void> {
      await harness.raw("update generation set status = 'succeeded'");
      await harness.raw("delete from graphile_worker.jobs");
    }

    async function readGeneration(): Promise<Record<string, unknown>> {
      const rows = await harness.raw("select status, attempts from generation");
      const row = rows[0];
      if (row === undefined) {
        throw new Error("no generation row");
      }
      return row;
    }

    it("queues nothing when a brief covers the base and head pair", async () => {
      const first = await trigger({ baseSha: BASE_SHA });
      const briefId = await storeBrief(first.pullRequest.id);

      const second = await trigger({ baseSha: BASE_SHA });

      expect(second.coveredBy).toBe(briefId);
      expect(second.queued).toBe(false);
      expect(second.generation).toBeUndefined();
      expect(await readGeneration()).toEqual({
        status: GenerationStatuses.SUCCEEDED,
        attempts: 0,
      });
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(0);
    });

    it("a moved base is a new pair and queues", async () => {
      const first = await trigger({ baseSha: BASE_SHA });
      await storeBrief(first.pullRequest.id);

      const moved = await trigger({ baseSha: "a".repeat(40) });

      expect(moved.coveredBy).toBeUndefined();
      expect(expectGeneration(moved).status).toBe(GenerationStatuses.PENDING);
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(1);
    });

    it("a submitted review is work the brief does not cover", async () => {
      const first = await trigger({ baseSha: BASE_SHA });
      await storeBrief(first.pullRequest.id);

      const review = await trigger({
        baseSha: BASE_SHA,
        uncoveredWork: UncoveredWorks.REVIEW,
      });

      expect(review.coveredBy).toBeUndefined();
      expect(review.generation).toBeUndefined();
      expect(await readGeneration()).toEqual({
        status: GenerationStatuses.SUCCEEDED,
        attempts: 0,
      });
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(1);
    });

    it("a checkpoint at another head owes the covered head its delta", async () => {
      const first = await trigger({ baseSha: BASE_SHA });
      await storeBrief(first.pullRequest.id);
      const pullRequestId = brandWith(isPullRequestRowId, first.pullRequest.id);
      await checkpointAt(pullRequestId, "b".repeat(40));

      const returned = await trigger({ baseSha: BASE_SHA });

      expect(returned.coveredBy).toBeUndefined();
      expect(returned.generation).toBeUndefined();
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(1);
    });

    it("a checkpoint whose delta reaches the head keeps the pair covered", async () => {
      const first = await trigger({ baseSha: BASE_SHA });
      const briefId = await storeBrief(first.pullRequest.id);
      const pullRequestId = brandWith(isPullRequestRowId, first.pullRequest.id);
      const checkpointSha = "b".repeat(40);
      await checkpointAt(pullRequestId, checkpointSha);
      await createArtifactStore(harness.handle, CTX).deltas.write({
        pullRequestId,
        baselineSha: checkpointSha,
        headSha: HEAD_SHA,
        provider: "stub",
        model: "stub",
        effort: "low",
        body: "{}",
      });

      const returned = await trigger({ baseSha: BASE_SHA });

      expect(returned.coveredBy).toBe(briefId);
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(0);
    });

    it("a checkpoint at the head itself owes nothing", async () => {
      const first = await trigger({ baseSha: BASE_SHA });
      const briefId = await storeBrief(first.pullRequest.id);
      await checkpointAt(
        brandWith(isPullRequestRowId, first.pullRequest.id),
        HEAD_SHA,
      );

      const returned = await trigger({ baseSha: BASE_SHA });

      expect(returned.coveredBy).toBe(briefId);
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(0);
    });

    it("uncovered work queues nothing while a worker holds the job", async () => {
      const first = await trigger({ baseSha: BASE_SHA });
      await storeBrief(first.pullRequest.id);
      await trigger({
        baseSha: BASE_SHA,
        uncoveredWork: UncoveredWorks.REVIEW,
      });
      await harness.raw("update graphile_worker.jobs set locked_at = now()");
      await writeJobRunAt(harness, PINNED_RUN_AT);

      const held = await trigger({
        baseSha: BASE_SHA,
        uncoveredWork: UncoveredWorks.ENTRY_COMMENT,
        debounceSeconds: 1,
        refreshRunAt: true,
      });

      expect(held.generation).toBeUndefined();
      const jobs = await harness.raw(
        "select run_at, locked_at from graphile_worker.jobs",
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.["locked_at"]).not.toBeNull();
      expect(epochMs(jobs[0]?.["run_at"])).toBe(PINNED_RUN_AT.getTime());
    });

    it("a ready flip queues and leaves the entry comment to the worker", async () => {
      const first = await trigger({ baseSha: BASE_SHA });
      await storeBrief(first.pullRequest.id);
      await createTenantRepository(
        harness.handle,
        CTX,
      ).pullRequests.swapEntryComment(
        brandWith(isPullRequestRowId, first.pullRequest.id),
        { seen: null, next: 4242n },
      );

      const flipped = await trigger({
        baseSha: BASE_SHA,
        uncoveredWork: UncoveredWorks.ENTRY_COMMENT,
      });

      expect(flipped.coveredBy).toBeUndefined();
      expect(flipped.queued).toBe(true);
      expect(flipped.generation).toBeUndefined();
      expect(await readGeneration()).toEqual({
        status: GenerationStatuses.SUCCEEDED,
        attempts: 0,
      });
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(1);
    });
  });

  describe("regeneration debounce", () => {
    /**
     * Mark the PR's stored brief generation(s) succeeded, out-of-band, and
     * drop the drained job as graphile does once a job completes.
     */
    async function markSucceeded(): Promise<void> {
      await harness.raw("update generation set status = 'succeeded'");
      await harness.raw("delete from graphile_worker.jobs");
    }

    it("uses the normal window while no prior brief has succeeded", async () => {
      const before = Date.now();
      await trigger({ regenerationDebounceSeconds: 900 });
      const jobs = await harness.raw("select run_at from graphile_worker.jobs");
      const delta = epochMs(jobs[0]?.["run_at"]) - before;
      expect(delta).toBeGreaterThan(50_000);
      expect(delta).toBeLessThan(70_000);
    });

    it("keeps the normal window while the prior generation is only pending", async () => {
      await trigger();
      await harness.raw("delete from graphile_worker.jobs");
      const before = Date.now();
      await trigger({
        regenerationDebounceSeconds: 900,
        headSha: "b".repeat(40),
      });
      const jobs = await harness.raw("select run_at from graphile_worker.jobs");
      const delta = epochMs(jobs[0]?.["run_at"]) - before;
      expect(delta).toBeLessThan(70_000);
    });

    it("applies regenerationDebounceSeconds once a prior brief succeeded", async () => {
      await trigger();
      await markSucceeded();
      const before = Date.now();
      await trigger({
        regenerationDebounceSeconds: 900,
        headSha: "b".repeat(40),
      });
      const jobs = await harness.raw("select run_at from graphile_worker.jobs");
      const delta = epochMs(jobs[0]?.["run_at"]) - before;
      expect(delta).toBeGreaterThan(890_000);
      expect(delta).toBeLessThan(910_000);
    });

    it("keeps failed prior generations undamped because no brief exists", async () => {
      await trigger();
      await harness.raw("update generation set status = 'failed'");
      await harness.raw("delete from graphile_worker.jobs");
      const before = Date.now();
      await trigger({
        regenerationDebounceSeconds: 900,
        headSha: "b".repeat(40),
      });
      const jobs = await harness.raw("select run_at from graphile_worker.jobs");
      const delta = epochMs(jobs[0]?.["run_at"]) - before;
      expect(delta).toBeLessThan(70_000);
    });

    it("rejects a negative or non-finite regenerationDebounceSeconds", async () => {
      for (const bad of [-1, Number.NaN]) {
        await expect(
          trigger({ regenerationDebounceSeconds: bad }),
        ).rejects.toThrow(RangeError);
      }
    });
  });
});
