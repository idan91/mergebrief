// The generation claim: a run id plus a lease on the projection row. Lease
// expiry is simulated by moving `lease_expires_at` into the past through the
// harness's raw window, never by sleeping.
import { describe, expect, it, onTestFinished } from "vitest";
import {
  ClaimOutcomes,
  createGenerationProjection,
  createTenantRepository,
  GenerationErrorCodes,
  type ClaimRunOutcome,
  type GenerationProjection,
  type TenantContext,
} from "../src/index";
import { createPgliteHarness, type PgliteHarness } from "../src/testing";
import {
  isInstallationId,
  isRepoId,
  type PullRequestRowId,
} from "../src/types";
import {
  GenerationFailureCodes,
  GenerationPhases,
  GenerationStatuses,
} from "types/generations";
import { PrStates } from "types/pull-requests";
import type { Result } from "types/utils";
import { brandWith, makeBriefTarget } from "./helpers";

const CTX: TenantContext = {
  installationId: brandWith(isInstallationId, 1000n),
};
const LEASE_MS = 120_000;
const WINDOW = {
  from: new Date("2000-01-01T00:00:00.000Z"),
  to: new Date("2100-01-01T00:00:00.000Z"),
};
const HEAD = "head";
const STALE_RUN_ID = "00000000-0000-4000-8000-000000000000";
const FAILED_RUN = {
  status: GenerationStatuses.FAILED,
  failure: { code: GenerationFailureCodes.UNKNOWN, params: { detail: "boom" } },
} as const;

interface ClaimWorld {
  readonly harness: PgliteHarness;
  readonly gen: GenerationProjection;
  readonly pullRequestId: PullRequestRowId;
  readonly target: ReturnType<typeof makeBriefTarget>;
}

async function makeClaimWorld(): Promise<ClaimWorld> {
  const harness = await createPgliteHarness();
  onTestFinished(() => harness.close());
  const pr = await createTenantRepository(
    harness.handle,
    CTX,
  ).pullRequests.upsert({
    repoId: brandWith(isRepoId, 777n),
    prNumber: 7,
    state: PrStates.OPEN,
  });
  const gen = createGenerationProjection(harness.handle, CTX);
  const target = makeBriefTarget(pr.id, HEAD);
  await gen.upsertPending(target);
  return { harness, gen, pullRequestId: pr.id, target };
}

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function readRunId(outcome: ClaimRunOutcome): string {
  if (outcome.kind !== ClaimOutcomes.CLAIMED) {
    throw new Error(`expected a claim, got ${outcome.kind}`);
  }
  return outcome.runId;
}

async function claim(
  world: ClaimWorld,
  cap?: number,
): Promise<ClaimRunOutcome> {
  const input = { target: world.target, leaseMs: LEASE_MS, ...WINDOW };
  if (cap === undefined) {
    return unwrap(await world.gen.claimRun(input));
  }
  return unwrap(await world.gen.claimRun({ ...input, cap }));
}

async function expireLease(world: ClaimWorld): Promise<void> {
  await world.harness.raw(
    "update generation set lease_expires_at = now() - interval '1 second'",
  );
}

async function countAttemptRows(world: ClaimWorld): Promise<number> {
  const rows = await world.harness.raw(
    "select count(*)::int as total from generation_attempt",
  );
  return Number(rows[0]?.["total"]);
}

async function readLeaseIsLive(world: ClaimWorld): Promise<boolean> {
  const rows = await world.harness.raw(
    "select lease_expires_at > now() as live from generation",
  );
  return rows[0]?.["live"] === true;
}

describe("claimRun", () => {
  it("claims a pending row with a run id, a lease and one attempt", async () => {
    const world = await makeClaimWorld();

    const outcome = unwrap(
      await world.gen.claimRun({
        target: world.target,
        phase: GenerationPhases.FETCHING,
        leaseMs: LEASE_MS,
        ...WINDOW,
      }),
    );

    const runId = readRunId(outcome);
    const row = await world.gen.get(world.target);
    expect(row?.runId).toBe(runId);
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
    expect(row?.phase).toBe(GenerationPhases.FETCHING);
    expect(await readLeaseIsLive(world)).toBe(true);
    expect(await countAttemptRows(world)).toBe(1);
  });

  it("reports held while another run's lease is live", async () => {
    const world = await makeClaimWorld();
    const first = readRunId(await claim(world));

    const second = await claim(world);

    expect(second).toEqual({ kind: ClaimOutcomes.HELD });
    expect((await world.gen.get(world.target))?.runId).toBe(first);
    expect(await countAttemptRows(world)).toBe(1);
  });

  it("claims again once the lease has lapsed", async () => {
    const world = await makeClaimWorld();
    const first = readRunId(await claim(world));
    await expireLease(world);

    const second = readRunId(await claim(world));

    expect(second).not.toBe(first);
    expect((await world.gen.get(world.target))?.runId).toBe(second);
  });

  it("refuses at the cap, reports the count and leaves the row", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));
    unwrap(await world.gen.finishRun(world.target, runId, FAILED_RUN));

    const refused = await claim(world, 1);

    expect(refused).toEqual({ kind: ClaimOutcomes.CAPPED, startedRuns: 1 });
    const row = await world.gen.get(world.target);
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.runId).toBeNull();
  });

  it("reports finished on a succeeded row", async () => {
    const world = await makeClaimWorld();
    await world.gen.markSucceeded(world.target);

    expect(await claim(world)).toEqual({ kind: ClaimOutcomes.FINISHED });
    expect(await countAttemptRows(world)).toBe(0);
  });

  it("a missing row returns not-found", async () => {
    const world = await makeClaimWorld();

    const result = await world.gen.claimRun({
      target: makeBriefTarget(world.pullRequestId, "ghost"),
      leaseMs: LEASE_MS,
      ...WINDOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-found");
    expect(result.error.code).toBe(GenerationErrorCodes.NOT_FOUND);
  });
});

describe("fenced transitions", () => {
  it("advance, renew and finish refuse a stale run id with claim-lost", async () => {
    const world = await makeClaimWorld();
    readRunId(await claim(world));
    const before = await world.gen.get(world.target);

    const advanced = await world.gen.advanceRun(
      world.target,
      STALE_RUN_ID,
      GenerationPhases.WRITING,
    );
    const renewed = await world.gen.renewLease(
      world.target,
      STALE_RUN_ID,
      LEASE_MS,
    );
    const finished = await world.gen.finishRun(world.target, STALE_RUN_ID, {
      status: GenerationStatuses.SUCCEEDED,
    });

    for (const result of [advanced, renewed, finished]) {
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected claim-lost");
      expect(result.error.code).toBe(GenerationErrorCodes.CLAIM_LOST);
    }
    expect(await world.gen.get(world.target)).toEqual(before);
  });

  it("advanceRun moves the holder's phase", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));

    const advanced = unwrap(
      await world.gen.advanceRun(world.target, runId, GenerationPhases.WRITING),
    );

    expect(advanced.status).toBe(GenerationStatuses.RUNNING);
    expect(advanced.phase).toBe(GenerationPhases.WRITING);
    expect(advanced.runId).toBe(runId);
  });

  it("renewLease pushes a lapsed lease back into the future", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));
    await expireLease(world);

    unwrap(await world.gen.renewLease(world.target, runId, LEASE_MS));

    expect(await readLeaseIsLive(world)).toBe(true);
  });

  it("finishRun succeeded clears the claim and the phase", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));

    const done = unwrap(
      await world.gen.finishRun(world.target, runId, {
        status: GenerationStatuses.SUCCEEDED,
      }),
    );

    expect(done.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(done.phase).toBeNull();
    expect(done.runId).toBeNull();
    expect(done.leaseExpiresAt).toBeNull();
  });

  it("finishRun failed sanitizes the detail like markFailed", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));

    const failed = unwrap(
      await world.gen.finishRun(world.target, runId, {
        status: GenerationStatuses.FAILED,
        failure: {
          code: GenerationFailureCodes.UNKNOWN,
          params: { detail: "boom postgres://user:pass@host/db\n    at x" },
        },
      }),
    );

    expect(failed.errorCode).toBe(GenerationFailureCodes.UNKNOWN);
    expect(failed.errorParams?.detail).toBe("boom [redacted-url]");
    expect(failed.runId).toBeNull();
  });

  it("finishRun superseded is terminal and clears the claim", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));

    const superseded = unwrap(
      await world.gen.finishRun(world.target, runId, {
        status: GenerationStatuses.SUPERSEDED,
      }),
    );

    expect(superseded.status).toBe(GenerationStatuses.SUPERSEDED);
    expect(superseded.runId).toBeNull();
  });

  it("releaseClaim hands the row back pending and keeps the attempt", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));

    const released = unwrap(await world.gen.releaseClaim(world.target, runId));

    expect(released.status).toBe(GenerationStatuses.PENDING);
    expect(released.phase).toBeNull();
    expect(released.runId).toBeNull();
    expect(released.leaseExpiresAt).toBeNull();
    expect(await countAttemptRows(world)).toBe(1);
  });

  it("a fenced transition on a missing row returns not-found", async () => {
    const world = await makeClaimWorld();

    const result = await world.gen.releaseClaim(
      makeBriefTarget(world.pullRequestId, "ghost"),
      STALE_RUN_ID,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-found");
    expect(result.error.code).toBe(GenerationErrorCodes.NOT_FOUND);
  });
});

describe("unclaimed transitions", () => {
  it("markFailed refuses a row a live lease holds", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));

    const result = await world.gen.markFailed(world.target, {
      code: GenerationFailureCodes.UNKNOWN,
      params: { detail: "boom" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected claim-lost");
    expect(result.error.code).toBe(GenerationErrorCodes.CLAIM_LOST);
    expect((await world.gen.get(world.target))?.runId).toBe(runId);
  });

  it("markSuperseded and markCapped land once the lease has lapsed", async () => {
    const world = await makeClaimWorld();
    readRunId(await claim(world));
    await expireLease(world);

    const superseded = unwrap(await world.gen.markSuperseded(world.target));
    const capped = unwrap(await world.gen.markCapped(world.target));

    expect(superseded.status).toBe(GenerationStatuses.SUPERSEDED);
    expect(capped.status).toBe(GenerationStatuses.CAPPED);
    expect(capped.runId).toBeNull();
  });
});

describe("settleStoredBrief", () => {
  it("turns a failed row into succeeded and clears its error", async () => {
    const world = await makeClaimWorld();
    await world.gen.markFailed(world.target, {
      code: GenerationFailureCodes.UNKNOWN,
      params: { detail: "boom" },
    });

    const settled = await world.gen.settleStoredBrief(world.target);

    expect(settled?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(settled?.errorCode).toBeNull();
    expect(settled?.errorParams).toBeNull();
  });

  it("leaves a failed row a live lease holds", async () => {
    const world = await makeClaimWorld();
    readRunId(await claim(world));
    await world.harness.raw("update generation set status = 'failed'");

    expect(await world.gen.settleStoredBrief(world.target)).toBeUndefined();
    expect((await world.gen.get(world.target))?.status).toBe(
      GenerationStatuses.FAILED,
    );
  });

  it("leaves pending and succeeded rows alone", async () => {
    const world = await makeClaimWorld();

    expect(await world.gen.settleStoredBrief(world.target)).toBeUndefined();
    await world.gen.markSucceeded(world.target);
    expect(await world.gen.settleStoredBrief(world.target)).toBeUndefined();
    expect((await world.gen.get(world.target))?.status).toBe(
      GenerationStatuses.SUCCEEDED,
    );
  });
});

describe("supersedeStaleBriefs and the claim", () => {
  it("leaves a stale head a live lease holds", async () => {
    const world = await makeClaimWorld();
    readRunId(await claim(world));
    const current = makeBriefTarget(world.pullRequestId, "current");
    await world.gen.upsertPending(current);
    await world.gen.markSucceeded(current);
    await world.harness.raw(
      "update generation set updated_at = now() - interval '1 minute'",
    );

    const swept = await world.gen.supersedeStaleBriefs(
      world.pullRequestId,
      "current",
      new Date(),
    );

    expect(swept).toBe(0);
    expect((await world.gen.get(world.target))?.status).toBe(
      GenerationStatuses.RUNNING,
    );
  });
});
