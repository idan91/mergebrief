// The transactional ingest seam (stage 4): PR upsert + queued generation
// projection + debounced graphile `generate` job, atomically. Runs on the
// PGlite harness because it provides the `graphile_worker` stub the enqueue
// step calls by name.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IngestOutcome } from "../src/ingest";
import { ingestRoutines } from "../src/ingest";
import { forTenant, parseTenantContext } from "../src/tenant";
import { createPgliteHarness, type PgliteHarness } from "../src/testing";
import {
  GenerationKind,
  GenerationStatus,
  isRepoId,
  PrState,
  type Result,
} from "../src/types";
import { brandWith } from "./helpers";

const CTX = parseTenantContext({ installationId: 100n });
const REPO_ID = brandWith(isRepoId, 200n);
const HEAD_SHA = "ec26c3e57ca3a959ca5aad62de7213c562f8c821";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
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

describe("ingestRoutines.triggerGeneration", () => {
  let harness: PgliteHarness;

  beforeEach(async () => {
    harness = await createPgliteHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function trigger(overrides?: {
    debounceSeconds?: number;
    reopen?: boolean;
  }): Promise<Result<IngestOutcome, { code: string; message: string }>> {
    return ingestRoutines(harness.handle, CTX).triggerGeneration({
      pullRequest: {
        repoId: REPO_ID,
        prNumber: 7,
        repoSlug: "acme/widgets",
        state: PrState.OPEN,
      },
      headSha: HEAD_SHA,
      ...(overrides?.debounceSeconds === undefined
        ? {}
        : { debounceSeconds: overrides.debounceSeconds }),
      ...(overrides?.reopen === undefined ? {} : { reopen: overrides.reopen }),
    });
  }

  /** Close the PR out-of-band, as the `pull_request.closed` handler would. */
  async function closePr(): Promise<void> {
    await forTenant(harness.handle, CTX).pullRequests.upsert({
      repoId: REPO_ID,
      prNumber: 7,
      repoSlug: "acme/widgets",
      state: PrState.CLOSED,
      closedAt: new Date(),
      purgeAfter: null,
    });
  }

  it("writes the PR row, the queued generation row, and the debounced job atomically", async () => {
    const before = Date.now();
    const outcome = unwrap(await trigger());

    // The returned pull_request row.
    expect(outcome.pullRequest.installationId).toBe(CTX.installationId);
    expect(outcome.pullRequest.repoId).toBe(REPO_ID);
    expect(outcome.pullRequest.prNumber).toBe(7);
    expect(outcome.pullRequest.state).toBe(PrState.OPEN);

    // The returned generation row: kind brief, queued, baseline null.
    expect(outcome.generation.pullRequestId).toBe(outcome.pullRequest.id);
    expect(outcome.generation.kind).toBe(GenerationKind.BRIEF);
    expect(outcome.generation.status).toBe(GenerationStatus.QUEUED);
    expect(outcome.generation.headSha).toBe(HEAD_SHA);
    expect(outcome.generation.baselineSha).toBeNull();
    expect(outcome.generation.attempts).toBe(0);

    // All three rows landed.
    const prs = await harness.raw("select * from pull_request");
    const generations = await harness.raw("select * from generation");
    const jobs = await harness.raw("select * from graphile_worker.jobs");
    expect(prs).toHaveLength(1);
    expect(generations).toHaveLength(1);
    expect(jobs).toHaveLength(1);

    // The job: task, key, payload (STRING ids — JSON can't carry bigint),
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

  it("is idempotent on redelivery: same PR row, attempts++, ONE job with a pushed run_at", async () => {
    const first = unwrap(await trigger());
    const firstJobs = await harness.raw("select run_at from graphile_worker.jobs");
    const firstRunAt = epochMs(firstJobs[0]?.["run_at"]);

    // Let the clock move so the replaced run_at is strictly later.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = unwrap(await trigger());

    // Same aggregate root, projection re-queued with attempts bumped.
    expect(second.pullRequest.id).toBe(first.pullRequest.id);
    expect(second.generation.id).toBe(first.generation.id);
    expect(second.generation.attempts).toBe(1);
    expect(second.generation.status).toBe(GenerationStatus.QUEUED);

    const prs = await harness.raw("select id from pull_request");
    const generations = await harness.raw("select id from generation");
    const jobs = await harness.raw("select job_key, run_at from graphile_worker.jobs");
    expect(prs).toHaveLength(1);
    expect(generations).toHaveLength(1);
    expect(jobs).toHaveLength(1);

    // job_key replace = trailing debounce: the single job's run_at advanced.
    expect(jobs[0]?.["job_key"]).toBe(`generate:${first.pullRequest.id}`);
    expect(epochMs(jobs[0]?.["run_at"])).toBeGreaterThan(firstRunAt);
  });

  it("does NOT resurrect a closed PR on a stale (non-reopen) trigger", async () => {
    unwrap(await trigger());
    await closePr();

    // A redelivered synchronize / a review on the now-closed PR: writes
    // state:open too, but must leave the terminal lifecycle intact.
    const outcome = unwrap(await trigger());
    expect(outcome.pullRequest.state).toBe(PrState.CLOSED);
    expect(outcome.pullRequest.closedAt).not.toBeNull();

    const prs = await harness.raw("select state, closed_at from pull_request");
    expect(prs).toHaveLength(1);
    expect(prs[0]?.["state"]).toBe(PrState.CLOSED);
    expect(prs[0]?.["closed_at"]).not.toBeNull();
  });

  it("transitions a closed PR back to open on an explicit reopen", async () => {
    unwrap(await trigger());
    await closePr();

    const outcome = unwrap(await trigger({ reopen: true }));
    expect(outcome.pullRequest.state).toBe(PrState.OPEN);
    expect(outcome.pullRequest.closedAt).toBeNull();
    expect(outcome.pullRequest.purgeAfter).toBeNull();
  });

  it("rolls the whole transaction back when the enqueue fails (atomicity)", async () => {
    await harness.raw(
      "drop function graphile_worker.add_job(text, json, text, timestamptz, text)",
    );

    await expect(trigger()).rejects.toThrow(/add_job/);

    expect(await harness.raw("select id from pull_request")).toHaveLength(0);
    expect(await harness.raw("select id from generation")).toHaveLength(0);
  });

  it("rejects an invalid debounce as an expected Result error, writing nothing", async () => {
    const result = await trigger({ debounceSeconds: -1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an error result");
    expect(result.error.code).toBe("invalid-debounce");
    expect(await harness.raw("select id from pull_request")).toHaveLength(0);
  });
});
