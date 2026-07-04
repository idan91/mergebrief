// Stage 4 generation-projection tests (PGlite). Prove the D10 transitions
// (queued→running→succeeded) with attempts/updated_at maintenance, and the
// NULLS-NOT-DISTINCT proof: a brief-kind re-queue (null baseline_sha) conflicts
// on the natural key rather than inserting a second row.
import { describe, expect, it } from "vitest";
import {
  forTenant,
  generationProjection,
  GenerationErrorCode,
  sanitizeGenerationError,
  type TenantContext,
} from "../src/lib.js";
import {
  GenerationKind,
  GenerationPhase,
  GenerationStatus,
  isInstallationId,
  isRepoId,
  PrState,
  type InstallationId,
  type RepoId,
} from "../src/types.js";
import { brandWith, freshDatabase } from "./helpers.js";

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };

describe("generationProjection — D10 transitions", () => {
  it("queued → running → succeeded, attempts stable, updated_at advances", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const gen = generationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });

    const target = {
      pullRequestId: pr.id,
      kind: GenerationKind.delta,
      headSha: "head",
      baselineSha: "checkpoint",
    };

    const queued = await gen.upsertQueued(target);
    expect(queued.ok).toBe(true);
    if (!queued.ok) throw new Error("queue failed");
    expect(queued.value.status).toBe(GenerationStatus.queued);
    expect(queued.value.attempts).toBe(0);

    const running = await gen.markRunning(target, GenerationPhase.generating);
    if (!running.ok) throw new Error("markRunning failed");
    expect(running.value.status).toBe(GenerationStatus.running);
    expect(running.value.phase).toBe(GenerationPhase.generating);
    expect(running.value.updatedAt.getTime()).toBeGreaterThanOrEqual(
      queued.value.updatedAt.getTime(),
    );

    const done = await gen.markSucceeded(target);
    if (!done.ok) throw new Error("markSucceeded failed");
    expect(done.value.status).toBe(GenerationStatus.succeeded);
    expect(done.value.id).toBe(queued.value.id); // one row throughout
  });

  it("re-queue increments attempts and resets phase/error", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const gen = generationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKind.delta,
      headSha: "head",
      baselineSha: "checkpoint",
    };

    const first = await gen.upsertQueued(target);
    await gen.markFailed(target, "boom");
    const requeued = await gen.upsertQueued(target);

    if (!first.ok || !requeued.ok) throw new Error("queue failed");
    expect(requeued.value.id).toBe(first.value.id);
    expect(requeued.value.attempts).toBe(1);
    expect(requeued.value.status).toBe(GenerationStatus.queued);
    expect(requeued.value.error).toBeNull();
  });

  it("brief-kind (null baseline_sha) upsert conflicts — NULLS NOT DISTINCT proof", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const gen = generationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKind.brief,
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
    const b = forTenant(handle, CTX_B);
    const genA = generationProjection(handle, CTX_A);
    const bPr = await b.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });

    const result = await genA.upsertQueued({
      pullRequestId: bPr.id,
      kind: GenerationKind.brief,
      headSha: "head",
      baselineSha: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error.code).toBe(GenerationErrorCode.parentNotInTenant);
  });

  it("markFailed sanitizes the stored error: first line, URLs redacted, capped", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const gen = generationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKind.brief,
      headSha: "head",
      baselineSha: null,
    };
    await gen.upsertQueued(target);

    const raw = [
      "connect ECONNREFUSED postgres://user:pass@host/db retrying",
      "    at TCPConnectWrap.afterConnect (node:net:1494:16)",
      "    at processTicksAndRejections (node:internal/process/task_queues:82:21)",
    ].join("\n");
    const failed = await gen.markFailed(target, raw);

    if (!failed.ok) throw new Error("markFailed failed");
    const stored = failed.value.error;
    expect(stored).toBe("connect ECONNREFUSED [redacted-url] retrying");
    expect(stored).not.toContain("\n"); // one line — stack trace dropped
    expect(stored).not.toContain("pass"); // credentials gone
    expect(stored).not.toContain("postgres://");
    expect((stored ?? "").length).toBeLessThanOrEqual(300);
    // The pure function is exported and matches what was stored.
    expect(sanitizeGenerationError(raw)).toBe(stored);
    // The cap applies even to a single very long line.
    expect(sanitizeGenerationError("x".repeat(1000)).length).toBe(300);
  });

  it("a transition on a missing projection row returns notFound", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const gen = generationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });

    const result = await gen.markRunning({
      pullRequestId: pr.id,
      kind: GenerationKind.brief,
      headSha: "never-queued",
      baselineSha: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected notFound");
    expect(result.error.code).toBe(GenerationErrorCode.notFound);
  });
});
