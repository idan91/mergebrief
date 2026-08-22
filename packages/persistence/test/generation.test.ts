// Generation-projection tests (PGlite): the queued→running→succeeded
// transitions with attempts/updated_at maintenance, and the
// NULLS-NOT-DISTINCT proof: a brief-kind re-queue (null baseline_sha) conflicts
// on the natural key rather than inserting a second row.
import { describe, expect, it, onTestFinished } from "vitest";
import {
  createTenantRepository,
  createGenerationProjection,
  GenerationErrorCode,
  createIngestRoutines,
  GenerationFailureCode,
  type TenantContext,
} from "../src/index";
import {
  GenerationKind,
  GenerationPhase,
  GenerationStatus,
  isInstallationId,
  isRepoId,
  PrState,
  type InstallationId,
  type RepoId,
} from "../src/types";
import { createPgliteHarness } from "../src/testing";
import { drizzle } from "drizzle-orm/pglite";
import { fromDrizzle } from "../src/db/handle";
import * as schema from "../src/schema/index";
import { brandWith, freshDatabase, freshPglite } from "./helpers";

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };

describe("createGenerationProjection — status transitions", () => {
  it("queued → running → succeeded, attempts stable, updated_at advances", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrState.OPEN,
    });

    const target = {
      pullRequestId: pr.id,
      kind: GenerationKind.DELTA,
      headSha: "head",
      baselineSha: "checkpoint",
    };

    const queued = await gen.upsertQueued(target);
    expect(queued.ok).toBe(true);
    if (!queued.ok) throw new Error("queue failed");
    expect(queued.value.status).toBe(GenerationStatus.QUEUED);
    expect(queued.value.attempts).toBe(0);

    const running = await gen.markRunning(target, GenerationPhase.GENERATING);
    if (!running.ok) throw new Error("markRunning failed");
    expect(running.value.status).toBe(GenerationStatus.RUNNING);
    expect(running.value.phase).toBe(GenerationPhase.GENERATING);
    expect(running.value.updatedAt.getTime()).toBeGreaterThanOrEqual(
      queued.value.updatedAt.getTime(),
    );

    const done = await gen.markSucceeded(target);
    if (!done.ok) throw new Error("markSucceeded failed");
    expect(done.value.status).toBe(GenerationStatus.SUCCEEDED);
    // A terminal row must not advertise the phase it was mid-way through.
    expect(done.value.phase).toBeNull();
    expect(done.value.id).toBe(queued.value.id); // one row throughout
  });

  it("re-queue increments attempts and resets phase/error", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrState.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKind.DELTA,
      headSha: "head",
      baselineSha: "checkpoint",
    };

    const first = await gen.upsertQueued(target);
    await gen.markFailed(target, {
      code: GenerationFailureCode.UNKNOWN,
      params: { detail: "boom" },
    });
    const requeued = await gen.upsertQueued(target);

    if (!first.ok || !requeued.ok) throw new Error("queue failed");
    expect(requeued.value.id).toBe(first.value.id);
    expect(requeued.value.attempts).toBe(1);
    expect(requeued.value.status).toBe(GenerationStatus.QUEUED);
    expect(requeued.value.errorCode).toBeNull();
    expect(requeued.value.errorParams).toBeNull();
  });

  it("brief-kind (null baseline_sha) upsert conflicts — NULLS NOT DISTINCT proof", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrState.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKind.BRIEF,
      headSha: "head",
      baselineSha: null,
    };

    const first = await gen.upsertQueued(target);
    const second = await gen.upsertQueued(target);

    if (!first.ok || !second.ok) throw new Error("queue failed");
    // Without NULLS NOT DISTINCT these would be two rows; here it is one.
    expect(second.value.id).toBe(first.value.id);
    expect(second.value.attempts).toBe(1);
    expect(await gen.get(target)).toBeDefined();
  });

  it("rejects upsertQueued whose pull_request is in another tenant", async () => {
    const handle = await freshDatabase();
    const b = createTenantRepository(handle, CTX_B);
    const genA = createGenerationProjection(handle, CTX_A);
    const bPr = await b.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrState.OPEN,
    });

    const result = await genA.upsertQueued({
      pullRequestId: bPr.id,
      kind: GenerationKind.BRIEF,
      headSha: "head",
      baselineSha: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error.code).toBe(GenerationErrorCode.PARENT_NOT_IN_TENANT);
  });

  it("markFailed stores the typed code and sanitizes the detail param", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrState.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKind.BRIEF,
      headSha: "head",
      baselineSha: null,
    };
    await gen.upsertQueued(target);

    const raw = [
      "connect ECONNREFUSED postgres://user:pass@host/db retrying",
      "    at TCPConnectWrap.afterConnect (node:net:1494:16)",
      "    at processTicksAndRejections (node:internal/process/task_queues:82:21)",
    ].join("\n");
    const failed = await gen.markFailed(target, {
      code: GenerationFailureCode.UNKNOWN,
      params: { detail: raw },
    });

    if (!failed.ok) throw new Error("markFailed failed");
    expect(failed.value.errorCode).toBe(GenerationFailureCode.UNKNOWN);
    const stored = failed.value.errorParams?.detail;
    expect(stored).toBe("connect ECONNREFUSED [redacted-url] retrying");
    expect(stored).not.toContain("\n"); // one line — stack trace dropped
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
      state: PrState.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKind.BRIEF,
      headSha: "head-8",
      baselineSha: null,
    };
    await gen.upsertQueued(target);
    const failed = await gen.markFailed(target, {
      code: GenerationFailureCode.PROVIDER_RATE_LIMIT,
    });
    if (!failed.ok) throw new Error("markFailed failed");
    expect(failed.value.errorCode).toBe(
      GenerationFailureCode.PROVIDER_RATE_LIMIT,
    );
    expect(failed.value.errorParams).toBeNull();
  });

  it("drops an empty sanitized detail to null params — readers fall back to the code", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 10,
      state: PrState.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKind.BRIEF,
      headSha: "head-10",
      baselineSha: null,
    };
    await gen.upsertQueued(target);
    const failed = await gen.markFailed(target, {
      code: GenerationFailureCode.UNKNOWN,
      params: { detail: "\nreal message on line two" },
    });
    if (!failed.ok) throw new Error("markFailed failed");
    expect(failed.value.errorCode).toBe(GenerationFailureCode.UNKNOWN);
    expect(failed.value.errorParams).toBeNull();
  });

  it("the CHECK constraint rejects a code outside the vocabulary", async () => {
    const client = await freshPglite();
    const handle = fromDrizzle(drizzle(client, { schema }));
    const repo = createTenantRepository(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 9,
      state: PrState.OPEN,
    });
    await expect(
      client.query(
        `insert into generation (installation_id, pull_request_id, kind, head_sha, status, error_code)
         values (${String(CTX_A.installationId)}, ${String(pr.id)}, 'brief', 'head-9', 'failed', 'not-a-code')`,
      ),
    ).rejects.toThrow(/generation_error_code_check/);
  });

  it("markSuperseded is terminal, leaves attempts, clears error", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrState.OPEN,
    });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKind.DELTA,
      headSha: "head",
      baselineSha: "checkpoint",
    };

    await gen.upsertQueued(target);
    // A prior failure sets attempts/error; supersession must not disturb either.
    const requeued = await gen.upsertQueued(target); // attempts → 1 (already ran once)
    await gen.markRunning(target, GenerationPhase.GENERATING); // mid-run abort — phase is set
    await gen.markFailed(target, {
      code: GenerationFailureCode.UNKNOWN,
      params: { detail: "boom" },
    });
    if (!requeued.ok) throw new Error("requeue failed");
    const attemptsBefore = requeued.value.attempts;

    const superseded = await gen.markSuperseded(target);
    if (!superseded.ok) throw new Error("markSuperseded failed");
    expect(superseded.value.status).toBe(GenerationStatus.SUPERSEDED);
    // An abort is NOT a failure: attempts untouched, error cleared — and the
    // mid-run phase must not survive into the terminal row.
    expect(superseded.value.attempts).toBe(attemptsBefore);
    expect(superseded.value.errorCode).toBeNull();
    expect(superseded.value.errorParams).toBeNull();
    expect(superseded.value.phase).toBeNull();
  });

  it("supersedeStaleBriefs terminalizes stale non-terminal briefs and clears their phase", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrState.OPEN,
    });
    const stale = {
      pullRequestId: pr.id,
      kind: GenerationKind.BRIEF,
      headSha: "old-head",
      baselineSha: null,
    } as const;
    const current = {
      pullRequestId: pr.id,
      kind: GenerationKind.BRIEF,
      headSha: "new-head",
      baselineSha: null,
    } as const;

    await gen.upsertQueued(stale);
    await gen.markRunning(stale, GenerationPhase.GENERATING); // sweep catches it mid-run
    await gen.upsertQueued(current);
    await gen.markSucceeded(current);

    const swept = await gen.supersedeStaleBriefs(pr.id, "new-head");
    expect(swept).toBe(1);
    const staleRow = await gen.get(stale);
    expect(staleRow?.status).toBe(GenerationStatus.SUPERSEDED);
    expect(staleRow?.phase).toBeNull();
    expect(staleRow?.errorCode).toBeNull();
    // The current head's row is untouched.
    expect((await gen.get(current))?.status).toBe(GenerationStatus.SUCCEEDED);
  });

  it("a swept stale brief never shadows the current head in latestBriefForPullRequests", async () => {
    // Live repro (Idan91/components#5, 2026-07-06): two rapid pushes — the
    // old head's queued row is swept AFTER the new head succeeds, stamping
    // the STALE row with the newest updated_at. "Latest" must still be the
    // current head, or PR-meta reports superseded forever and the wait UX
    // spins on a push that will never finish.
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrState.OPEN,
    });
    const stale = {
      pullRequestId: pr.id,
      kind: GenerationKind.BRIEF,
      headSha: "old-head",
      baselineSha: null,
    } as const;
    const current = {
      pullRequestId: pr.id,
      kind: GenerationKind.BRIEF,
      headSha: "new-head",
      baselineSha: null,
    } as const;

    await gen.upsertQueued(stale);
    await gen.upsertQueued(current);
    await gen.markRunning(current, GenerationPhase.GENERATING);
    await gen.markSucceeded(current);
    // The sweep's updated_at must be strictly newer than the success's.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await gen.supersedeStaleBriefs(pr.id, "new-head")).toBe(1);

    const latest = (await gen.latestBriefForPullRequests([pr.id])).get(pr.id);
    expect(latest?.headSha).toBe("new-head");
    expect(latest?.status).toBe(GenerationStatus.SUCCEEDED);
  });

  it("listBriefsForPullRequest: brief-kind rows only, tenant-scoped, created_at survives a re-queue", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrState.OPEN,
    });

    const briefA = {
      pullRequestId: pr.id,
      kind: GenerationKind.BRIEF,
      headSha: "head-a",
      baselineSha: null,
    };
    const briefB = {
      pullRequestId: pr.id,
      kind: GenerationKind.BRIEF,
      headSha: "head-b",
      baselineSha: null,
    };
    const delta = {
      pullRequestId: pr.id,
      kind: GenerationKind.DELTA,
      headSha: "head-b",
      baselineSha: "head-a",
    };
    const first = await gen.upsertQueued(briefA);
    if (!first.ok) throw new Error("queue failed");
    await gen.upsertQueued(briefB);
    await gen.upsertQueued(delta);
    // Re-queue of head-a: same row, created_at must stay the first enqueue.
    await gen.upsertQueued(briefA);

    const rows = await gen.listBriefsForPullRequest(pr.id);
    expect(rows.map((row) => row.headSha)).toEqual(["head-a", "head-b"]);
    const rowA = rows.find((row) => row.headSha === "head-a");
    expect(rowA?.createdAt.getTime()).toBe(first.value.createdAt.getTime());

    // Another tenant sees nothing.
    expect(
      await createGenerationProjection(handle, CTX_B).listBriefsForPullRequest(pr.id),
    ).toEqual([]);
  });

  it("a transition on a missing projection row returns notFound", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrState.OPEN,
    });

    const result = await gen.markRunning({
      pullRequestId: pr.id,
      kind: GenerationKind.BRIEF,
      headSha: "never-queued",
      baselineSha: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected notFound");
    expect(result.error.code).toBe(GenerationErrorCode.NOT_FOUND);
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
        state: PrState.OPEN,
      },
      headSha: "h1",
      debounceSeconds: 0,
    });
    if (!first.ok) throw new Error(first.error.message);
    const projection = createGenerationProjection(handle, ctx);
    const target = {
      pullRequestId: first.value.pullRequest.id,
      kind: GenerationKind.BRIEF,
      headSha: "h1",
      baselineSha: null,
    } as const;

    const stamped = await projection.recordRepoConfig(
      target,
      '{"files":[],"collisions":[]}',
    );
    expect(stamped.ok).toBe(true);
    expect((await projection.get(target))?.repoConfig).toBe(
      '{"files":[],"collisions":[]}',
    );

    // Re-queue via the PRODUCTION ingest path (not the projection helper):
    // stale origin data must not survive into the fresh attempt.
    const second = await ingest.triggerGeneration({
      pullRequest: {
        repoId: brandWith(isRepoId, 900n),
        prNumber: 3,
        state: PrState.OPEN,
      },
      headSha: "h1",
      debounceSeconds: 0,
    });
    if (!second.ok) throw new Error(second.error.message);
    expect((await projection.get(target))?.repoConfig).toBeNull();
  });
});
