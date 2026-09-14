// Spend-cap counter: the repo-scoped, UTC-day-windowed count of
// generation runs that STARTED, plus the terminal `capped` transition. The
// boundary cases (23:59:59.999 vs 00:00:00.000) are the whole point of the
// half-open window, so `created_at` is backdated through the raw harness
// client, since nothing in the store surface sets it.
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { fromDrizzle, type AppDatabase } from "../src/db/handle";
import * as schema from "../src/schema/index";
import {
  createTenantRepository,
  createGenerationProjection,
  type TenantContext,
} from "../src/index";
import {
  GenerationKinds,
  GenerationPhases,
  GenerationStatuses,
  isInstallationId,
  isRepoId,
  PrStates,
  type InstallationId,
  type GenerationStatus,
  type PullRequestRowId,
  type RepoId,
} from "../src/types";
import { brandWith, freshPglite, makeBriefTarget } from "./helpers";

const TENANT: InstallationId = brandWith(isInstallationId, 1000n);
const OTHER_TENANT: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const OTHER_REPO: RepoId = brandWith(isRepoId, 888n);
const CTX: TenantContext = { installationId: TENANT };
const SLUG = "acme/api";

/** The UTC day under test: 2026-08-03T00:00Z (inclusive) → 08-04 (exclusive). */
const DAY_START = new Date("2026-08-03T00:00:00.000Z");
const DAY_END = new Date("2026-08-04T00:00:00.000Z");

interface Harness {
  readonly handle: AppDatabase;
  /** Backdate one projection row's created_at (raw; nothing public sets it). */
  backdate(rowId: bigint, createdAt: Date): Promise<void>;
  /** Project a brief run at `status`, stamped `createdAt` (and `attempts`). */
  run(input: {
    pullRequestId: PullRequestRowId;
    headSha: string;
    status: GenerationStatus;
    createdAt: Date;
    attempts?: number;
  }): Promise<void>;
}

async function harness(): Promise<
  Harness & { pullRequestId: PullRequestRowId }
> {
  const client = await freshPglite();
  const handle = fromDrizzle(drizzle(client, { schema }));
  const repo = createTenantRepository(handle, CTX);
  const pr = await repo.pullRequests.upsert({
    repoId: REPO,
    prNumber: 7,
    state: PrStates.OPEN,
    repoSlug: SLUG,
  });
  const projection = createGenerationProjection(handle, CTX);
  return {
    handle,
    pullRequestId: pr.id,
    async backdate(rowId, createdAt) {
      await client.query(
        "update generation set created_at = $1 where id = $2",
        [createdAt.toISOString(), rowId],
      );
    },
    async run({ pullRequestId, headSha, status, createdAt, attempts = 0 }) {
      const target = {
        pullRequestId,
        kind: GenerationKinds.BRIEF,
        headSha,
        baselineSha: null,
      } as const;
      const queued = await projection.upsertQueued(target);
      if (!queued.ok) throw new Error(queued.error.message);
      // `created_at` defaults to now() and `attempts` only moves on a
      // re-queue; the counter windows on the first and SUMS the second, so
      // the fixture stamps both directly.
      await client.query(
        "update generation set status = $1, created_at = $2, attempts = $3 where id = $4",
        [status, createdAt.toISOString(), attempts, queued.value.id],
      );
    },
  };
}

describe("countStartedRunsForRepo", () => {
  it("counts started runs and excludes queued and capped ones", async () => {
    const { handle, pullRequestId, run } = await harness();
    const inside = new Date("2026-08-03T12:00:00.000Z");
    await run({
      pullRequestId,
      headSha: "a",
      status: GenerationStatuses.SUCCEEDED,
      createdAt: inside,
    });
    await run({
      pullRequestId,
      headSha: "b",
      status: GenerationStatuses.FAILED,
      createdAt: inside,
    });
    await run({
      pullRequestId,
      headSha: "c",
      // Superseded runs SPENT, so they count.
      status: GenerationStatuses.SUPERSEDED,
      createdAt: inside,
    });
    await run({
      pullRequestId,
      headSha: "d",
      status: GenerationStatuses.RUNNING,
      createdAt: inside,
    });
    await run({
      pullRequestId,
      headSha: "e",
      // Enqueued but never drained, so nothing spent yet.
      status: GenerationStatuses.QUEUED,
      createdAt: inside,
    });
    await run({
      pullRequestId,
      headSha: "f",
      // The skip itself must never feed the counter that produced it.
      status: GenerationStatuses.CAPPED,
      createdAt: inside,
    });

    const count = await createGenerationProjection(
      handle,
      CTX,
    ).countStartedRunsForRepo({
      repoId: REPO,
      from: DAY_START,
      to: DAY_END,
    });
    expect(count).toBe(4);
  });

  it("counts ATTEMPTS, not rows: a re-queued row spends once per attempt", async () => {
    const { handle, pullRequestId, run } = await harness();
    const inside = new Date("2026-08-03T12:00:00.000Z");
    // One row, re-queued twice after its first run: three paid runs against
    // one natural key. Counting rows would report 1 and let a hot PR spend a
    // multiple of the cap.
    await run({
      pullRequestId,
      headSha: "hot",
      status: GenerationStatuses.SUCCEEDED,
      createdAt: inside,
      attempts: 3,
    });
    // A first run carries attempts = 0 but is still one paid run.
    await run({
      pullRequestId,
      headSha: "fresh",
      status: GenerationStatuses.SUCCEEDED,
      createdAt: inside,
    });

    const count = await createGenerationProjection(
      handle,
      CTX,
    ).countStartedRunsForRepo({
      repoId: REPO,
      from: DAY_START,
      to: DAY_END,
    });
    expect(count).toBe(4);
  });

  it("queued and capped rows count nothing however high their attempts", async () => {
    const { handle, pullRequestId, run } = await harness();
    const inside = new Date("2026-08-03T12:00:00.000Z");
    await run({
      pullRequestId,
      headSha: "requeued",
      status: GenerationStatuses.QUEUED,
      createdAt: inside,
      attempts: 9,
    });
    await run({
      pullRequestId,
      headSha: "skipped",
      status: GenerationStatuses.CAPPED,
      createdAt: inside,
      attempts: 9,
    });

    const count = await createGenerationProjection(
      handle,
      CTX,
    ).countStartedRunsForRepo({
      repoId: REPO,
      from: DAY_START,
      to: DAY_END,
    });
    expect(count).toBe(0);
  });

  it("includes the first instant of the day and excludes the next day's", async () => {
    const { handle, pullRequestId, run } = await harness();
    await run({
      pullRequestId,
      headSha: "midnight",
      status: GenerationStatuses.SUCCEEDED,
      createdAt: DAY_START,
    });
    await run({
      pullRequestId,
      headSha: "last-instant",
      status: GenerationStatuses.SUCCEEDED,
      createdAt: new Date("2026-08-03T23:59:59.999Z"),
    });
    await run({
      pullRequestId,
      headSha: "next-day",
      status: GenerationStatuses.SUCCEEDED,
      createdAt: DAY_END,
    });
    await run({
      pullRequestId,
      headSha: "yesterday",
      status: GenerationStatuses.SUCCEEDED,
      createdAt: new Date("2026-08-02T23:59:59.999Z"),
    });

    const count = await createGenerationProjection(
      handle,
      CTX,
    ).countStartedRunsForRepo({
      repoId: REPO,
      from: DAY_START,
      to: DAY_END,
    });
    expect(count).toBe(2);
  });

  it("counts per repo, one shared pool across tenants and worlds", async () => {
    const { handle, pullRequestId, run, backdate } = await harness();
    const inside = new Date("2026-08-03T09:00:00.000Z");
    await run({
      pullRequestId,
      headSha: "mine",
      status: GenerationStatuses.SUCCEEDED,
      createdAt: inside,
    });

    // Same tenant, a different repo, never counted into REPO's pool.
    const sibling = await createTenantRepository(
      handle,
      CTX,
    ).pullRequests.upsert({
      repoId: OTHER_REPO,
      prNumber: 9,
      state: PrStates.OPEN,
      repoSlug: "acme/web",
    });
    await run({
      pullRequestId: sibling.id,
      headSha: "sibling",
      status: GenerationStatuses.SUCCEEDED,
      createdAt: inside,
    });

    // Another tenant that sees the SAME repo (same numeric id): the cap is
    // the REPO's budget, so this run DOES count into the shared pool.
    const otherCtx: TenantContext = { installationId: OTHER_TENANT };
    const foreignPr = await createTenantRepository(
      handle,
      otherCtx,
    ).pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
      repoSlug: SLUG,
    });
    const foreign = createGenerationProjection(handle, otherCtx);
    const foreignTarget = {
      pullRequestId: foreignPr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "foreign",
      baselineSha: null,
    } as const;
    const queued = await foreign.upsertQueued(foreignTarget);
    if (!queued.ok) throw new Error(queued.error.message);
    await foreign.markSucceeded(foreignTarget);
    await backdate(queued.value.id, inside);

    const count = await createGenerationProjection(
      handle,
      CTX,
    ).countStartedRunsForRepo({
      repoId: REPO,
      from: DAY_START,
      to: DAY_END,
    });
    expect(count).toBe(2);
  });
});

describe("markCapped", () => {
  it("is terminal, consumes no attempt, and carries no error", async () => {
    const { handle, pullRequestId } = await harness();
    const projection = createGenerationProjection(handle, CTX);
    const target = {
      pullRequestId,
      kind: GenerationKinds.BRIEF,
      headSha: "capped-head",
      baselineSha: null,
    } as const;
    const queued = await projection.upsertQueued(target);
    if (!queued.ok) throw new Error(queued.error.message);

    const capped = await projection.markCapped(target);
    if (!capped.ok) throw new Error(capped.error.message);
    expect(capped.value.status).toBe(GenerationStatuses.CAPPED);
    expect(capped.value.attempts).toBe(queued.value.attempts);
    expect(capped.value.phase).toBeNull();
    expect(capped.value.errorCode).toBeNull();
    expect(capped.value.id).toBe(queued.value.id);
  });
});

describe("startRun", () => {
  const WINDOW = { from: DAY_START, to: new Date("2100-01-01T00:00:00.000Z") };

  it("starts under the cap and marks the row running with its created_at", async () => {
    const { handle, pullRequestId } = await harness();
    const projection = createGenerationProjection(handle, CTX);
    const target = makeBriefTarget(pullRequestId, "first");
    await projection.upsertQueued(target);

    const started = await projection.startRun({
      target,
      phase: GenerationPhases.FETCHING,
      repoId: REPO,
      cap: 1,
      ...WINDOW,
    });

    if (!started.ok) throw new Error(started.error.message);
    expect(started.value.started).toBe(true);
    if (!started.value.started) throw new Error("unreachable");
    expect(started.value.createdAt).toBeInstanceOf(Date);
    const row = await projection.get(target);
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
    expect(row?.phase).toBe(GenerationPhases.FETCHING);
  });

  it("refuses the second run at cap 1 and reports one started", async () => {
    const { handle, pullRequestId } = await harness();
    const projection = createGenerationProjection(handle, CTX);
    const first = makeBriefTarget(pullRequestId, "first");
    const second = makeBriefTarget(pullRequestId, "second");
    await projection.upsertQueued(first);
    await projection.upsertQueued(second);
    await projection.startRun({
      target: first,
      repoId: REPO,
      cap: 1,
      ...WINDOW,
    });

    const refused = await projection.startRun({
      target: second,
      repoId: REPO,
      cap: 1,
      ...WINDOW,
    });

    if (!refused.ok) throw new Error(refused.error.message);
    expect(refused.value).toEqual({ started: false, startedRuns: 1 });
    const row = await projection.get(second);
    expect(row?.status).toBe(GenerationStatuses.QUEUED);
  });

  it("an absent cap starts without counting", async () => {
    const { handle, pullRequestId, run } = await harness();
    const inside = new Date("2026-08-03T12:00:00.000Z");
    await run({
      pullRequestId,
      headSha: "spent",
      status: GenerationStatuses.SUCCEEDED,
      createdAt: inside,
      attempts: 50,
    });
    const projection = createGenerationProjection(handle, CTX);
    const target = makeBriefTarget(pullRequestId, "uncapped");
    await projection.upsertQueued(target);

    const started = await projection.startRun({
      target,
      repoId: REPO,
      ...WINDOW,
    });

    if (!started.ok) throw new Error(started.error.message);
    expect(started.value.started).toBe(true);
    const row = await projection.get(target);
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
  });

  it("capped and queued rows never count against the cap", async () => {
    const { handle, pullRequestId, run } = await harness();
    const inside = new Date("2026-08-03T12:00:00.000Z");
    await run({
      pullRequestId,
      headSha: "skipped",
      status: GenerationStatuses.CAPPED,
      createdAt: inside,
    });
    await run({
      pullRequestId,
      headSha: "waiting",
      status: GenerationStatuses.QUEUED,
      createdAt: inside,
    });
    const projection = createGenerationProjection(handle, CTX);
    const target = makeBriefTarget(pullRequestId, "next");
    await projection.upsertQueued(target);

    const started = await projection.startRun({
      target,
      repoId: REPO,
      cap: 1,
      ...WINDOW,
    });

    if (!started.ok) throw new Error(started.error.message);
    expect(started.value.started).toBe(true);
  });

  it("a missing projection row returns notFound", async () => {
    const { handle, pullRequestId } = await harness();
    const projection = createGenerationProjection(handle, CTX);

    const result = await projection.startRun({
      target: makeBriefTarget(pullRequestId, "ghost"),
      repoId: REPO,
      cap: 1,
      ...WINDOW,
    });

    expect(result.ok).toBe(false);
  });
});
