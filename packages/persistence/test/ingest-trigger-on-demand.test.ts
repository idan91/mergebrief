// A pusher's click on a failed or awaiting-trigger head: a fresh claim budget
// and the PR's job queued again, or a refusal that writes nothing.
import { describe, expect, it } from "vitest";
import {
  ClaimOutcomes,
  createArtifactStore,
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  GenerationErrorCodes,
  MAX_GENERATION_ATTEMPTS,
  TriggerOnDemandOutcomes,
  type ClaimOutcome,
  type GenerationFailure,
  type GenerationProjection,
  type GenerationRow,
  type OwnerContext,
  type ScopeContext,
  type TenantContext,
} from "../src/index";
import { TRIGGER_ON_DEMAND_DELAY_SECONDS } from "../src/stores/ingest";
import { claimTestRun, succeedTestRun } from "../src/testing";
import {
  isInstallationId,
  isRepoId,
  isReviewerId,
  type PullRequestRowId,
} from "../src/types";
import { GenerationFailureCodes, GenerationStatuses, PrStates } from "types";
import { brandWith, makeBriefTarget, registerSharedPglite } from "./helpers";
import { STORED_BODY_VERSION } from "brief-core/artifact";

const CTX: TenantContext = {
  installationId: brandWith(isInstallationId, 1000n),
};
const OTHER_CTX: TenantContext = {
  installationId: brandWith(isInstallationId, 2000n),
};
const HEAD = "a".repeat(40);
const OLDER_HEAD = "b".repeat(40);
const BASE = "c".repeat(40);
const LAPSED_LEASE = { leaseMs: 0 } as const;
const ANY_DAY = {
  from: new Date(0),
  to: new Date("2100-01-01T00:00:00.000Z"),
} as const;
const DELAY_SLACK_SECONDS = 2;
const APPROVER = brandWith(isReviewerId, 900n);
const LATER_APPROVER = brandWith(isReviewerId, 901n);
const TIMEOUT: GenerationFailure = {
  code: GenerationFailureCodes.PROVIDER_TIMEOUT,
};

interface TriggerOnDemandWorld {
  readonly gen: GenerationProjection;
  readonly pullRequestId: PullRequestRowId;
  readonly target: ReturnType<typeof makeBriefTarget>;
}

const shared = registerSharedPglite();

async function makeWorld(headSha = HEAD): Promise<TriggerOnDemandWorld> {
  const pr = await createTenantRepository(
    shared.handle,
    CTX,
  ).pullRequests.upsert({
    repoId: brandWith(isRepoId, 777n),
    prNumber: 7,
    state: PrStates.OPEN,
  });
  const gen = createGenerationProjection(shared.handle, CTX);
  const target = makeBriefTarget(pr.id, headSha);
  await gen.upsertPending(target);
  return { gen, pullRequestId: pr.id, target };
}

async function failHead(
  world: TriggerOnDemandWorld,
  failure: GenerationFailure = TIMEOUT,
): Promise<void> {
  const runId = await claimTestRun(world.gen, world.target);
  const finished = await world.gen.finishRun(world.target, runId, {
    status: GenerationStatuses.FAILED,
    failure,
  });
  if (!finished.ok) {
    throw new Error(finished.error.message);
  }
}

async function readRow(world: TriggerOnDemandWorld): Promise<GenerationRow> {
  const row = await world.gen.get(world.target);
  if (row === undefined) {
    throw new Error("expected the head's generation row");
  }
  return row;
}

async function readJobs(): Promise<Record<string, unknown>[]> {
  return shared.harness.raw(
    "select key, payload->>'head_sha' as head, extract(epoch from (run_at - now()))::float8 as delay from graphile_worker.jobs order by id",
  );
}

async function readJobRunAts(): Promise<Record<string, unknown>[]> {
  return shared.harness.raw(
    "select key, run_at from graphile_worker.jobs order by id",
  );
}

async function claimOutcome(
  world: TriggerOnDemandWorld,
): Promise<ClaimOutcome> {
  const claimed = await world.gen.claimRun({
    target: world.target,
    ...LAPSED_LEASE,
    ...ANY_DAY,
  });
  if (!claimed.ok) {
    throw new Error(claimed.error.message);
  }
  return claimed.value.kind;
}

async function closePullRequest(
  state: typeof PrStates.CLOSED | typeof PrStates.MERGED,
): Promise<void> {
  await createTenantRepository(shared.handle, CTX).pullRequests.upsert({
    repoId: brandWith(isRepoId, 777n),
    prNumber: 7,
    state,
    closedAt: new Date(),
  });
}

async function storeBrief(world: TriggerOnDemandWorld): Promise<void> {
  await createTenantRepository(shared.handle, CTX).pullRequests.upsert({
    repoId: brandWith(isRepoId, 777n),
    prNumber: 7,
    state: PrStates.OPEN,
    baseSha: BASE,
  });
  await createArtifactStore(shared.handle, CTX).briefs.write({
    pullRequestId: world.pullRequestId,
    baseSha: BASE,
    headSha: HEAD,
    headIndex: 1,
    commitCount: 1,
    provider: "anthropic",
    model: "opus",
    effort: "high",
    bodyVersion: STORED_BODY_VERSION,
    body: '{"v":"stored"}',
    usedGroupIds: [],
  });
}

function triggerOnDemand(
  world: TriggerOnDemandWorld,
  ctx: ScopeContext = CTX,
  approverId = APPROVER,
) {
  return createIngestRoutines(shared.handle, ctx).triggerOnDemand({
    pullRequestId: world.pullRequestId,
    approverId,
  });
}

/** A PR whose author owes a Trigger approval, as the webhook's gate leaves it. */
async function makeGatedWorld(): Promise<TriggerOnDemandWorld> {
  const triggered = await createIngestRoutines(
    shared.handle,
    CTX,
  ).triggerGeneration({
    pullRequest: {
      repoId: brandWith(isRepoId, 777n),
      prNumber: 7,
      state: PrStates.OPEN,
    },
    headSha: HEAD,
    debounceSeconds: 0,
    requiresTriggerApproval: true,
  });
  const pullRequestId = triggered.pullRequest.id;
  const gen = createGenerationProjection(shared.handle, CTX);
  return { gen, pullRequestId, target: makeBriefTarget(pullRequestId, HEAD) };
}

async function readApproval(world: TriggerOnDemandWorld) {
  const pr = await createTenantRepository(
    shared.handle,
    CTX,
  ).pullRequests.getById(world.pullRequestId);
  if (pr === undefined) {
    throw new Error("expected the pull request row");
  }
  return { by: pr.triggerApprovedBy, at: pr.triggerApprovedAt };
}

describe("triggerOnDemand", () => {
  it("projects a failed head pending with no claims and queues its job", async () => {
    const world = await makeWorld();
    await failHead(world);

    const outcome = await triggerOnDemand(world);

    expect(outcome).toBe(TriggerOnDemandOutcomes.QUEUED);
    const row = await readRow(world);
    expect(row.status).toBe(GenerationStatuses.PENDING);
    expect(row.claims).toBe(0);
    expect(row.errorCode).toBeNull();
    expect(row.runId).toBeNull();
    expect(row.generateRequestedAt).not.toBeNull();
    const jobs = await readJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["key"]).toBe(`generate:${world.pullRequestId}`);
    expect(jobs[0]?.["head"]).toBe(HEAD);
    const delay = Number(jobs[0]?.["delay"]);
    expect(delay).toBeGreaterThan(
      TRIGGER_ON_DEMAND_DELAY_SECONDS - DELAY_SLACK_SECONDS,
    );
    expect(delay).toBeLessThanOrEqual(TRIGGER_ON_DEMAND_DELAY_SECONDS);
  });

  it("pulls a failed head's waiting retry job in to the short window", async () => {
    const world = await makeWorld();
    await failHead(world);
    await createIngestRoutines(shared.handle, CTX).requeueGenerateJob({
      pullRequestId: world.pullRequestId,
      headSha: HEAD,
      delaySeconds: 600,
    });

    await triggerOnDemand(world);

    const jobs = await readJobs();
    expect(jobs).toHaveLength(1);
    expect(Number(jobs[0]?.["delay"])).toBeLessThanOrEqual(
      TRIGGER_ON_DEMAND_DELAY_SECONDS,
    );
  });

  it("gives the head a fresh budget of claims", async () => {
    const world = await makeWorld();
    for (let claim = 0; claim < MAX_GENERATION_ATTEMPTS; claim += 1) {
      await claimTestRun(world.gen, world.target, LAPSED_LEASE);
    }
    expect(await claimOutcome(world)).toBe(ClaimOutcomes.EXHAUSTED);
    const failed = await world.gen.markFailed(world.target, {
      code: GenerationFailureCodes.ATTEMPTS_EXHAUSTED,
    });
    expect(failed.ok).toBe(true);

    expect(await triggerOnDemand(world)).toBe(TriggerOnDemandOutcomes.QUEUED);

    const claims = [];
    for (let claim = 0; claim <= MAX_GENERATION_ATTEMPTS; claim += 1) {
      claims.push(await claimOutcome(world));
    }
    const budget = Array.from(
      { length: MAX_GENERATION_ATTEMPTS },
      () => ClaimOutcomes.CLAIMED,
    );
    expect(claims).toEqual([...budget, ClaimOutcomes.EXHAUSTED]);
  });

  it("answers running under a live lease and writes nothing", async () => {
    const world = await makeWorld();
    const runId = await claimTestRun(world.gen, world.target);
    const before = await readRow(world);

    const outcome = await triggerOnDemand(world);

    expect(outcome).toBe(TriggerOnDemandOutcomes.RUNNING);
    const after = await readRow(world);
    expect(after.runId).toBe(runId);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await readJobs()).toHaveLength(0);
  });

  it("queues past a job a dead worker left locked an hour ago", async () => {
    const world = await makeWorld();
    await failHead(world);
    await createIngestRoutines(shared.handle, CTX).requeueGenerateJob({
      pullRequestId: world.pullRequestId,
      headSha: HEAD,
      delaySeconds: 0,
    });
    await shared.harness.raw(
      "update graphile_worker.jobs set locked_at = now() - interval '1 hour'",
    );

    const outcome = await triggerOnDemand(world);

    expect(outcome).toBe(TriggerOnDemandOutcomes.QUEUED);
    expect((await readRow(world)).status).toBe(GenerationStatuses.PENDING);
    const jobs = await readJobs();
    expect(jobs.map((job) => job["key"])).toEqual([
      null,
      `generate:${world.pullRequestId}`,
    ]);
  });

  it("answers running under a live claim beside a stale locked job", async () => {
    const world = await makeWorld();
    await failHead(world);
    await createIngestRoutines(shared.handle, CTX).requeueGenerateJob({
      pullRequestId: world.pullRequestId,
      headSha: HEAD,
      delaySeconds: 0,
    });
    await shared.harness.raw(
      "update graphile_worker.jobs set locked_at = now() - interval '1 hour'",
    );
    const runId = await claimTestRun(world.gen, world.target);

    const outcome = await triggerOnDemand(world);

    expect(outcome).toBe(TriggerOnDemandOutcomes.RUNNING);
    expect((await readRow(world)).runId).toBe(runId);
    expect(await readJobs()).toHaveLength(1);
  });

  it("refuses a succeeded head as not regenerable", async () => {
    const world = await makeWorld();
    await succeedTestRun(world.gen, world.target);

    const outcome = await triggerOnDemand(world);

    expect(outcome).toBe(TriggerOnDemandOutcomes.NOT_REGENERABLE);
    expect((await readRow(world)).status).toBe(GenerationStatuses.SUCCEEDED);
    expect(await readJobs()).toHaveLength(0);
  });

  it.each([
    [
      "superseded",
      (gen: GenerationProjection, target: TriggerOnDemandWorld["target"]) =>
        gen.markSuperseded(target),
    ],
    [
      "capped",
      (gen: GenerationProjection, target: TriggerOnDemandWorld["target"]) =>
        gen.markCapped(target),
    ],
  ])("refuses a %s head as not regenerable", async (_status, settle) => {
    const world = await makeWorld();
    await settle(world.gen, world.target);

    expect(await triggerOnDemand(world)).toBe(
      TriggerOnDemandOutcomes.NOT_REGENERABLE,
    );
    expect(await readJobs()).toHaveLength(0);
  });

  it.each([
    GenerationFailureCodes.DIFF_TOO_LARGE,
    GenerationFailureCodes.OUTPUT_SECRET,
    GenerationFailureCodes.PROVIDER_REFUSAL,
  ])("refuses a head failed with %s as not regenerable", async (code) => {
    const world = await makeWorld();
    await failHead(world, { code });

    expect(await triggerOnDemand(world)).toBe(
      TriggerOnDemandOutcomes.NOT_REGENERABLE,
    );
    expect((await readRow(world)).errorCode).toBe(code);
    expect(await readJobs()).toHaveLength(0);
  });

  it.each([PrStates.CLOSED, PrStates.MERGED] as const)(
    "refuses a %s pull request's failed head as not regenerable",
    async (state) => {
      const world = await makeWorld();
      await failHead(world);
      await closePullRequest(state);

      expect(await triggerOnDemand(world)).toBe(
        TriggerOnDemandOutcomes.NOT_REGENERABLE,
      );
      const row = await readRow(world);
      expect(row.status).toBe(GenerationStatuses.FAILED);
      expect(row.errorCode).toBe(TIMEOUT.code);
      expect(await readJobs()).toHaveLength(0);
    },
  );

  it("refuses a failed head whose brief is stored as not regenerable", async () => {
    const world = await makeWorld();
    await failHead(world);
    await storeBrief(world);

    expect(await triggerOnDemand(world)).toBe(
      TriggerOnDemandOutcomes.NOT_REGENERABLE,
    );
    expect((await readRow(world)).status).toBe(GenerationStatuses.FAILED);
    expect(await readJobs()).toHaveLength(0);
  });

  it("acts on the current push, not an older failed head", async () => {
    const world = await makeWorld(OLDER_HEAD);
    await failHead(world);
    const current = makeBriefTarget(world.pullRequestId, HEAD);
    await world.gen.upsertPending(current);
    await shared.harness.raw(
      `update generation set triggered_at = now() + interval '1 second' where head_sha = '${HEAD}'`,
    );

    expect(await triggerOnDemand(world)).toBe(
      TriggerOnDemandOutcomes.NOT_REGENERABLE,
    );
    expect((await readRow(world)).status).toBe(GenerationStatuses.FAILED);
  });

  it("refuses a pull request with no brief generation as not regenerable", async () => {
    const pr = await createTenantRepository(
      shared.handle,
      CTX,
    ).pullRequests.upsert({
      repoId: brandWith(isRepoId, 777n),
      prNumber: 8,
      state: PrStates.OPEN,
    });

    const outcome = await createIngestRoutines(
      shared.handle,
      CTX,
    ).triggerOnDemand({ pullRequestId: pr.id, approverId: APPROVER });

    expect(outcome).toBe(TriggerOnDemandOutcomes.NOT_REGENERABLE);
  });

  it("answers not found for a pull request outside the scope", async () => {
    const world = await makeWorld();
    await failHead(world);

    expect(await triggerOnDemand(world, OTHER_CTX)).toBe(
      TriggerOnDemandOutcomes.NOT_FOUND,
    );
    expect((await readRow(world)).status).toBe(GenerationStatuses.FAILED);
    expect(await readJobs()).toHaveLength(0);
  });

  it("answers not found under an owner scope", async () => {
    const world = await makeWorld();
    await failHead(world);
    const ownerCtx: OwnerContext = {
      ownerUserId: brandWith(isReviewerId, 42n),
    };

    expect(await triggerOnDemand(world, ownerCtx)).toBe(
      TriggerOnDemandOutcomes.NOT_FOUND,
    );
    expect(await readJobs()).toHaveLength(0);
  });

  it("approves an awaiting-trigger head and queues its job", async () => {
    const world = await makeGatedWorld();
    expect((await readRow(world)).status).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );

    const outcome = await triggerOnDemand(world);

    expect(outcome).toBe(TriggerOnDemandOutcomes.QUEUED);
    expect((await readRow(world)).status).toBe(GenerationStatuses.PENDING);
    const approval = await readApproval(world);
    expect(approval.by).toBe(APPROVER);
    expect(approval.at).toBeInstanceOf(Date);
    const jobs = await readJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["head"]).toBe(HEAD);
    expect(Number(jobs[0]?.["delay"])).toBeLessThanOrEqual(
      TRIGGER_ON_DEMAND_DELAY_SECONDS,
    );
  });

  it("stamps the approved head so its runs skip the trigger conditions", async () => {
    const world = await makeGatedWorld();

    await triggerOnDemand(world);

    expect((await readRow(world)).generateRequestedAt).not.toBeNull();
  });

  it("keeps the first approval when a later click approves again", async () => {
    const world = await makeGatedWorld();
    await triggerOnDemand(world);
    const first = await readApproval(world);
    // The hold refuses an approved PR, so the held row is staged directly.
    await shared.harness.raw(
      "update generation set status = 'awaiting-trigger'",
    );

    expect(await triggerOnDemand(world, CTX, LATER_APPROVER)).toBe(
      TriggerOnDemandOutcomes.QUEUED,
    );

    expect(await readApproval(world)).toEqual(first);
  });

  it("refuses a closed pull request awaiting its trigger, approving nothing", async () => {
    const world = await makeGatedWorld();
    const jobsBefore = await readJobs();
    await closePullRequest(PrStates.CLOSED);

    expect(await triggerOnDemand(world)).toBe(
      TriggerOnDemandOutcomes.NOT_REGENERABLE,
    );
    expect(await readApproval(world)).toEqual({ by: null, at: null });
    expect((await readRow(world)).status).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(await readJobs()).toHaveLength(jobsBefore.length);
  });

  it("keeps an approved head pending against an older bot run's hold", async () => {
    const world = await makeWorld();
    const first = await world.gen.markAwaitingTrigger(world.target);
    expect(first.ok).toBe(true);
    expect(await triggerOnDemand(world)).toBe(TriggerOnDemandOutcomes.QUEUED);

    const stale = await world.gen.markAwaitingTrigger(world.target);

    expect(!stale.ok && stale.error.code).toBe(
      GenerationErrorCodes.TRIGGER_APPROVED,
    );
    expect((await readRow(world)).status).toBe(GenerationStatuses.PENDING);
  });

  it("approves a gated head past a job a dead worker left locked", async () => {
    const world = await makeGatedWorld();
    await shared.harness.raw(
      "update graphile_worker.jobs set locked_at = now() - interval '1 hour'",
    );

    expect(await triggerOnDemand(world)).toBe(TriggerOnDemandOutcomes.QUEUED);

    expect((await readApproval(world)).by).toBe(APPROVER);
    expect((await readRow(world)).status).toBe(GenerationStatuses.PENDING);
    const jobs = await readJobs();
    expect(jobs.map((job) => job["key"])).toEqual([
      null,
      `generate:${world.pullRequestId}`,
    ]);
  });

  it("writes no approval when it regenerates a failed head", async () => {
    const world = await makeWorld();
    await failHead(world);

    expect(await triggerOnDemand(world)).toBe(TriggerOnDemandOutcomes.QUEUED);

    expect(await readApproval(world)).toEqual({ by: null, at: null });
  });

  it("refuses an awaiting-trigger head when the caller names no approver", async () => {
    const world = await makeGatedWorld();
    const jobsBefore = await readJobRunAts();

    const outcome = await createIngestRoutines(
      shared.handle,
      CTX,
    ).triggerOnDemand({ pullRequestId: world.pullRequestId });

    expect(outcome).toBe(TriggerOnDemandOutcomes.NEEDS_APPROVER);
    expect(await readApproval(world)).toEqual({ by: null, at: null });
    expect((await readRow(world)).status).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(await readJobRunAts()).toEqual(jobsBefore);
  });

  it("regenerates a failed head for a caller that names no approver", async () => {
    const world = await makeWorld();
    await failHead(world);

    const outcome = await createIngestRoutines(
      shared.handle,
      CTX,
    ).triggerOnDemand({ pullRequestId: world.pullRequestId });

    expect(outcome).toBe(TriggerOnDemandOutcomes.QUEUED);
  });
});
