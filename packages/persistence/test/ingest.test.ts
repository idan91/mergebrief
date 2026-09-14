// The transactional ingest boundary: PR upsert + queued generation
// projection + debounced graphile `generate` job, atomically. Runs on the
// PGlite harness because it provides the `graphile_worker` stub the enqueue
// step calls by name.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  IngestOutcome,
  TriggerGenerationInput,
} from "../src/stores/ingest";
import { createIngestRoutines } from "../src/stores/ingest";
import type { PullRequestUpsertInput } from "../src/stores/tenant";
import type { Mutable } from "types/utils";
import {
  createTenantRepository,
  parseTenantContext,
} from "../src/stores/tenant";
import { createPgliteHarness, type PgliteHarness } from "../src/testing";
import {
  GenerationKinds,
  GenerationStatuses,
  isRepoId,
  PrStates,
  type Result,
} from "../src/types";
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
    baseSha?: string;
    headSha?: string;
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

  it("atomically writes PR, queued generation and debounced job rows", async () => {
    const before = Date.now();
    const outcome = unwrap(await trigger());

    // The returned pull_request row.
    expect(outcome.pullRequest.installationId).toBe(CTX.installationId);
    expect(outcome.pullRequest.repoId).toBe(REPO_ID);
    expect(outcome.pullRequest.prNumber).toBe(7);
    expect(outcome.pullRequest.title).toBe("feat: add widgets");
    expect(outcome.pullRequest.state).toBe(PrStates.OPEN);

    // The returned generation row: kind brief, queued, baseline null.
    const generation = expectGeneration(outcome);
    expect(generation.pullRequestId).toBe(outcome.pullRequest.id);
    expect(generation.kind).toBe(GenerationKinds.BRIEF);
    expect(generation.status).toBe(GenerationStatuses.QUEUED);
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
    expect(job["job_key"]).toBe(`generate:${outcome.pullRequest.id}`);
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

  it("redelivery increments attempts and defers one existing job", async () => {
    const first = unwrap(await trigger());
    const firstJobs = await harness.raw(
      "select run_at from graphile_worker.jobs",
    );
    const firstRunAt = epochMs(firstJobs[0]?.["run_at"]);

    // Let the clock move so the replaced run_at is strictly later.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = unwrap(await trigger());

    // Same aggregate root, projection re-queued with attempts bumped.
    expect(second.pullRequest.id).toBe(first.pullRequest.id);
    expect(expectGeneration(second).id).toBe(expectGeneration(first).id);
    expect(expectGeneration(second).attempts).toBe(1);
    expect(expectGeneration(second).status).toBe(GenerationStatuses.QUEUED);

    const prs = await harness.raw("select id from pull_request");
    const generations = await harness.raw("select id from generation");
    const jobs = await harness.raw(
      "select job_key, run_at from graphile_worker.jobs",
    );
    expect(prs).toHaveLength(1);
    expect(generations).toHaveLength(1);
    expect(jobs).toHaveLength(1);

    // job_key replace = trailing debounce: the single job's run_at advanced.
    expect(jobs[0]?.["job_key"]).toBe(`generate:${first.pullRequest.id}`);
    expect(epochMs(jobs[0]?.["run_at"])).toBeGreaterThan(firstRunAt);
  });

  it("rejects stale non-reopen triggers for closed PRs without enqueueing", async () => {
    unwrap(await trigger());
    const jobsBefore = await harness.raw(
      "select run_at from graphile_worker.jobs",
    );
    await closePr();

    // A redelivered synchronize / a review on the now-closed PR: writes
    // state:open too, but must leave the terminal lifecycle intact AND queue
    // nothing (no forever-queued generation row, no dead job).
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
      const row = await createIngestRoutines(harness.handle, CTX).recordState({
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

    it("preserves terminal lifecycle without resurrecting closed PRs", async () => {
      unwrap(await trigger());
      await closePr();

      const row = await createIngestRoutines(harness.handle, CTX).recordState({
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

  describe("regeneration debounce", () => {
    /** Mark the PR's stored brief generation(s) succeeded, out-of-band. */
    async function markSucceeded(): Promise<void> {
      await harness.raw("update generation set status = 'succeeded'");
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

    it("keeps the normal window while the prior generation is only queued", async () => {
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
