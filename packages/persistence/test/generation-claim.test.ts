// The generation claim: a run id plus a lease on the projection row. Lease
// expiry is simulated by moving `lease_expires_at` into the past through the
// harness's raw window, never by sleeping.
import { describe, expect, it } from "vitest";
import {
  ChargeOutcomes,
  ClaimOutcomes,
  createGenerationProjection,
  createTenantRepository,
  GenerationErrorCodes,
  type ClaimRunOutcome,
  type GenerationError,
  type GenerationProjection,
  type TenantContext,
} from "../src/index";
import { succeedTestRun, type PgliteHarness } from "../src/testing";
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
import { brandWith, makeBriefTarget, registerSharedPglite } from "./helpers";

const CTX: TenantContext = {
  installationId: brandWith(isInstallationId, 1000n),
};
const LEASE_MS = 120_000;
const LEASE_SLACK_MS = 5_000;
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

const shared = registerSharedPglite();

async function makeClaimWorld(): Promise<ClaimWorld> {
  const { harness } = shared;
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

function expectClaimLost(result: Result<unknown, GenerationError>): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected claim-lost");
  }
  expect(result.error.code).toBe(GenerationErrorCodes.CLAIM_LOST);
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

/** A pickup time after every row write the test made. */
function readLater(): Date {
  return new Date(Date.now() + LEASE_SLACK_MS);
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

  it("reports held and the lease time left while another run holds it", async () => {
    const world = await makeClaimWorld();
    const first = readRunId(await claim(world));

    const second = await claim(world);

    if (second.kind !== ClaimOutcomes.HELD) {
      throw new Error(`expected held, got ${second.kind}`);
    }
    expect(second.leaseRemainingMs).toBeGreaterThan(LEASE_MS - LEASE_SLACK_MS);
    expect(second.leaseRemainingMs).toBeLessThanOrEqual(LEASE_MS);
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
    await world.harness.raw("update generation set status = 'succeeded'");

    expect(await claim(world)).toEqual({ kind: ClaimOutcomes.FINISHED });
    expect(await countAttemptRows(world)).toBe(0);
  });

  it("refuses an awaiting-trigger row without a claim or an attempt", async () => {
    const world = await makeClaimWorld();
    unwrap(await world.gen.markAwaitingTrigger(world.target));

    expect(await claim(world)).toEqual({
      kind: ClaimOutcomes.AWAITING_TRIGGER,
    });
    const row = await world.gen.get(world.target);
    expect(row?.status).toBe(GenerationStatuses.AWAITING_TRIGGER);
    expect(row?.runId).toBeNull();
    expect(row?.claims).toBe(0);
    expect(await countAttemptRows(world)).toBe(0);
  });
});

describe("claimRun attempt budget and recovery job", () => {
  async function claimThrice(world: ClaimWorld): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      readRunId(await claim(world));
      await expireLease(world);
    }
  }

  it("refuses a fourth claim as exhausted until a trigger re-projects", async () => {
    const world = await makeClaimWorld();
    await claimThrice(world);

    expect(await claim(world)).toEqual({
      kind: ClaimOutcomes.EXHAUSTED,
      claims: 3,
    });
    expect(await countAttemptRows(world)).toBe(3);

    unwrap(await world.gen.markFailed(world.target, FAILED_RUN.failure));
    await world.gen.upsertPending(world.target);
    expect((await claim(world)).kind).toBe(ClaimOutcomes.CLAIMED);
  });

  it("names each claim's number among the head's claims", async () => {
    const world = await makeClaimWorld();
    const numbers: number[] = [];

    for (let round = 0; round < 3; round += 1) {
      const outcome = await claim(world);
      if (outcome.kind !== ClaimOutcomes.CLAIMED) {
        throw new Error(`expected a claim, got ${outcome.kind}`);
      }
      numbers.push(outcome.claims);
      await expireLease(world);
    }

    expect(numbers).toEqual([1, 2, 3]);
  });

  it("an exhausted head ends failed with attempts-exhausted", async () => {
    const world = await makeClaimWorld();
    await claimThrice(world);
    expect((await claim(world)).kind).toBe(ClaimOutcomes.EXHAUSTED);

    const failed = unwrap(
      await world.gen.markFailed(world.target, {
        code: GenerationFailureCodes.ATTEMPTS_EXHAUSTED,
      }),
    );

    expect(failed.status).toBe(GenerationStatuses.FAILED);
    expect(failed.errorCode).toBe(GenerationFailureCodes.ATTEMPTS_EXHAUSTED);
    expect(failed.errorParams).toBeNull();
    expect(failed.runId).toBeNull();
  });

  it("queues the head's recovery job in the claim's transaction", async () => {
    const world = await makeClaimWorld();

    readRunId(
      unwrap(
        await world.gen.claimRun({
          target: world.target,
          leaseMs: LEASE_MS,
          recovery: { delaySeconds: 125 },
          ...WINDOW,
        }),
      ),
    );

    const jobs = await world.harness.raw(
      "select task_identifier, key from graphile_worker.jobs",
    );
    expect(jobs).toEqual([
      {
        task_identifier: "recover-generation",
        key: `recover-generation:${world.pullRequestId}:${HEAD}`,
      },
    ]);
  });

  it("a held row queues no recovery job", async () => {
    const world = await makeClaimWorld();
    readRunId(await claim(world));

    await world.gen.claimRun({
      target: world.target,
      leaseMs: LEASE_MS,
      recovery: { delaySeconds: 125 },
      ...WINDOW,
    });

    expect(
      await world.harness.raw("select key from graphile_worker.jobs"),
    ).toEqual([]);
  });
});

describe("chargeRun", () => {
  it("writes one attempt and leaves a succeeded row as found", async () => {
    const world = await makeClaimWorld();
    const before = await succeedTestRun(world.gen, world.target);

    const charged = unwrap(
      await world.gen.chargeRun({ target: world.target, cap: 2, ...WINDOW }),
    );

    expect(charged.kind).toBe(ChargeOutcomes.CHARGED);
    expect(await world.gen.get(world.target)).toEqual(before);
    expect(await countAttemptRows(world)).toBe(2);
  });

  it("refuses at the cap and writes nothing", async () => {
    const world = await makeClaimWorld();
    await succeedTestRun(world.gen, world.target);

    const refused = unwrap(
      await world.gen.chargeRun({ target: world.target, cap: 1, ...WINDOW }),
    );

    expect(refused).toEqual({ kind: ChargeOutcomes.CAPPED, startedRuns: 1 });
    expect(await countAttemptRows(world)).toBe(1);
  });
});

describe("readClaim", () => {
  it("reports an unclaimed row, a live lease and a lapsed one", async () => {
    const world = await makeClaimWorld();
    expect(await world.gen.readClaim(world.target)).toEqual({
      claimed: false,
      leaseLive: false,
      leaseRemainingMs: 0,
    });

    readRunId(await claim(world));
    const live = await world.gen.readClaim(world.target);
    expect(live?.claimed).toBe(true);
    expect(live?.leaseLive).toBe(true);
    expect(live?.leaseRemainingMs).toBeGreaterThan(LEASE_MS - LEASE_SLACK_MS);

    await expireLease(world);
    expect(await world.gen.readClaim(world.target)).toEqual({
      claimed: true,
      leaseLive: false,
      leaseRemainingMs: 0,
    });
  });

  it("a missing row reads undefined", async () => {
    const world = await makeClaimWorld();

    expect(
      await world.gen.readClaim(makeBriefTarget(world.pullRequestId, "ghost")),
    ).toBeUndefined();
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
    const recorded = await world.gen.recordRepoConfig(
      world.target,
      STALE_RUN_ID,
      "{}",
    );

    for (const result of [advanced, renewed, finished, recorded]) {
      expectClaimLost(result);
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

  it("renewLease pushes a lapsed lease forward and leaves updated_at", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));
    await world.harness.raw(
      "update generation set updated_at = now() - interval '1 minute', lease_expires_at = now() - interval '1 second'",
    );
    const before = await world.gen.get(world.target);

    unwrap(await world.gen.renewLease(world.target, runId, LEASE_MS));

    expect(await readLeaseIsLive(world)).toBe(true);
    expect((await world.gen.get(world.target))?.updatedAt).toEqual(
      before?.updatedAt,
    );
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
});

describe("a pull request deleted under a claimed row", () => {
  it("every claim write and claim on the gone row is claim-lost", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));
    await world.harness.raw("delete from pull_request");
    const { gen, target } = world;

    const results = [
      await gen.renewLease(target, runId, LEASE_MS),
      await gen.advanceRun(target, runId, GenerationPhases.GENERATING),
      await gen.recordRepoConfig(target, runId, "{}"),
      await gen.finishRun(target, runId, {
        status: GenerationStatuses.SUCCEEDED,
      }),
      await gen.releaseClaim(target, runId),
      await gen.markFailed(target, FAILED_RUN.failure),
      await gen.markSuperseded(target),
      await gen.markCapped(target),
      await gen.claimRun({ target, leaseMs: LEASE_MS, ...WINDOW }),
      await gen.chargeRun({ target, ...WINDOW }),
    ];

    for (const result of results) {
      expectClaimLost(result);
    }
    expect(await gen.get(target)).toBeUndefined();
    expect(await countAttemptRows(world)).toBe(1);
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

    expectClaimLost(result);
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

describe("endLapsedClaim", () => {
  it("ends a claim whose lease lapsed and clears it", async () => {
    const world = await makeClaimWorld();
    readRunId(await claim(world));
    await expireLease(world);

    const ended = unwrap(
      await world.gen.endLapsedClaim(world.target, FAILED_RUN),
    );

    expect(ended.status).toBe(GenerationStatuses.FAILED);
    expect(ended.errorCode).toBe(GenerationFailureCodes.UNKNOWN);
    expect(ended.runId).toBeNull();
  });

  it("refuses a claim a live lease holds", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));

    expectClaimLost(await world.gen.endLapsedClaim(world.target, FAILED_RUN));
    const row = await world.gen.get(world.target);
    expect(row?.runId).toBe(runId);
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
  });

  it("refuses a row no claim names", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));
    unwrap(
      await world.gen.finishRun(world.target, runId, {
        status: GenerationStatuses.SUCCEEDED,
      }),
    );

    expectClaimLost(await world.gen.endLapsedClaim(world.target, FAILED_RUN));
    const row = await world.gen.get(world.target);
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });
});

describe("endReleasedClaim", () => {
  it("ends a pending row a shutdown released", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));
    unwrap(await world.gen.releaseClaim(world.target, runId));

    const ended = unwrap(
      await world.gen.endReleasedClaim(world.target, FAILED_RUN),
    );

    expect(ended.status).toBe(GenerationStatuses.FAILED);
    expect(ended.errorCode).toBe(GenerationFailureCodes.UNKNOWN);
  });

  it("refuses a row a claim names", async () => {
    const world = await makeClaimWorld();
    const runId = readRunId(await claim(world));
    await expireLease(world);

    expectClaimLost(await world.gen.endReleasedClaim(world.target, FAILED_RUN));
    expect((await world.gen.get(world.target))?.runId).toBe(runId);
  });

  it("refuses an awaiting-trigger row", async () => {
    const world = await makeClaimWorld();
    await world.harness.raw(
      "update generation set status = 'awaiting-trigger'",
    );

    expectClaimLost(await world.gen.endReleasedClaim(world.target, FAILED_RUN));
    const row = await world.gen.get(world.target);
    expect(row?.status).toBe(GenerationStatuses.AWAITING_TRIGGER);
  });
});

describe("settleStoredBrief", () => {
  it("leaves a row re-projected after the rerun was picked up", async () => {
    const world = await makeClaimWorld();
    await world.harness.raw(
      "update generation set updated_at = now() + interval '1 minute'",
    );

    expect(
      await world.gen.settleStoredBrief(world.target, new Date()),
    ).toBeUndefined();
    expect((await world.gen.get(world.target))?.status).toBe(
      GenerationStatuses.PENDING,
    );
  });

  it("turns a failed row into succeeded and clears its error", async () => {
    const world = await makeClaimWorld();
    await world.gen.markFailed(world.target, {
      code: GenerationFailureCodes.UNKNOWN,
      params: { detail: "boom" },
    });

    const settled = await world.gen.settleStoredBrief(
      world.target,
      readLater(),
    );

    expect(settled?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(settled?.errorCode).toBeNull();
    expect(settled?.errorParams).toBeNull();
  });

  it("leaves a failed row a live lease holds", async () => {
    const world = await makeClaimWorld();
    readRunId(await claim(world));
    await world.harness.raw("update generation set status = 'failed'");

    expect(
      await world.gen.settleStoredBrief(world.target, readLater()),
    ).toBeUndefined();
    expect((await world.gen.get(world.target))?.status).toBe(
      GenerationStatuses.FAILED,
    );
  });

  it("settles a released pending row and leaves a succeeded one", async () => {
    const world = await makeClaimWorld();

    const settled = await world.gen.settleStoredBrief(
      world.target,
      readLater(),
    );

    expect(settled?.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(
      await world.gen.settleStoredBrief(world.target, readLater()),
    ).toBeUndefined();
  });

  it("leaves a running row of the previous release alone", async () => {
    const world = await makeClaimWorld();
    await world.harness.raw("update generation set status = 'running'");

    expect(
      await world.gen.settleStoredBrief(world.target, readLater()),
    ).toBeUndefined();
  });
});

describe("supersedeStaleBriefs and the claim", () => {
  it("leaves a stale head a live lease holds", async () => {
    const world = await makeClaimWorld();
    readRunId(await claim(world));
    const current = makeBriefTarget(world.pullRequestId, "current");
    await world.gen.upsertPending(current);
    await succeedTestRun(world.gen, current);
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
