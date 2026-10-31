// Spend units: a run's attempt row carries the units it paid for, the daily
// cap sums them, and a run claims more under the same instance lock.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { internal } from "../src/db/handle";
import {
  ChargeOutcomes,
  ClaimOutcomes,
  createGenerationProjection,
  createTenantRepository,
  readSpendBreakdown,
  type GenerationProjection,
  type OwnerContext,
  type TenantContext,
  utcDayBounds,
} from "../src/index";
import {
  isInstallationId,
  isRepoId,
  isReviewerId,
  type InstallationId,
  type RepoId,
} from "../src/types";
import { generationAttempt } from "../src/schema/generation-attempt";
import { PrStates } from "types";
import { brandWith, makeBriefTarget, registerSharedPglite } from "./helpers";

const TENANT: InstallationId = brandWith(isInstallationId, 3100n);
const OTHER_TENANT: InstallationId = brandWith(isInstallationId, 3200n);
const REPO: RepoId = brandWith(isRepoId, 3101n);
const CTX: TenantContext = { installationId: TENANT };
const OWNER_CTX: OwnerContext = {
  ownerUserId: brandWith(isReviewerId, 3301n),
};
const OTHER_OWNER_CTX: OwnerContext = {
  ownerUserId: brandWith(isReviewerId, 3302n),
};
const LEASE_MS = 120_000;
const DAY = utcDayBounds(new Date());
const BEFORE_MIDNIGHT = new Date("2026-10-27T23:58:00Z");
const YESTERDAY = utcDayBounds(BEFORE_MIDNIGHT);
const TODAY = utcDayBounds(new Date("2026-10-28T00:02:00Z"));

const shared = registerSharedPglite();

interface UnitsHarness {
  readonly projection: GenerationProjection;
  /** Claim one fresh head and answer its run id. */
  startRun(head: string): Promise<string>;
}

async function moveAttemptStart(runId: string, startedAt: Date): Promise<void> {
  await internal(shared.handle)
    .update(generationAttempt)
    .set({ startedAt })
    .where(eq(generationAttempt.runId, runId));
}

async function makeUnitsHarness(
  ctx: TenantContext | OwnerContext = CTX,
): Promise<UnitsHarness> {
  const { handle } = shared;
  const pr = await createTenantRepository(handle, ctx).pullRequests.upsert({
    repoId: REPO,
    prNumber: 31,
    state: PrStates.OPEN,
    repoSlug: "acme/units",
  });
  const projection = createGenerationProjection(handle, ctx);
  return {
    projection,
    async startRun(head) {
      const target = makeBriefTarget(pr.id, head);
      await projection.upsertPending(target);
      const claimed = await projection.claimRun({
        target,
        leaseMs: LEASE_MS,
        ...DAY,
      });
      if (!claimed.ok || claimed.value.kind !== ClaimOutcomes.CLAIMED) {
        throw new Error("expected a claim");
      }
      return claimed.value.runId;
    },
  };
}

describe("claimUnits", () => {
  it("adds the units to the run and the daily count sums them", async () => {
    const { projection, startRun } = await makeUnitsHarness();
    const runId = await startRun("large");
    await startRun("small");

    const claimed = await projection.claimUnits({ runId, units: 4, ...DAY });

    expect(claimed).toEqual({
      ok: true,
      value: { kind: ChargeOutcomes.CHARGED },
    });
    expect(await projection.countStartedRuns(DAY)).toBe(6);
  });

  it("claims up to the cap exactly", async () => {
    const { projection, startRun } = await makeUnitsHarness();
    const runId = await startRun("fits");

    const claimed = await projection.claimUnits({
      runId,
      units: 4,
      cap: 5,
      ...DAY,
    });

    expect(claimed.ok && claimed.value.kind).toBe(ChargeOutcomes.CHARGED);
    expect(await projection.countStartedRuns(DAY)).toBe(5);
  });

  it("refuses past the cap with the units needed and left", async () => {
    const { projection, startRun } = await makeUnitsHarness();
    const runId = await startRun("too-large");
    await startRun("other");

    const claimed = await projection.claimUnits({
      runId,
      units: 4,
      cap: 5,
      ...DAY,
    });

    expect(claimed).toEqual({
      ok: true,
      value: { kind: ChargeOutcomes.CAPPED, needed: 4, left: 3 },
    });
    expect(await projection.countStartedRuns(DAY)).toBe(2);
  });

  it("answers no units left once the day is over the cap", async () => {
    const { projection, startRun } = await makeUnitsHarness();
    const runId = await startRun("over");
    await startRun("second");

    const claimed = await projection.claimUnits({
      runId,
      units: 2,
      cap: 1,
      ...DAY,
    });

    expect(claimed).toEqual({
      ok: true,
      value: { kind: ChargeOutcomes.CAPPED, needed: 2, left: 0 },
    });
  });

  it("books units claimed after midnight on the claim day", async () => {
    const { projection, startRun } = await makeUnitsHarness();
    const runId = await startRun("crosses-midnight");
    await moveAttemptStart(runId, BEFORE_MIDNIGHT);

    const claimed = await projection.claimUnits({ runId, units: 3, ...TODAY });

    expect(claimed.ok && claimed.value.kind).toBe(ChargeOutcomes.CHARGED);
    expect(await projection.countStartedRuns(TODAY)).toBe(4);
    expect(await projection.countStartedRuns(YESTERDAY)).toBe(0);
  });

  it("caps a post-midnight claim with the units the run carries", async () => {
    const { projection, startRun } = await makeUnitsHarness();
    const runId = await startRun("carried");
    await projection.claimUnits({ runId, units: 2, ...YESTERDAY });
    await moveAttemptStart(runId, BEFORE_MIDNIGHT);

    const claimed = await projection.claimUnits({
      runId,
      units: 3,
      cap: 5,
      ...TODAY,
    });

    expect(claimed).toEqual({
      ok: true,
      value: { kind: ChargeOutcomes.CAPPED, needed: 3, left: 2 },
    });
    expect(await projection.countStartedRuns(YESTERDAY)).toBe(3);
  });

  it("answers claim-lost for a run id no attempt row holds", async () => {
    const { projection } = await makeUnitsHarness();

    const claimed = await projection.claimUnits({
      runId: "00000000-0000-4000-8000-000000000000",
      units: 1,
      ...DAY,
    });

    expect(!claimed.ok && claimed.error.code).toBe("claim-lost");
  });

  it("answers claim-lost for another tenant's run", async () => {
    const { startRun } = await makeUnitsHarness();
    const runId = await startRun("mine");
    const foreign = createGenerationProjection(shared.handle, {
      installationId: OTHER_TENANT,
    });

    const claimed = await foreign.claimUnits({ runId, units: 1, ...DAY });

    expect(!claimed.ok && claimed.error.code).toBe("claim-lost");
  });

  it("answers claim-lost for another url-box owner's run", async () => {
    const { startRun } = await makeUnitsHarness(OWNER_CTX);
    const runId = await startRun("owned");
    const foreign = createGenerationProjection(shared.handle, OTHER_OWNER_CTX);

    const claimed = await foreign.claimUnits({ runId, units: 1, ...DAY });
    const recorded = await foreign.recordPartDone(runId);

    expect(!claimed.ok && claimed.error.code).toBe("claim-lost");
    expect(!recorded.ok && recorded.error.code).toBe("claim-lost");
  });

  it("throws on a unit count that is not a positive integer", async () => {
    const { projection, startRun } = await makeUnitsHarness();
    const runId = await startRun("bad-count");

    await expect(
      projection.claimUnits({ runId, units: 0, ...DAY }),
    ).rejects.toThrow(/positive integer/);
  });
});

describe("recordPartDone", () => {
  it("counts the run's finished parts one at a time", async () => {
    const { projection, startRun } = await makeUnitsHarness();
    const runId = await startRun("parts");

    await projection.recordPartDone(runId);
    const second = await projection.recordPartDone(runId);

    expect(second).toEqual({ ok: true, value: 2 });
  });

  it("answers claim-lost for a run id no attempt row holds", async () => {
    const { projection } = await makeUnitsHarness();

    const recorded = await projection.recordPartDone(
      "00000000-0000-4000-8000-000000000000",
    );

    expect(!recorded.ok && recorded.error.code).toBe("claim-lost");
  });
});

describe("readSpendBreakdown", () => {
  it("splits the day's units into all runs and large runs", async () => {
    const { projection, startRun } = await makeUnitsHarness();
    const large = await startRun("large-one");
    const larger = await startRun("large-two");
    await startRun("single");
    await projection.claimUnits({ runId: large, units: 3, ...DAY });
    await projection.claimUnits({ runId: larger, units: 5, ...DAY });

    const breakdown = await readSpendBreakdown(shared.handle, DAY);

    expect(breakdown).toEqual({
      startedUnits: 11,
      largeRuns: { runs: 2, units: 10 },
    });
  });

  it("answers zeros for a day with no runs", async () => {
    const breakdown = await readSpendBreakdown(shared.handle, DAY);

    expect(breakdown).toEqual({
      startedUnits: 0,
      largeRuns: { runs: 0, units: 0 },
    });
  });
});
