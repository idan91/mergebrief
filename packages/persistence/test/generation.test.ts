// Generation-projection tests (PGlite): the pending→running→succeeded
// transitions with attempts maintenance, and the
// NULLS-NOT-DISTINCT proof: a brief-kind re-push (null baseline_sha) conflicts
// on the natural key rather than inserting a second row.
import { describe, expect, it, onTestFinished } from "vitest";
import {
  createTenantRepository,
  createGenerationProjection,
  GenerationErrorCodes,
  createIngestRoutines,
  ScopeViolationError,
  type TenantContext,
} from "../src/index";
import {
  GenerationFailureCodes,
  GenerationPhases,
  GenerationStatuses,
} from "types/generations";
import { PrStates } from "types/pull-requests";
import {
  GenerationKinds,
  isInstallationId,
  isRepoId,
  type InstallationId,
  type RepoId,
} from "../src/types";
import {
  claimTestRun,
  createPgliteHarness,
  succeedTestRun,
} from "../src/testing";
import { drizzle } from "drizzle-orm/pglite";
import { fromDrizzle } from "../src/db/handle";
import {
  brandWith,
  freshDatabase,
  freshPglite,
  makeBriefTarget,
  readCheckValues,
  writeGenerationUpdatedAt,
} from "./helpers";

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };
const STALE_WRITTEN_AT = new Date("2026-01-01T00:00:00Z");
const SUCCEEDED_AT = new Date("2026-01-01T00:01:00Z");

describe("createGenerationProjection status transitions", () => {
  it("pending → running → succeeded, attempts stable, one row", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const target = {
      pullRequestId: pr.id,
      kind: GenerationKinds.DELTA,
      headSha: "head",
      baselineSha: "checkpoint",
    };

    const pending = await gen.upsertPending(target);
    expect(pending.status).toBe(GenerationStatuses.PENDING);
    expect(pending.attempts).toBe(0);

    const runId = await claimTestRun(gen, target, {
      phase: GenerationPhases.GENERATING,
    });
    const running = await gen.get(target);
    expect(running?.status).toBe(GenerationStatuses.RUNNING);
    expect(running?.phase).toBe(GenerationPhases.GENERATING);

    const done = await gen.finishRun(target, runId, {
      status: GenerationStatuses.SUCCEEDED,
    });
    if (!done.ok) {
      throw new Error("finishRun failed");
    }
    expect(done.value.status).toBe(GenerationStatuses.SUCCEEDED);
    // A terminal row must not advertise the phase it was mid-way through.
    expect(done.value.phase).toBeNull();
    expect(done.value.attempts).toBe(0);
    expect(done.value.id).toBe(pending.id); // one row throughout
  });

  it("re-queue increments attempts and resets phase/error", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKinds.DELTA,
      headSha: "head",
      baselineSha: "checkpoint",
    };

    const first = await gen.upsertPending(target);
    await gen.markFailed(target, {
      code: GenerationFailureCodes.UNKNOWN,
      params: { detail: "boom" },
    });
    const second = await gen.upsertPending(target);

    expect(second.id).toBe(first.id);
    expect(second.attempts).toBe(1);
    expect(second.status).toBe(GenerationStatuses.PENDING);
    expect(second.errorCode).toBeNull();
    expect(second.errorParams).toBeNull();
  });

  it("a null baseline_sha upsert conflicts, proving NULLS NOT DISTINCT", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head",
      baselineSha: null,
    };

    const first = await gen.upsertPending(target);
    const second = await gen.upsertPending(target);

    // Without NULLS NOT DISTINCT these would be two rows; here it is one.
    expect(second.id).toBe(first.id);
    expect(second.attempts).toBe(1);
    expect(await gen.get(target)).toBeDefined();
  });

  it("rejects upsertPending whose pull_request is in another tenant", async () => {
    const handle = await freshDatabase();
    const b = createTenantRepository(handle, CTX_B);
    const genA = createGenerationProjection(handle, CTX_A);
    const bPr = await b.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    await expect(
      genA.upsertPending({
        pullRequestId: bPr.id,
        kind: GenerationKinds.BRIEF,
        headSha: "head",
        baselineSha: null,
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(
      await genA.get({
        pullRequestId: bPr.id,
        kind: GenerationKinds.BRIEF,
        headSha: "head",
        baselineSha: null,
      }),
    ).toBeUndefined();
  });

  it("markFailed stores the typed code and sanitizes the detail param", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head",
      baselineSha: null,
    };
    await gen.upsertPending(target);

    const raw = [
      "connect ECONNREFUSED postgres://user:pass@host/db retrying",
      "    at TCPConnectWrap.afterConnect (node:net:1494:16)",
      "    at processTicksAndRejections (node:internal/process/task_queues:82:21)",
    ].join("\n");
    const failed = await gen.markFailed(target, {
      code: GenerationFailureCodes.UNKNOWN,
      params: { detail: raw },
    });

    if (!failed.ok) {
      throw new Error("markFailed failed");
    }
    expect(failed.value.errorCode).toBe(GenerationFailureCodes.UNKNOWN);
    const stored = failed.value.errorParams?.detail;
    expect(stored).toBe("connect ECONNREFUSED [redacted-url] retrying");
    expect(stored).not.toContain("\n"); // one line, stack trace dropped
    expect(stored).not.toContain("pass"); // credentials gone
    expect(stored).not.toContain("postgres://");
    expect((stored ?? "").length).toBeLessThanOrEqual(300);
  });

  it("markFailed stores a paramless code with null params", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 8,
      state: PrStates.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-8",
      baselineSha: null,
    };
    await gen.upsertPending(target);
    const failed = await gen.markFailed(target, {
      code: GenerationFailureCodes.PROVIDER_RATE_LIMIT,
    });
    if (!failed.ok) {
      throw new Error("markFailed failed");
    }
    expect(failed.value.errorCode).toBe(
      GenerationFailureCodes.PROVIDER_RATE_LIMIT,
    );
    expect(failed.value.errorParams).toBeNull();
  });

  it("drops an empty sanitized detail to null params", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 10,
      state: PrStates.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-10",
      baselineSha: null,
    };
    await gen.upsertPending(target);
    const failed = await gen.markFailed(target, {
      code: GenerationFailureCodes.UNKNOWN,
      params: { detail: "\nreal message on line two" },
    });
    if (!failed.ok) {
      throw new Error("markFailed failed");
    }
    expect(failed.value.errorCode).toBe(GenerationFailureCodes.UNKNOWN);
    expect(failed.value.errorParams).toBeNull();
  });

  it("the CHECK constraint rejects a code outside the vocabulary", async () => {
    const client = await freshPglite();
    const handle = fromDrizzle(drizzle(client));
    const repo = createTenantRepository(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 9,
      state: PrStates.OPEN,
    });
    await expect(
      client.query(
        `insert into generation (installation_id, pull_request_id, kind, head_sha, status, error_code)
         values (${String(CTX_A.installationId)}, ${String(pr.id)}, 'brief', 'head-9', 'failed', 'not-a-code')`,
      ),
    ).rejects.toThrow(/generation_error_code_check/);
  });

  it("the CHECK constraint accepts exactly the failure vocabulary", async () => {
    const client = await freshPglite();

    const accepted = await readCheckValues(
      client,
      "generation_error_code_check",
    );

    expect(accepted.toSorted()).toEqual(
      Object.values(GenerationFailureCodes).toSorted(),
    );
  });

  it("markSuperseded is terminal, leaves attempts, clears error", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKinds.DELTA,
      headSha: "head",
      baselineSha: "checkpoint",
    };

    await gen.upsertPending(target);
    // A prior failure sets attempts/error; supersession must not disturb either.
    const second = await gen.upsertPending(target); // attempts → 1 (already ran once)
    // A mid-run abort of a run whose lease lapsed: the phase is set.
    await claimTestRun(gen, target, {
      phase: GenerationPhases.GENERATING,
      leaseMs: 0,
    });
    await gen.markFailed(target, {
      code: GenerationFailureCodes.UNKNOWN,
      params: { detail: "boom" },
    });
    const attemptsBefore = second.attempts;

    const superseded = await gen.markSuperseded(target);
    if (!superseded.ok) {
      throw new Error("markSuperseded failed");
    }
    expect(superseded.value.status).toBe(GenerationStatuses.SUPERSEDED);
    // An abort is NOT a failure: attempts untouched, error cleared, and the
    // mid-run phase must not survive into the terminal row.
    expect(superseded.value.attempts).toBe(attemptsBefore);
    expect(superseded.value.errorCode).toBeNull();
    expect(superseded.value.errorParams).toBeNull();
    expect(superseded.value.phase).toBeNull();
  });

  it("supersedeStaleBriefs terminalizes stale briefs and clears the phase", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });
    const stale = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "old-head",
      baselineSha: null,
    } as const;
    const current = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "new-head",
      baselineSha: null,
    } as const;

    await gen.upsertPending(stale);
    // The sweep catches it mid-run, its holder's lease lapsed.
    await claimTestRun(gen, stale, {
      phase: GenerationPhases.GENERATING,
      leaseMs: 0,
    });
    await gen.upsertPending(current);
    await succeedTestRun(gen, current);

    const swept = await gen.supersedeStaleBriefs(pr.id, "new-head", new Date());
    expect(swept).toBe(1);
    const staleRow = await gen.get(stale);
    expect(staleRow?.status).toBe(GenerationStatuses.SUPERSEDED);
    expect(staleRow?.phase).toBeNull();
    expect(staleRow?.errorCode).toBeNull();
    // The current head's row is untouched.
    expect((await gen.get(current))?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("a swept stale brief never shadows the current head", async () => {
    // Live repro from two rapid pushes: the
    // old head's pending row is swept AFTER the new head succeeds, stamping
    // the STALE row with the newest updated_at. "Latest" must still be the
    // current head, or PR-meta reports superseded forever and the wait UX
    // spins on a push that will never finish.
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });
    const stale = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "old-head",
      baselineSha: null,
    } as const;
    const current = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "new-head",
      baselineSha: null,
    } as const;

    await gen.upsertPending(stale);
    await gen.upsertPending(current);
    await succeedTestRun(gen, current);
    // Both rows predate the pickup, so the sweep's write is the newest.
    await writeGenerationUpdatedAt(handle, stale, STALE_WRITTEN_AT);
    await writeGenerationUpdatedAt(handle, current, SUCCEEDED_AT);
    const pickedUpAt = new Date();
    expect(await gen.supersedeStaleBriefs(pr.id, "new-head", pickedUpAt)).toBe(
      1,
    );

    const latest = (await gen.latestBriefForPullRequests([pr.id])).get(pr.id);
    expect(latest?.headSha).toBe("new-head");
    expect(latest?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("listBriefsForPullRequest returns tenant-scoped brief rows only", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const briefA = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-a",
      baselineSha: null,
    };
    const briefB = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-b",
      baselineSha: null,
    };
    const delta = {
      pullRequestId: pr.id,
      kind: GenerationKinds.DELTA,
      headSha: "head-b",
      baselineSha: "head-a",
    };
    const first = await gen.upsertPending(briefA);
    await gen.upsertPending(briefB);
    await gen.upsertPending(delta);
    // Re-queue of head-a: same row, created_at must stay the first enqueue.
    await gen.upsertPending(briefA);

    const rows = await gen.listBriefsForPullRequest(pr.id);
    expect(rows.map((row) => row.headSha)).toEqual(["head-a", "head-b"]);
    const rowA = rows.find((row) => row.headSha === "head-a");
    expect(rowA?.createdAt.getTime()).toBe(first.createdAt.getTime());

    // Another tenant sees nothing.
    expect(
      await createGenerationProjection(handle, CTX_B).listBriefsForPullRequest(
        pr.id,
      ),
    ).toEqual([]);
  });

  it("a transition on a missing projection row returns notFound", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const result = await gen.markSuperseded({
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "never-projected",
      baselineSha: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected notFound");
    }
    expect(result.error.code).toBe(GenerationErrorCodes.NOT_FOUND);
  });
});

describe("supersedeStaleBriefs against the pickup time", () => {
  const PICKED_UP_AT = new Date("2026-03-01T12:00:00.000Z");
  const BEFORE_PICKUP = new Date(PICKED_UP_AT.getTime() - 1_000);
  const AFTER_PICKUP = new Date(PICKED_UP_AT.getTime() + 1);
  const HEAD_A = "head-a";
  const HEAD_B = "head-b";

  async function seedSweepWorld() {
    const harness = await createPgliteHarness();
    onTestFinished(() => harness.close());
    const repo = createTenantRepository(harness.handle, CTX_A);
    const gen = createGenerationProjection(harness.handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    async function stampUpdatedAt(headSha: string, at: Date): Promise<void> {
      await harness.raw(
        "update generation set updated_at = $1 where pull_request_id = $2 and head_sha = $3",
        [at.toISOString(), pr.id, headSha],
      );
    }

    return {
      gen,
      pr,
      stampUpdatedAt,
      headA: makeBriefTarget(pr.id, HEAD_A),
      headB: makeBriefTarget(pr.id, HEAD_B),
    };
  }

  it("the sweep leaves a head triggered after the run was picked up", async () => {
    const { gen, pr, stampUpdatedAt, headA, headB } = await seedSweepWorld();
    await gen.upsertPending(headA);
    await succeedTestRun(gen, headA);
    await gen.upsertPending(headB);
    await stampUpdatedAt(HEAD_B, AFTER_PICKUP);

    const swept = await gen.supersedeStaleBriefs(pr.id, HEAD_A, PICKED_UP_AT);

    expect(swept).toBe(0);
    expect((await gen.get(headB))?.status).toBe(GenerationStatuses.PENDING);
  });

  it("the sweep takes a re-triggered older head's replaced successor", async () => {
    const { gen, pr, stampUpdatedAt, headA, headB } = await seedSweepWorld();
    const first = await gen.upsertPending(headA);
    await gen.markSuperseded(headA);
    const successor = await gen.upsertPending(headB);
    await stampUpdatedAt(HEAD_B, BEFORE_PICKUP);
    const retriggered = await gen.upsertPending(headA);
    await succeedTestRun(gen, headA);
    expect(retriggered.id).toBe(first.id);
    expect(successor.id).toBeGreaterThan(retriggered.id);

    const swept = await gen.supersedeStaleBriefs(pr.id, HEAD_A, PICKED_UP_AT);

    expect(swept).toBe(1);
    expect((await gen.get(headB))?.status).toBe(GenerationStatuses.SUPERSEDED);
  });

  it("the sweep leaves a newer head that is already running", async () => {
    const { gen, pr, stampUpdatedAt, headA, headB } = await seedSweepWorld();
    await gen.upsertPending(headA);
    await succeedTestRun(gen, headA);
    await gen.upsertPending(headB);
    await claimTestRun(gen, headB, { phase: GenerationPhases.GENERATING });
    await stampUpdatedAt(HEAD_B, AFTER_PICKUP);

    const swept = await gen.supersedeStaleBriefs(pr.id, HEAD_A, PICKED_UP_AT);

    expect(swept).toBe(0);
    const running = await gen.get(headB);
    expect(running?.status).toBe(GenerationStatuses.RUNNING);
    expect(running?.phase).toBe(GenerationPhases.GENERATING);
  });

  it("the sweep takes a row updated exactly at the pickup time", async () => {
    const { gen, pr, stampUpdatedAt, headA, headB } = await seedSweepWorld();
    await gen.upsertPending(headA);
    await succeedTestRun(gen, headA);
    await gen.upsertPending(headB);
    await stampUpdatedAt(HEAD_B, PICKED_UP_AT);

    const swept = await gen.supersedeStaleBriefs(pr.id, HEAD_A, PICKED_UP_AT);

    expect(swept).toBe(1);
    expect((await gen.get(headB))?.status).toBe(GenerationStatuses.SUPERSEDED);
  });
});

describe("repo-config origin on the generation row", () => {
  it("recordRepoConfig round-trips; a re-queue through ingest clears it", async () => {
    // PGlite harness: the ingest enqueue needs the graphile_worker stub.
    const harness = await createPgliteHarness();
    onTestFinished(() => harness.close());
    const handle = harness.handle;
    const ctx: TenantContext = {
      installationId: brandWith(isInstallationId, 4200n),
    };
    const ingest = createIngestRoutines(handle, ctx);
    const first = await ingest.triggerGeneration({
      pullRequest: {
        repoId: brandWith(isRepoId, 900n),
        prNumber: 3,
        state: PrStates.OPEN,
      },
      headSha: "h1",
      debounceSeconds: 0,
    });
    const projection = createGenerationProjection(handle, ctx);
    const target = {
      pullRequestId: first.pullRequest.id,
      kind: GenerationKinds.BRIEF,
      headSha: "h1",
      baselineSha: null,
    } as const;

    const runId = await claimTestRun(projection, target);
    const stamped = await projection.recordRepoConfig(
      target,
      runId,
      '{"files":[],"collisions":[]}',
    );
    expect((await projection.releaseClaim(target, runId)).ok).toBe(true);
    expect(stamped.ok).toBe(true);
    expect((await projection.get(target))?.repoConfig).toBe(
      '{"files":[],"collisions":[]}',
    );

    // Re-queue via the PRODUCTION ingest path (not the projection helper):
    // stale origin data must not survive into the fresh attempt.
    await ingest.triggerGeneration({
      pullRequest: {
        repoId: brandWith(isRepoId, 900n),
        prNumber: 3,
        state: PrStates.OPEN,
      },
      headSha: "h1",
      debounceSeconds: 0,
    });
    expect((await projection.get(target))?.repoConfig).toBeNull();
  });
});

describe("getGenerateJobTiming", () => {
  const DEBOUNCE_SECONDS = 60;

  async function triggerWithDebounce(debounceSeconds: number) {
    const harness = await createPgliteHarness();
    onTestFinished(() => harness.close());
    const ingest = createIngestRoutines(harness.handle, CTX_A);
    const triggered = await ingest.triggerGeneration({
      pullRequest: { repoId: REPO, prNumber: 11, state: PrStates.OPEN },
      headSha: "h1",
      debounceSeconds,
    });
    return { harness, pullRequestId: triggered.pullRequest.id };
  }

  it("reports a job whose start time is still ahead", async () => {
    const { harness, pullRequestId } =
      await triggerWithDebounce(DEBOUNCE_SECONDS);
    const projection = createGenerationProjection(harness.handle, CTX_A);

    expect(await projection.getGenerateJobTiming(pullRequestId)).toEqual({
      startsLater: true,
      locked: false,
    });
  });

  it("reports a due job no worker has claimed", async () => {
    const { harness, pullRequestId } = await triggerWithDebounce(0);
    const projection = createGenerationProjection(harness.handle, CTX_A);

    expect(await projection.getGenerateJobTiming(pullRequestId)).toEqual({
      startsLater: false,
      locked: false,
    });
  });

  it("reports a job a worker holds", async () => {
    const { harness, pullRequestId } = await triggerWithDebounce(0);
    await harness.raw("update graphile_worker.jobs set locked_at = now()");
    const projection = createGenerationProjection(harness.handle, CTX_A);

    expect(await projection.getGenerateJobTiming(pullRequestId)).toEqual({
      startsLater: false,
      locked: true,
    });
  });

  it("returns undefined when the queue holds no job for the PR", async () => {
    const { harness, pullRequestId } = await triggerWithDebounce(0);
    await harness.raw("truncate graphile_worker.jobs");
    const projection = createGenerationProjection(harness.handle, CTX_A);

    const timing = await projection.getGenerateJobTiming(pullRequestId);

    expect(timing).toBeUndefined();
  });

  it("returns undefined for a PR outside the caller's tenant", async () => {
    const { harness, pullRequestId } =
      await triggerWithDebounce(DEBOUNCE_SECONDS);
    const projection = createGenerationProjection(harness.handle, CTX_B);

    const timing = await projection.getGenerateJobTiming(pullRequestId);

    expect(timing).toBeUndefined();
  });
});
