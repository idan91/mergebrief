// A pusher's Regenerate on a failed head: a fresh claim budget and the PR's
// job queued again, or a refusal that writes nothing.
import { describe, expect, it } from "vitest";
import {
  ClaimOutcomes,
  createArtifactStore,
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  MAX_GENERATION_ATTEMPTS,
  RegenerateOutcomes,
  type ClaimOutcome,
  type GenerationFailure,
  type GenerationProjection,
  type GenerationRow,
  type OwnerContext,
  type ScopeContext,
  type TenantContext,
} from "../src/index";
import { claimTestRun, succeedTestRun } from "../src/testing";
import {
  isInstallationId,
  isRepoId,
  isReviewerId,
  type PullRequestRowId,
} from "../src/types";
import { GenerationFailureCodes, GenerationStatuses, PrStates } from "types";
import { brandWith, makeBriefTarget, registerSharedPglite } from "./helpers";

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
const REGENERATE_DELAY_SECONDS = 10;
const DELAY_SLACK_SECONDS = 2;
const TIMEOUT: GenerationFailure = {
  code: GenerationFailureCodes.PROVIDER_TIMEOUT,
};

interface RegenerateWorld {
  readonly gen: GenerationProjection;
  readonly pullRequestId: PullRequestRowId;
  readonly target: ReturnType<typeof makeBriefTarget>;
}

const shared = registerSharedPglite();

async function makeWorld(headSha = HEAD): Promise<RegenerateWorld> {
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
  world: RegenerateWorld,
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

async function readRow(world: RegenerateWorld): Promise<GenerationRow> {
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

async function claimOutcome(world: RegenerateWorld): Promise<ClaimOutcome> {
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

async function storeBrief(world: RegenerateWorld): Promise<void> {
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
    body: "stored",
    usedGroupIds: [],
  });
}

function regenerate(world: RegenerateWorld, ctx: ScopeContext = CTX) {
  return createIngestRoutines(shared.handle, ctx).regenerateFailedHead({
    pullRequestId: world.pullRequestId,
  });
}

describe("regenerateFailedHead", () => {
  it("projects a failed head pending with no claims and queues its job", async () => {
    const world = await makeWorld();
    await failHead(world);

    const outcome = await regenerate(world);

    expect(outcome).toBe(RegenerateOutcomes.QUEUED);
    const row = await readRow(world);
    expect(row.status).toBe(GenerationStatuses.PENDING);
    expect(row.claims).toBe(0);
    expect(row.errorCode).toBeNull();
    expect(row.runId).toBeNull();
    const jobs = await readJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["key"]).toBe(`generate:${world.pullRequestId}`);
    expect(jobs[0]?.["head"]).toBe(HEAD);
    const delay = Number(jobs[0]?.["delay"]);
    expect(delay).toBeGreaterThan(
      REGENERATE_DELAY_SECONDS - DELAY_SLACK_SECONDS,
    );
    expect(delay).toBeLessThanOrEqual(REGENERATE_DELAY_SECONDS);
  });

  it("pulls a failed head's waiting retry job in to the short window", async () => {
    const world = await makeWorld();
    await failHead(world);
    await createIngestRoutines(shared.handle, CTX).requeueGenerateJob({
      pullRequestId: world.pullRequestId,
      headSha: HEAD,
      delaySeconds: 600,
    });

    await regenerate(world);

    const jobs = await readJobs();
    expect(jobs).toHaveLength(1);
    expect(Number(jobs[0]?.["delay"])).toBeLessThanOrEqual(
      REGENERATE_DELAY_SECONDS,
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

    expect(await regenerate(world)).toBe(RegenerateOutcomes.QUEUED);

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

  it("answers held under a live lease and writes nothing", async () => {
    const world = await makeWorld();
    const runId = await claimTestRun(world.gen, world.target);
    const before = await readRow(world);

    const outcome = await regenerate(world);

    expect(outcome).toBe(RegenerateOutcomes.HELD);
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

    const outcome = await regenerate(world);

    expect(outcome).toBe(RegenerateOutcomes.QUEUED);
    expect((await readRow(world)).status).toBe(GenerationStatuses.PENDING);
    const jobs = await readJobs();
    expect(jobs.map((job) => job["key"])).toEqual([
      null,
      `generate:${world.pullRequestId}`,
    ]);
  });

  it("answers held under a live claim beside a stale locked job", async () => {
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

    const outcome = await regenerate(world);

    expect(outcome).toBe(RegenerateOutcomes.HELD);
    expect((await readRow(world)).runId).toBe(runId);
    expect(await readJobs()).toHaveLength(1);
  });

  it("refuses a succeeded head as not regenerable", async () => {
    const world = await makeWorld();
    await succeedTestRun(world.gen, world.target);

    const outcome = await regenerate(world);

    expect(outcome).toBe(RegenerateOutcomes.NOT_REGENERABLE);
    expect((await readRow(world)).status).toBe(GenerationStatuses.SUCCEEDED);
    expect(await readJobs()).toHaveLength(0);
  });

  it.each([
    [
      "superseded",
      (gen: GenerationProjection, target: RegenerateWorld["target"]) =>
        gen.markSuperseded(target),
    ],
    [
      "capped",
      (gen: GenerationProjection, target: RegenerateWorld["target"]) =>
        gen.markCapped(target),
    ],
  ])("refuses a %s head as not regenerable", async (_status, settle) => {
    const world = await makeWorld();
    await settle(world.gen, world.target);

    expect(await regenerate(world)).toBe(RegenerateOutcomes.NOT_REGENERABLE);
    expect(await readJobs()).toHaveLength(0);
  });

  it.each([
    GenerationFailureCodes.DIFF_TOO_LARGE,
    GenerationFailureCodes.OUTPUT_SECRET,
    GenerationFailureCodes.PROVIDER_REFUSAL,
  ])("refuses a head failed with %s as not regenerable", async (code) => {
    const world = await makeWorld();
    await failHead(world, { code });

    expect(await regenerate(world)).toBe(RegenerateOutcomes.NOT_REGENERABLE);
    expect((await readRow(world)).errorCode).toBe(code);
    expect(await readJobs()).toHaveLength(0);
  });

  it.each([PrStates.CLOSED, PrStates.MERGED] as const)(
    "refuses a %s pull request's failed head as not regenerable",
    async (state) => {
      const world = await makeWorld();
      await failHead(world);
      await closePullRequest(state);

      expect(await regenerate(world)).toBe(RegenerateOutcomes.NOT_REGENERABLE);
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

    expect(await regenerate(world)).toBe(RegenerateOutcomes.NOT_REGENERABLE);
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

    expect(await regenerate(world)).toBe(RegenerateOutcomes.NOT_REGENERABLE);
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
    ).regenerateFailedHead({ pullRequestId: pr.id });

    expect(outcome).toBe(RegenerateOutcomes.NOT_REGENERABLE);
  });

  it("answers not found for a pull request outside the scope", async () => {
    const world = await makeWorld();
    await failHead(world);

    expect(await regenerate(world, OTHER_CTX)).toBe(
      RegenerateOutcomes.NOT_FOUND,
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

    expect(await regenerate(world, ownerCtx)).toBe(
      RegenerateOutcomes.NOT_FOUND,
    );
    expect(await readJobs()).toHaveLength(0);
  });
});
