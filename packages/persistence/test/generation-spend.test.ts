// Spend-cap counter: the instance-wide, UTC-day-windowed count of paid runs,
// one `generation_attempt` row each, plus the terminal `capped` transition.
// The boundary cases (23:59:59.999 vs 00:00:00.000) are the whole point of
// the half-open window, so `started_at` is backdated through the raw harness
// client, since nothing in the store surface sets it.
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { fromDrizzle, type AppDatabase } from "../src/db/handle";
import {
  ClaimOutcomes,
  createGenerationProjection,
  createPurgeRoutines,
  createTenantRepository,
  type GenerationTarget,
  type TenantContext,
} from "../src/index";
import {
  isInstallationId,
  isRepoId,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
} from "../src/types";
import { GenerationPhases, GenerationStatuses } from "types/generations";
import { PrStates } from "types/pull-requests";
import { brandWith, freshPglite, makeBriefTarget } from "./helpers";

const TENANT: InstallationId = brandWith(isInstallationId, 1000n);
const OTHER_TENANT: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const OTHER_REPO: RepoId = brandWith(isRepoId, 888n);
const CTX: TenantContext = { installationId: TENANT };
const SLUG = "acme/api";
const LEASE_MS = 120_000;

/** The UTC day under test: 2026-08-03T00:00Z (inclusive) → 08-04 (exclusive). */
const DAY_START = new Date("2026-08-03T00:00:00.000Z");
const DAY_END = new Date("2026-08-04T00:00:00.000Z");
const NEXT_DAY_END = new Date("2026-08-05T00:00:00.000Z");
const INSIDE = new Date("2026-08-03T12:00:00.000Z");
const ALL_TIME = {
  from: new Date(0),
  to: new Date("2100-01-01T00:00:00.000Z"),
};

interface Harness {
  readonly handle: AppDatabase;
  readonly pullRequestId: PullRequestRowId;
  /** One paid run on `target`, finished as succeeded and stamped `startedAt`. */
  spend(
    target: GenerationTarget,
    startedAt: Date,
    ctx?: TenantContext,
  ): Promise<void>;
  countDay(from: Date, to: Date): Promise<number>;
}

async function stampAttempt(
  client: PGlite,
  runId: string,
  startedAt: Date,
): Promise<void> {
  await client.query(
    "update generation_attempt set started_at = $1 where run_id = $2",
    [startedAt.toISOString(), runId],
  );
}

async function harness(): Promise<Harness> {
  const client = await freshPglite();
  const handle = fromDrizzle(drizzle(client));
  const pr = await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: REPO,
    prNumber: 7,
    state: PrStates.OPEN,
    repoSlug: SLUG,
  });
  return {
    handle,
    pullRequestId: pr.id,
    async spend(target, startedAt, ctx = CTX) {
      const projection = createGenerationProjection(handle, ctx);
      await projection.upsertPending(target);
      const claimed = await projection.claimRun({
        target,
        leaseMs: LEASE_MS,
        ...ALL_TIME,
      });
      if (!claimed.ok || claimed.value.kind !== ClaimOutcomes.CLAIMED) {
        throw new Error("expected a claim");
      }
      await stampAttempt(client, claimed.value.runId, startedAt);
      await projection.finishRun(target, claimed.value.runId, {
        status: GenerationStatuses.SUCCEEDED,
      });
    },
    async countDay(from, to) {
      return createGenerationProjection(handle, CTX).countStartedRuns({
        from,
        to,
      });
    },
  };
}

describe("countStartedRuns", () => {
  it("counts one per paid run and nothing for an unstarted row", async () => {
    const { pullRequestId, spend, countDay, handle } = await harness();
    await spend(makeBriefTarget(pullRequestId, "a"), INSIDE);
    await spend(makeBriefTarget(pullRequestId, "b"), INSIDE);
    await createGenerationProjection(handle, CTX).upsertPending(
      makeBriefTarget(pullRequestId, "waiting"),
    );

    expect(await countDay(DAY_START, DAY_END)).toBe(2);
  });

  it("two claims on one row count two", async () => {
    const { pullRequestId, spend, countDay } = await harness();
    const target = makeBriefTarget(pullRequestId, "retried");
    await spend(target, INSIDE);
    await spend(target, INSIDE);

    expect(await countDay(DAY_START, DAY_END)).toBe(2);
  });

  it("a re-queued or capped row keeps its earlier attempts counted", async () => {
    const { pullRequestId, spend, countDay, handle } = await harness();
    const projection = createGenerationProjection(handle, CTX);
    const requeued = makeBriefTarget(pullRequestId, "requeued");
    const capped = makeBriefTarget(pullRequestId, "capped");
    await spend(requeued, INSIDE);
    await spend(capped, INSIDE);

    await projection.upsertPending(requeued);
    await projection.markCapped(capped);

    expect(await countDay(DAY_START, DAY_END)).toBe(2);
  });

  it("a re-run on a later day counts on its own day", async () => {
    const { pullRequestId, spend, countDay } = await harness();
    const target = makeBriefTarget(pullRequestId, "two-days");
    await spend(target, INSIDE);
    await spend(target, new Date("2026-08-04T09:00:00.000Z"));

    expect(await countDay(DAY_START, DAY_END)).toBe(1);
    expect(await countDay(DAY_END, NEXT_DAY_END)).toBe(1);
  });

  it("includes the first instant of the day and excludes the next day's", async () => {
    const { pullRequestId, spend, countDay } = await harness();
    await spend(makeBriefTarget(pullRequestId, "midnight"), DAY_START);
    await spend(
      makeBriefTarget(pullRequestId, "last-instant"),
      new Date("2026-08-03T23:59:59.999Z"),
    );
    await spend(makeBriefTarget(pullRequestId, "next-day"), DAY_END);
    await spend(
      makeBriefTarget(pullRequestId, "yesterday"),
      new Date("2026-08-02T23:59:59.999Z"),
    );

    expect(await countDay(DAY_START, DAY_END)).toBe(2);
  });

  it("counts every repo and every tenant into one instance pool", async () => {
    const { handle, pullRequestId, spend, countDay } = await harness();
    await spend(makeBriefTarget(pullRequestId, "mine"), INSIDE);

    // Same tenant, a different repo: the cap is the INSTANCE's budget.
    const sibling = await createTenantRepository(
      handle,
      CTX,
    ).pullRequests.upsert({
      repoId: OTHER_REPO,
      prNumber: 9,
      state: PrStates.OPEN,
      repoSlug: "acme/web",
    });
    await spend(makeBriefTarget(sibling.id, "sibling"), INSIDE);

    // Another installation entirely: the operator pays one bill, so its
    // run counts into the same pool.
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
    await spend(makeBriefTarget(foreignPr.id, "foreign"), INSIDE, otherCtx);

    expect(await countDay(DAY_START, DAY_END)).toBe(3);
  });

  it("a purged pull request leaves its attempts counted", async () => {
    const { handle, pullRequestId, spend, countDay } = await harness();
    await spend(makeBriefTarget(pullRequestId, "purged"), INSIDE);

    const purged = await createPurgeRoutines(handle, CTX).purgePullRequest(
      pullRequestId,
    );

    expect(purged.ok).toBe(true);
    expect(await countDay(DAY_START, DAY_END)).toBe(1);
  });
});

describe("markCapped", () => {
  it("is terminal, consumes no attempt, and carries no error", async () => {
    const { handle, pullRequestId } = await harness();
    const projection = createGenerationProjection(handle, CTX);
    const target = makeBriefTarget(pullRequestId, "capped-head");
    const pending = await projection.upsertPending(target);

    const capped = await projection.markCapped(target);
    if (!capped.ok) {
      throw new Error(capped.error.message);
    }
    expect(capped.value.status).toBe(GenerationStatuses.CAPPED);
    expect(capped.value.attempts).toBe(pending.attempts);
    expect(capped.value.phase).toBeNull();
    expect(capped.value.errorCode).toBeNull();
    expect(capped.value.id).toBe(pending.id);
  });
});

describe("claimRun under the cap", () => {
  const WINDOW = {
    from: DAY_START,
    to: new Date("2100-01-01T00:00:00.000Z"),
    leaseMs: LEASE_MS,
  };

  it("claims under the cap and marks the row running with its created_at", async () => {
    const { handle, pullRequestId } = await harness();
    const projection = createGenerationProjection(handle, CTX);
    const target = makeBriefTarget(pullRequestId, "first");
    await projection.upsertPending(target);

    const started = await projection.claimRun({
      target,
      phase: GenerationPhases.FETCHING,
      cap: 1,
      ...WINDOW,
    });

    if (!started.ok) {
      throw new Error(started.error.message);
    }
    if (started.value.kind !== ClaimOutcomes.CLAIMED) {
      throw new Error(`expected a claim, got ${started.value.kind}`);
    }
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
    await projection.upsertPending(first);
    await projection.upsertPending(second);
    await projection.claimRun({
      target: first,
      cap: 1,
      ...WINDOW,
    });

    const refused = await projection.claimRun({
      target: second,
      cap: 1,
      ...WINDOW,
    });

    if (!refused.ok) {
      throw new Error(refused.error.message);
    }
    expect(refused.value).toEqual({
      kind: ClaimOutcomes.CAPPED,
      startedRuns: 1,
    });
    const row = await projection.get(second);
    expect(row?.status).toBe(GenerationStatuses.PENDING);
  });

  it("an absent cap claims without counting", async () => {
    const { handle, pullRequestId, spend } = await harness();
    await spend(makeBriefTarget(pullRequestId, "spent"), INSIDE);
    const projection = createGenerationProjection(handle, CTX);
    const target = makeBriefTarget(pullRequestId, "uncapped");
    await projection.upsertPending(target);

    const started = await projection.claimRun({
      target,
      ...WINDOW,
    });

    if (!started.ok) {
      throw new Error(started.error.message);
    }
    expect(started.value.kind).toBe(ClaimOutcomes.CLAIMED);
    const row = await projection.get(target);
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
  });

  it("a run started in another repo counts against this claim", async () => {
    const { handle, pullRequestId, spend } = await harness();
    const sibling = await createTenantRepository(
      handle,
      CTX,
    ).pullRequests.upsert({
      repoId: OTHER_REPO,
      prNumber: 9,
      state: PrStates.OPEN,
      repoSlug: "acme/web",
    });
    await spend(makeBriefTarget(sibling.id, "elsewhere"), INSIDE);
    const projection = createGenerationProjection(handle, CTX);
    const target = makeBriefTarget(pullRequestId, "mine");
    await projection.upsertPending(target);

    const refused = await projection.claimRun({ target, cap: 1, ...WINDOW });

    if (!refused.ok) {
      throw new Error(refused.error.message);
    }
    expect(refused.value).toEqual({
      kind: ClaimOutcomes.CAPPED,
      startedRuns: 1,
    });
  });
});
