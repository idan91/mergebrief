// Spend-cap counter: the repo-scoped, UTC-day-windowed count of
// generation runs that STARTED, plus the terminal `capped` transition. The
// boundary cases (23:59:59.999 vs 00:00:00.000) are the whole point of the
// half-open window, so `created_at` is backdated through the raw harness
// client — nothing in the store surface sets it.
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { fromDrizzle, type AppDatabase } from "../src/db/handle";
import * as schema from "../src/schema/index";
import {
  forTenant,
  generationProjection,
  type TenantContext,
} from "../src/index";
import {
  GenerationKind,
  GenerationStatus,
  isInstallationId,
  isRepoId,
  PrState,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
} from "../src/types";
import { brandWith, freshPglite } from "./helpers";

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
  const repo = forTenant(handle, CTX);
  const pr = await repo.pullRequests.upsert({
    repoId: REPO,
    prNumber: 7,
    state: PrState.OPEN,
    repoSlug: SLUG,
  });
  const projection = generationProjection(handle, CTX);
  return {
    handle,
    pullRequestId: pr.id,
    async run({ pullRequestId, headSha, status, createdAt, attempts = 0 }) {
      const target = {
        pullRequestId,
        kind: GenerationKind.BRIEF,
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
      status: GenerationStatus.SUCCEEDED,
      createdAt: inside,
    });
    await run({
      pullRequestId,
      headSha: "b",
      status: GenerationStatus.FAILED,
      createdAt: inside,
    });
    await run({
      pullRequestId,
      headSha: "c",
      // Superseded runs SPENT — they count.
      status: GenerationStatus.SUPERSEDED,
      createdAt: inside,
    });
    await run({
      pullRequestId,
      headSha: "d",
      status: GenerationStatus.RUNNING,
      createdAt: inside,
    });
    await run({
      pullRequestId,
      headSha: "e",
      // Enqueued but never drained — nothing spent yet.
      status: GenerationStatus.QUEUED,
      createdAt: inside,
    });
    await run({
      pullRequestId,
      headSha: "f",
      // The skip itself must never feed the counter that produced it.
      status: GenerationStatus.CAPPED,
      createdAt: inside,
    });

    const count = await generationProjection(
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
      status: GenerationStatus.SUCCEEDED,
      createdAt: inside,
      attempts: 3,
    });
    // A first run carries attempts = 0 but is still one paid run.
    await run({
      pullRequestId,
      headSha: "fresh",
      status: GenerationStatus.SUCCEEDED,
      createdAt: inside,
    });

    const count = await generationProjection(
      handle,
      CTX,
    ).countStartedRunsForRepo({
      repoId: REPO,
      from: DAY_START,
      to: DAY_END,
    });
    expect(count).toBe(4);
  });

  it("counts no attempts from queued or capped rows however high their attempts", async () => {
    const { handle, pullRequestId, run } = await harness();
    const inside = new Date("2026-08-03T12:00:00.000Z");
    await run({
      pullRequestId,
      headSha: "requeued",
      status: GenerationStatus.QUEUED,
      createdAt: inside,
      attempts: 9,
    });
    await run({
      pullRequestId,
      headSha: "skipped",
      status: GenerationStatus.CAPPED,
      createdAt: inside,
      attempts: 9,
    });

    const count = await generationProjection(
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
      status: GenerationStatus.SUCCEEDED,
      createdAt: DAY_START,
    });
    await run({
      pullRequestId,
      headSha: "last-instant",
      status: GenerationStatus.SUCCEEDED,
      createdAt: new Date("2026-08-03T23:59:59.999Z"),
    });
    await run({
      pullRequestId,
      headSha: "next-day",
      status: GenerationStatus.SUCCEEDED,
      createdAt: DAY_END,
    });
    await run({
      pullRequestId,
      headSha: "yesterday",
      status: GenerationStatus.SUCCEEDED,
      createdAt: new Date("2026-08-02T23:59:59.999Z"),
    });

    const count = await generationProjection(
      handle,
      CTX,
    ).countStartedRunsForRepo({
      repoId: REPO,
      from: DAY_START,
      to: DAY_END,
    });
    expect(count).toBe(2);
  });

  it("counts per repo and per tenant, never across either", async () => {
    const { handle, pullRequestId, run } = await harness();
    const inside = new Date("2026-08-03T09:00:00.000Z");
    await run({
      pullRequestId,
      headSha: "mine",
      status: GenerationStatus.SUCCEEDED,
      createdAt: inside,
    });

    // Same tenant, a different repo.
    const sibling = await forTenant(handle, CTX).pullRequests.upsert({
      repoId: OTHER_REPO,
      prNumber: 9,
      state: PrState.OPEN,
      repoSlug: "acme/web",
    });
    await run({
      pullRequestId: sibling.id,
      headSha: "sibling",
      status: GenerationStatus.SUCCEEDED,
      createdAt: inside,
    });

    // Another tenant that sees the SAME repo (same numeric id).
    const otherCtx: TenantContext = { installationId: OTHER_TENANT };
    const foreignPr = await forTenant(handle, otherCtx).pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrState.OPEN,
      repoSlug: SLUG,
    });
    const foreign = generationProjection(handle, otherCtx);
    const foreignTarget = {
      pullRequestId: foreignPr.id,
      kind: GenerationKind.BRIEF,
      headSha: "foreign",
      baselineSha: null,
    } as const;
    const queued = await foreign.upsertQueued(foreignTarget);
    if (!queued.ok) throw new Error(queued.error.message);
    await foreign.markSucceeded(foreignTarget);

    const count = await generationProjection(
      handle,
      CTX,
    ).countStartedRunsForRepo({
      repoId: REPO,
      from: DAY_START,
      to: DAY_END,
    });
    expect(count).toBe(1);
  });
});

describe("markCapped", () => {
  it("is terminal, consumes no attempt, and carries no error", async () => {
    const { handle, pullRequestId } = await harness();
    const projection = generationProjection(handle, CTX);
    const target = {
      pullRequestId,
      kind: GenerationKind.BRIEF,
      headSha: "capped-head",
      baselineSha: null,
    } as const;
    const queued = await projection.upsertQueued(target);
    if (!queued.ok) throw new Error(queued.error.message);

    const capped = await projection.markCapped(target);
    if (!capped.ok) throw new Error(capped.error.message);
    expect(capped.value.status).toBe(GenerationStatus.CAPPED);
    expect(capped.value.attempts).toBe(queued.value.attempts);
    expect(capped.value.phase).toBeNull();
    expect(capped.value.error).toBeNull();
    expect(capped.value.id).toBe(queued.value.id);
  });
});
