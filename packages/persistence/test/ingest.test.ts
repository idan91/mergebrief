// The transactional ingest boundary: PR upsert + pending generation
// projection + debounced graphile `generate` job, atomically. Runs on the
// PGlite harness because it provides the `graphile_worker` stub the enqueue
// step calls by name.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  IngestOutcome,
  TriggerGenerationInput,
} from "../src/stores/ingest";
import { createIngestRoutines } from "../src/stores/ingest";
import { createArtifactStore } from "../src/stores/artifact-store";
import { createGenerationProjection } from "../src/stores/generation";
import type { PullRequestUpsertInput } from "../src/stores/tenant";
import type { Mutable, Result } from "types/utils";
import {
  createTenantRepository,
  parseTenantContext,
} from "../src/stores/tenant";
import { createPgliteHarness, type PgliteHarness } from "../src/testing";
import {
  GenerationKinds,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  UncoveredWorks,
  type PullRequestRowId,
  type UncoveredWork,
} from "../src/types";
import {
  GenerationFailureCodes,
  GenerationPhases,
  GenerationStatuses,
} from "types/generations";
import { PrStates } from "types/pull-requests";
import { brandWith } from "./helpers";

const CTX = parseTenantContext({ installationId: 100n });
const REPO_ID = brandWith(isRepoId, 200n);
const HEAD_SHA = "ec26c3e57ca3a959ca5aad62de7213c562f8c821";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(
      `expected ok result, got error: ${JSON.stringify(result.error)}`,
    );
  }
  return result.value;
}

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
  let harness: PgliteHarness;

  beforeEach(async () => {
    harness = await createPgliteHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function trigger(overrides?: {
    debounceSeconds?: number;
    regenerationDebounceSeconds?: number;
    reopen?: boolean;
    refreshRunAt?: boolean;
    baseSha?: string;
    headSha?: string;
    uncoveredWork?: UncoveredWork;
  }): Promise<Result<IngestOutcome, { code: string; message: string }>> {
    const pullRequest: Mutable<PullRequestUpsertInput> = {
      repoId: REPO_ID,
      prNumber: 7,
      repoSlug: "acme/widgets",
      title: "feat: add widgets",
      state: PrStates.OPEN,
    };

    if (overrides?.baseSha !== undefined)
      pullRequest.baseSha = overrides.baseSha;

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
    if (overrides?.reopen !== undefined) input.reopen = overrides.reopen;
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
      purgeAfter: null,
    });
  }

  it("atomically writes PR, pending generation and debounced job rows", async () => {
    const before = Date.now();
    const outcome = unwrap(await trigger());

    // The returned pull_request row.
    expect(outcome.pullRequest.installationId).toBe(CTX.installationId);
    expect(outcome.pullRequest.repoId).toBe(REPO_ID);
    expect(outcome.pullRequest.prNumber).toBe(7);
    expect(outcome.pullRequest.title).toBe("feat: add widgets");
    expect(outcome.pullRequest.state).toBe(PrStates.OPEN);

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
    if (job === undefined) throw new Error("expected a jobs row");
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

  it("persists baseSha and preserves it when a later trigger omits it", async () => {
    const first = unwrap(await trigger({ baseSha: "base-1" }));
    expect(first.pullRequest.baseSha).toBe("base-1");

    // Review-event trigger (no baseSha) must not null the stored value.
    const preserved = unwrap(await trigger());
    expect(preserved.pullRequest.baseSha).toBe("base-1");

    const retargeted = unwrap(await trigger({ baseSha: "base-2" }));
    expect(retargeted.pullRequest.baseSha).toBe("base-2");
  });

  it("redelivery increments attempts and keeps the one job's run_at", async () => {
    const first = unwrap(await trigger());
    const firstJobs = await harness.raw(
      "select run_at from graphile_worker.jobs",
    );
    const firstRunAt = epochMs(firstJobs[0]?.["run_at"]);

    // Let the clock move so the replaced run_at is strictly later.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = unwrap(await trigger());

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
    expect(epochMs(jobs[0]?.["run_at"])).toBe(firstRunAt);
  });

  it("a later push keeps the first run_at and carries the new head", async () => {
    const first = unwrap(await trigger({ headSha: "a".repeat(40) }));
    const firstJobs = await harness.raw(
      "select run_at from graphile_worker.jobs",
    );
    const firstRunAt = epochMs(firstJobs[0]?.["run_at"]);
    await new Promise((resolve) => setTimeout(resolve, 25));

    unwrap(await trigger({ headSha: "b".repeat(40) }));

    const jobs = await harness.raw(
      "select payload, run_at from graphile_worker.jobs",
    );
    expect(jobs).toHaveLength(1);
    expect(epochMs(jobs[0]?.["run_at"])).toBe(firstRunAt);
    expect(jobs[0]?.["payload"]).toMatchObject({
      pull_request_id: String(first.pullRequest.id),
      head_sha: "b".repeat(40),
    });
  });

  it("refreshRunAt pulls a pending job in to the new window", async () => {
    unwrap(await trigger({ debounceSeconds: 900 }));
    const before = Date.now();

    unwrap(await trigger({ debounceSeconds: 10, refreshRunAt: true }));

    const jobs = await harness.raw("select run_at from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
    const delta = epochMs(jobs[0]?.["run_at"]) - before;
    expect(delta).toBeGreaterThan(5_000);
    expect(delta).toBeLessThan(15_000);
  });

  it("a running head keeps its row and gets no second job", async () => {
    const first = unwrap(await trigger());
    const target = briefTarget(first.pullRequest.id);
    const projection = createGenerationProjection(harness.handle, CTX);
    await projection.markRunning(target, GenerationPhases.GENERATING);
    await projection.recordRepoConfig(target, "{}");
    await harness.raw("delete from graphile_worker.jobs");

    const second = unwrap(await trigger());

    const row = expectGeneration(second);
    expect(row.status).toBe(GenerationStatuses.RUNNING);
    expect(row.phase).toBe(GenerationPhases.GENERATING);
    expect(row.repoConfig).toBe("{}");
    expect(row.attempts).toBe(0);
    const jobs = await harness.raw("select id from graphile_worker.jobs");
    expect(jobs).toHaveLength(0);
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
      const first = unwrap(await trigger());
      await holdJobs();

      unwrap(await trigger({ headSha: NEXT_HEAD_SHA }));

      const jobs = await readJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs[0]?.["key"]).toBeNull();
      expect(jobs[0]?.["locked_at"]).not.toBeNull();
      expect(jobs[0]?.["head"]).toBe(HEAD_SHA);
      expect(jobs[1]?.["key"]).toBe(`generate:${first.pullRequest.id}`);
      expect(jobs[1]?.["locked_at"]).toBeNull();
      expect(jobs[1]?.["head"]).toBe(NEXT_HEAD_SHA);
    });

    it("a same-head trigger on a queued job keeps the one job", async () => {
      unwrap(await trigger());
      const before = await readJobs();

      unwrap(await trigger());

      expect(await readJobs()).toEqual(before);
    });

    // A known duplicate run, not a wanted behaviour: the held job has not
    // marked its row running yet, so the trigger queues the head again.
    it("a same-head trigger while the job is held queues a second job", async () => {
      const first = unwrap(await trigger());
      await holdJobs();

      unwrap(await trigger());

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

  it("refreshRunAt does not re-enqueue a running head", async () => {
    const first = unwrap(await trigger({ debounceSeconds: 900 }));
    const firstJobs = await harness.raw(
      "select run_at from graphile_worker.jobs",
    );
    const firstRunAt = epochMs(firstJobs[0]?.["run_at"]);
    const projection = createGenerationProjection(harness.handle, CTX);
    await projection.markRunning(
      briefTarget(first.pullRequest.id),
      GenerationPhases.GENERATING,
    );

    unwrap(await trigger({ debounceSeconds: 10, refreshRunAt: true }));

    const jobs = await harness.raw("select run_at from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
    expect(epochMs(jobs[0]?.["run_at"])).toBe(firstRunAt);
  });

  it("a succeeded head is reset to pending and enqueued again", async () => {
    const first = unwrap(await trigger());
    const target = briefTarget(first.pullRequest.id);
    const projection = createGenerationProjection(harness.handle, CTX);
    await projection.markRunning(target, GenerationPhases.GENERATING);
    await projection.markSucceeded(target);
    await harness.raw("delete from graphile_worker.jobs");

    const second = unwrap(await trigger());

    const row = expectGeneration(second);
    expect(row.status).toBe(GenerationStatuses.PENDING);
    expect(row.phase).toBeNull();
    expect(row.attempts).toBe(1);
    const jobs = await harness.raw("select id from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
  });

  it("a failed head is reset to pending with its error cleared", async () => {
    const first = unwrap(await trigger());
    const target = briefTarget(first.pullRequest.id);
    const projection = createGenerationProjection(harness.handle, CTX);
    await projection.markRunning(target, GenerationPhases.GENERATING);
    await projection.markFailed(target, {
      code: GenerationFailureCodes.UNKNOWN,
      params: { detail: "boom" },
    });
    await harness.raw("delete from graphile_worker.jobs");

    const second = unwrap(await trigger());

    const row = expectGeneration(second);
    expect(row.status).toBe(GenerationStatuses.PENDING);
    expect(row.errorCode).toBeNull();
    expect(row.errorParams).toBeNull();
    const jobs = await harness.raw("select id from graphile_worker.jobs");
    expect(jobs).toHaveLength(1);
  });

  it("rejects stale non-reopen triggers for closed PRs without enqueueing", async () => {
    unwrap(await trigger());
    const jobsBefore = await harness.raw(
      "select run_at from graphile_worker.jobs",
    );
    await closePr();

    // A redelivered synchronize / a review on the now-closed PR: writes
    // state:open too, but must leave the terminal lifecycle intact AND queue
    // nothing (no forever-pending generation row, no dead job).
    const outcome = unwrap(await trigger());
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
    unwrap(await trigger());
    await closePr();

    const outcome = unwrap(await trigger({ reopen: true }));
    expect(outcome.pullRequest.state).toBe(PrStates.OPEN);
    expect(outcome.pullRequest.closedAt).toBeNull();
    expect(outcome.pullRequest.purgeAfter).toBeNull();
  });

  it("rolls back the whole transaction when enqueueing fails", async () => {
    await harness.raw(
      "drop function graphile_worker.add_job(text, json, text, timestamptz, text)",
    );

    await expect(trigger()).rejects.toThrow(/add_job/);

    expect(await harness.raw("select id from pull_request")).toHaveLength(0);
    expect(await harness.raw("select id from generation")).toHaveLength(0);
  });

  it("refuses invalid debounce with a Result error and no writes", async () => {
    const result = await trigger({ debounceSeconds: -1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an error result");
    expect(result.error.code).toBe("invalid-debounce");
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
      unwrap(await trigger());
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
      unwrap(await trigger());
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
      });
      if (!written.ok) throw new Error(written.error.message);
      await drainSucceeded();
      return written.value.id;
    }

    async function checkpointAt(
      pullRequestId: PullRequestRowId,
      lastSubmittedSha: string,
    ): Promise<void> {
      const stored = await createTenantRepository(
        harness.handle,
        CTX,
      ).checkpoints.upsertOnSubmit({
        pullRequestId,
        reviewerId: brandWith(isReviewerId, 555n),
        lastSubmittedSha,
        submittedAt: new Date(),
      });
      if (!stored.ok) throw new Error(stored.error.message);
    }

    async function drainSucceeded(): Promise<void> {
      await harness.raw("update generation set status = 'succeeded'");
      await harness.raw("delete from graphile_worker.jobs");
    }

    async function readGeneration(): Promise<Record<string, unknown>> {
      const rows = await harness.raw("select status, attempts from generation");
      const row = rows[0];
      if (row === undefined) throw new Error("no generation row");
      return row;
    }

    it("queues nothing when a brief covers the base and head pair", async () => {
      const first = unwrap(await trigger({ baseSha: BASE_SHA }));
      const briefId = await storeBrief(first.pullRequest.id);

      const second = unwrap(await trigger({ baseSha: BASE_SHA }));

      expect(second.coveredBy).toBe(briefId);
      expect(second.generation).toBeUndefined();
      expect(await readGeneration()).toEqual({
        status: GenerationStatuses.SUCCEEDED,
        attempts: 0,
      });
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(0);
    });

    it("a moved base is a new pair and queues", async () => {
      const first = unwrap(await trigger({ baseSha: BASE_SHA }));
      await storeBrief(first.pullRequest.id);

      const moved = unwrap(await trigger({ baseSha: "a".repeat(40) }));

      expect(moved.coveredBy).toBeUndefined();
      expect(expectGeneration(moved).status).toBe(GenerationStatuses.PENDING);
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(1);
    });

    it("a submitted review is work the brief does not cover", async () => {
      const first = unwrap(await trigger({ baseSha: BASE_SHA }));
      await storeBrief(first.pullRequest.id);

      const review = unwrap(
        await trigger({
          baseSha: BASE_SHA,
          uncoveredWork: UncoveredWorks.REVIEW,
        }),
      );

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
      const first = unwrap(await trigger({ baseSha: BASE_SHA }));
      await storeBrief(first.pullRequest.id);
      const pullRequestId = brandWith(isPullRequestRowId, first.pullRequest.id);
      await checkpointAt(pullRequestId, "b".repeat(40));

      const returned = unwrap(await trigger({ baseSha: BASE_SHA }));

      expect(returned.coveredBy).toBeUndefined();
      expect(returned.generation).toBeUndefined();
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(1);
    });

    it("a checkpoint whose delta reaches the head keeps the pair covered", async () => {
      const first = unwrap(await trigger({ baseSha: BASE_SHA }));
      const briefId = await storeBrief(first.pullRequest.id);
      const pullRequestId = brandWith(isPullRequestRowId, first.pullRequest.id);
      const checkpointSha = "b".repeat(40);
      await checkpointAt(pullRequestId, checkpointSha);
      const delta = await createArtifactStore(harness.handle, CTX).deltas.write(
        {
          pullRequestId,
          baselineSha: checkpointSha,
          headSha: HEAD_SHA,
          provider: "stub",
          model: "stub",
          effort: "low",
          body: "{}",
        },
      );
      if (!delta.ok) throw new Error(delta.error.message);

      const returned = unwrap(await trigger({ baseSha: BASE_SHA }));

      expect(returned.coveredBy).toBe(briefId);
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(0);
    });

    it("a checkpoint at the head itself owes nothing", async () => {
      const first = unwrap(await trigger({ baseSha: BASE_SHA }));
      const briefId = await storeBrief(first.pullRequest.id);
      await checkpointAt(
        brandWith(isPullRequestRowId, first.pullRequest.id),
        HEAD_SHA,
      );

      const returned = unwrap(await trigger({ baseSha: BASE_SHA }));

      expect(returned.coveredBy).toBe(briefId);
      const jobs = await harness.raw("select id from graphile_worker.jobs");
      expect(jobs).toHaveLength(0);
    });

    it("uncovered work queues nothing while a worker holds the job", async () => {
      const first = unwrap(await trigger({ baseSha: BASE_SHA }));
      await storeBrief(first.pullRequest.id);
      unwrap(
        await trigger({
          baseSha: BASE_SHA,
          uncoveredWork: UncoveredWorks.REVIEW,
        }),
      );
      await harness.raw("update graphile_worker.jobs set locked_at = now()");
      const before = await harness.raw(
        "select run_at from graphile_worker.jobs",
      );
      await new Promise((resolve) => setTimeout(resolve, 25));

      const held = unwrap(
        await trigger({
          baseSha: BASE_SHA,
          uncoveredWork: UncoveredWorks.ENTRY_COMMENT,
          debounceSeconds: 1,
          refreshRunAt: true,
        }),
      );

      expect(held.generation).toBeUndefined();
      const jobs = await harness.raw(
        "select run_at, locked_at from graphile_worker.jobs",
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.["locked_at"]).not.toBeNull();
      expect(epochMs(jobs[0]?.["run_at"])).toBe(epochMs(before[0]?.["run_at"]));
    });

    it("a ready flip queues and leaves the entry comment to the worker", async () => {
      const first = unwrap(await trigger({ baseSha: BASE_SHA }));
      await storeBrief(first.pullRequest.id);
      await createTenantRepository(
        harness.handle,
        CTX,
      ).pullRequests.setEntryComment(
        brandWith(isPullRequestRowId, first.pullRequest.id),
        4242n,
      );

      const flipped = unwrap(
        await trigger({
          baseSha: BASE_SHA,
          uncoveredWork: UncoveredWorks.ENTRY_COMMENT,
        }),
      );

      expect(flipped.coveredBy).toBeUndefined();
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
      const result = await trigger({ regenerationDebounceSeconds: 900 });
      expect(result.ok).toBe(true);
      const jobs = await harness.raw("select run_at from graphile_worker.jobs");
      const delta = epochMs(jobs[0]?.["run_at"]) - before;
      expect(delta).toBeGreaterThan(50_000);
      expect(delta).toBeLessThan(70_000);
    });

    it("keeps the normal window while the prior generation is only pending", async () => {
      await trigger();
      const before = Date.now();
      const result = await trigger({
        regenerationDebounceSeconds: 900,
        headSha: "b".repeat(40),
      });
      expect(result.ok).toBe(true);
      const jobs = await harness.raw("select run_at from graphile_worker.jobs");
      const delta = epochMs(jobs[0]?.["run_at"]) - before;
      expect(delta).toBeLessThan(70_000);
    });

    it("applies regenerationDebounceSeconds once a prior brief succeeded", async () => {
      await trigger();
      await markSucceeded();
      const before = Date.now();
      const result = await trigger({
        regenerationDebounceSeconds: 900,
        headSha: "b".repeat(40),
      });
      expect(result.ok).toBe(true);
      const jobs = await harness.raw("select run_at from graphile_worker.jobs");
      const delta = epochMs(jobs[0]?.["run_at"]) - before;
      expect(delta).toBeGreaterThan(890_000);
      expect(delta).toBeLessThan(910_000);
    });

    it("keeps failed prior generations undamped because no brief exists", async () => {
      await trigger();
      await harness.raw("update generation set status = 'failed'");
      const before = Date.now();
      const result = await trigger({
        regenerationDebounceSeconds: 900,
        headSha: "b".repeat(40),
      });
      expect(result.ok).toBe(true);
      const jobs = await harness.raw("select run_at from graphile_worker.jobs");
      const delta = epochMs(jobs[0]?.["run_at"]) - before;
      expect(delta).toBeLessThan(70_000);
    });

    it("rejects a negative or non-finite regenerationDebounceSeconds", async () => {
      for (const bad of [-1, Number.NaN]) {
        const result = await trigger({ regenerationDebounceSeconds: bad });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("invalid-debounce");
      }
    });
  });
});
