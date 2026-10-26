// The Operator's read of one head: how many claims it spent since the last
// trigger, whether the claim limit is spent, and the takeover job's state.
import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createGenerationProjection,
  createIngestRoutines,
  isPullRequestRowId,
  MAX_GENERATION_ATTEMPTS,
  type PullRequestRowId,
  type TenantContext,
} from "../src/index";
import { eq, sql } from "drizzle-orm";
import { internal } from "../src/db/handle";
import { generation } from "../src/schema/generation";
import { stampBriefTriggered } from "../src/stores/generation";
import { getRecoveryJobKey } from "../src/stores/queue";
import { resolveScope } from "../src/stores/scope";
import { GenerationStatuses, PrStates, TakeoverJobStates } from "types";
import {
  GenerationKinds,
  isInstallationId,
  isRepoId,
  type InstallationId,
  type RepoId,
} from "../src/types";
import { claimTestRun, type PgliteHarness } from "../src/testing";
import { brandWith, makeBriefTarget, registerSharedPglite } from "./helpers";
import { STORED_BODY_VERSION } from "brief-core/artifact";

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };
const HEAD = "h1";
const NEXT_HEAD = "h2";
const BASE = "b0";
const LAPSED = { leaseMs: 0 } as const;

let pushClock = Date.parse("2026-10-19T00:00:00Z");

/** A pull_request event's `updated_at`, later on every push like GitHub's. */
function makePushTime(): Date {
  pushClock += 1000;
  return new Date(pushClock);
}

function triggerPush(harness: PgliteHarness, headSha: string) {
  return createIngestRoutines(harness.handle, CTX_A).triggerGeneration({
    pullRequest: {
      repoId: REPO,
      prNumber: 11,
      state: PrStates.OPEN,
      baseSha: BASE,
      githubUpdatedAt: makePushTime(),
    },
    headSha,
    debounceSeconds: 0,
  });
}

/** A review event: no `updated_at`, and its head may be one the PR left. */
function triggerReview(harness: PgliteHarness, headSha: string) {
  return createIngestRoutines(harness.handle, CTX_A).triggerGeneration({
    pullRequest: { repoId: REPO, prNumber: 11, state: PrStates.OPEN },
    headSha,
    debounceSeconds: 0,
  });
}

async function storeBrief(
  harness: PgliteHarness,
  pullRequestId: PullRequestRowId,
  headSha: string,
): Promise<void> {
  await createArtifactStore(harness.handle, CTX_A).briefs.write({
    pullRequestId: brandWith(isPullRequestRowId, pullRequestId),
    baseSha: BASE,
    headSha,
    headIndex: 1,
    commitCount: 1,
    provider: "stub",
    model: "stub",
    effort: "low",
    bodyVersion: STORED_BODY_VERSION,
    body: "{}",
    usedGroupIds: [],
  });
}

const shared = registerSharedPglite();

async function triggerHead() {
  const { harness } = shared;
  const triggered = await triggerPush(harness, HEAD);
  const pullRequestId = triggered.pullRequest.id;
  const projection = createGenerationProjection(harness.handle, CTX_A);
  const target = makeBriefTarget(pullRequestId, HEAD);
  return { harness, pullRequestId, projection, target };
}

describe("readBriefClaims", () => {
  it("reads a freshly triggered head as zero claims, not exhausted", async () => {
    const { projection, pullRequestId } = await triggerHead();

    const claims = await projection.readBriefClaims(pullRequestId);

    expect(claims?.generation.headSha).toBe(HEAD);
    expect(claims?.generation.claims).toBe(0);
    expect(claims?.exhausted).toBe(false);
  });

  it("reads a head whose every claim lapsed as exhausted", async () => {
    const { projection, pullRequestId, target } = await triggerHead();
    for (let claim = 0; claim < MAX_GENERATION_ATTEMPTS; claim += 1) {
      await claimTestRun(projection, target, LAPSED);
    }

    const claims = await projection.readBriefClaims(pullRequestId);

    expect(claims?.generation.claims).toBe(MAX_GENERATION_ATTEMPTS);
    expect(claims?.exhausted).toBe(true);
  });

  it("does not call a head exhausted while its last claim is live", async () => {
    const { projection, pullRequestId, target } = await triggerHead();
    await claimTestRun(projection, target, LAPSED);
    await claimTestRun(projection, target, LAPSED);
    await claimTestRun(projection, target);

    const claims = await projection.readBriefClaims(pullRequestId);

    expect(claims?.generation.claims).toBe(MAX_GENERATION_ATTEMPTS);
    expect(claims?.exhausted).toBe(false);
  });

  it("does not call a succeeded head exhausted", async () => {
    const { projection, pullRequestId, target } = await triggerHead();
    await claimTestRun(projection, target, LAPSED);
    await claimTestRun(projection, target, LAPSED);
    const runId = await claimTestRun(projection, target);
    await projection.finishRun(target, runId, {
      status: GenerationStatuses.SUCCEEDED,
    });

    const claims = await projection.readBriefClaims(pullRequestId);

    expect(claims?.generation.status).toBe(GenerationStatuses.SUCCEEDED);
    expect(claims?.exhausted).toBe(false);
  });

  it("reads the current head over a fresher superseded one", async () => {
    const { harness, projection, pullRequestId } = await triggerHead();
    await triggerPush(harness, NEXT_HEAD);
    await harness.raw(
      "update generation set status = 'superseded', updated_at = now() + interval '1 hour' where head_sha = $1",
      [HEAD],
    );

    const claims = await projection.readBriefClaims(pullRequestId);

    expect(claims?.generation.headSha).toBe(NEXT_HEAD);
  });

  it("reads the newest push while an older head's run finishes after it", async () => {
    const { harness, projection, pullRequestId, target } = await triggerHead();
    const runId = await claimTestRun(projection, target);
    await triggerPush(harness, NEXT_HEAD);
    await projection.finishRun(target, runId, {
      status: GenerationStatuses.SUCCEEDED,
    });

    const claims = await projection.readBriefClaims(pullRequestId);

    expect(claims?.generation.headSha).toBe(NEXT_HEAD);
    expect(claims?.generation.status).toBe(GenerationStatuses.PENDING);
  });

  it("reads a head pushed again after a newer one", async () => {
    const { harness, projection, pullRequestId } = await triggerHead();
    await triggerPush(harness, NEXT_HEAD);

    await triggerPush(harness, HEAD);

    const claims = await projection.readBriefClaims(pullRequestId);
    expect(claims?.generation.headSha).toBe(HEAD);
  });

  it("reads a head pushed back to over its stored brief", async () => {
    const { harness, projection, pullRequestId, target } = await triggerHead();
    const runId = await claimTestRun(projection, target);
    await projection.finishRun(target, runId, {
      status: GenerationStatuses.SUCCEEDED,
    });
    await storeBrief(harness, pullRequestId, HEAD);
    await triggerPush(harness, NEXT_HEAD);

    const pushedBack = await triggerPush(harness, HEAD);

    const claims = await projection.readBriefClaims(pullRequestId);
    expect(pushedBack.coveredBy).toBeDefined();
    expect(claims?.generation.headSha).toBe(HEAD);
    expect(claims?.generation.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("reads a head pushed back to over a brief its run then superseded", async () => {
    const { harness, projection, pullRequestId } = await triggerHead();
    await storeBrief(harness, pullRequestId, HEAD);
    await harness.raw(
      "update generation set status = 'superseded' where head_sha = $1",
      [HEAD],
    );
    await triggerPush(harness, NEXT_HEAD);
    const nextTarget = makeBriefTarget(pullRequestId, NEXT_HEAD);
    const runId = await claimTestRun(projection, nextTarget);
    await projection.finishRun(nextTarget, runId, {
      status: GenerationStatuses.SUCCEEDED,
    });

    await triggerPush(harness, HEAD);

    const claims = await projection.readBriefClaims(pullRequestId);
    const latest = await projection.latestBriefForPullRequests([pullRequestId]);
    expect(claims?.generation.headSha).toBe(HEAD);
    expect(latest.get(pullRequestId)?.headSha).toBe(HEAD);
  });

  it("keeps the newest push when a worker re-projects an older head", async () => {
    const { harness, projection, pullRequestId, target } = await triggerHead();
    const runId = await claimTestRun(projection, target);
    await projection.finishRun(target, runId, {
      status: GenerationStatuses.SUCCEEDED,
    });
    await triggerPush(harness, NEXT_HEAD);

    await projection.upsertPending(target);

    const claims = await projection.readBriefClaims(pullRequestId);
    expect(claims?.generation.headSha).toBe(NEXT_HEAD);
  });

  it("keeps the newest push when a worker projects a head no trigger named", async () => {
    const { projection, pullRequestId } = await triggerHead();

    await projection.upsertPending(makeBriefTarget(pullRequestId, "h7"));

    const claims = await projection.readBriefClaims(pullRequestId);
    expect(claims?.generation.headSha).toBe(HEAD);
  });

  it("keeps the newest push when a late review names an older head", async () => {
    const { harness, projection, pullRequestId } = await triggerHead();
    await triggerPush(harness, NEXT_HEAD);

    await triggerReview(harness, HEAD);

    const claims = await projection.readBriefClaims(pullRequestId);
    expect(claims?.generation.headSha).toBe(NEXT_HEAD);
  });

  it("stamps a trigger with the time it wrote, not its transaction's start", async () => {
    const { harness, pullRequestId } = await triggerHead();
    const db = internal(harness.handle);

    const stampedLater = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_sleep(0.05)`);
      await stampBriefTriggered(tx, resolveScope(CTX_A), pullRequestId, HEAD);
      const stamped = await tx
        .select({
          later: sql<boolean>`${generation.triggeredAt} > now() + interval '40 milliseconds'`,
        })
        .from(generation)
        .where(eq(generation.headSha, HEAD));
      return stamped[0]?.later;
    });

    expect(stampedLater).toBe(true);
  });

  it("never reads a newer delta row as the brief's head", async () => {
    const { projection, pullRequestId } = await triggerHead();
    await projection.upsertPending({
      pullRequestId,
      kind: GenerationKinds.DELTA,
      headSha: "h9",
      baselineSha: HEAD,
    });

    const claims = await projection.readBriefClaims(pullRequestId);

    expect(claims?.generation.headSha).toBe(HEAD);
  });

  it("returns undefined for a PR outside the caller's tenant", async () => {
    const { harness, pullRequestId } = await triggerHead();
    const other = createGenerationProjection(harness.handle, CTX_B);

    expect(await other.readBriefClaims(pullRequestId)).toBeUndefined();
  });
});

describe("readTakeoverJob", () => {
  async function queueTakeover(
    harness: Awaited<ReturnType<typeof triggerHead>>["harness"],
    jobKey: string,
    delaySeconds: number,
  ) {
    await harness.raw(
      "select graphile_worker.add_job('recover-generation', '{}'::json, $1, now() + make_interval(secs => $2))",
      [jobKey, delaySeconds],
    );
  }

  it("reads a waiting takeover as scheduled with its start time", async () => {
    const { harness, projection, pullRequestId } = await triggerHead();
    await queueTakeover(harness, getRecoveryJobKey(pullRequestId, HEAD), 125);

    const takeover = await projection.readTakeoverJob(pullRequestId, HEAD);

    expect(takeover?.state).toBe(TakeoverJobStates.SCHEDULED);
    const startsInMs =
      takeover?.state === TakeoverJobStates.SCHEDULED
        ? takeover.runsAt.getTime() - Date.now()
        : 0;
    expect(startsInMs).toBeGreaterThan(60_000);
  });

  it("reads a locked takeover as running", async () => {
    const { harness, projection, pullRequestId } = await triggerHead();
    const jobKey = getRecoveryJobKey(pullRequestId, HEAD);
    await queueTakeover(harness, jobKey, 0);
    await harness.raw(
      "update graphile_worker.jobs set locked_at = now() where key = $1",
      [jobKey],
    );

    const takeover = await projection.readTakeoverJob(pullRequestId, HEAD);

    expect(takeover).toEqual({ state: TakeoverJobStates.RUNNING });
  });

  it("reads a takeover out of graphile attempts as spent", async () => {
    const { harness, projection, pullRequestId } = await triggerHead();
    const jobKey = getRecoveryJobKey(pullRequestId, HEAD);
    await queueTakeover(harness, jobKey, 0);
    await harness.raw(
      "update graphile_worker.jobs set attempts = max_attempts where key = $1",
      [jobKey],
    );

    const takeover = await projection.readTakeoverJob(pullRequestId, HEAD);

    expect(takeover).toEqual({ state: TakeoverJobStates.SPENT });
  });

  it("returns undefined when no takeover is queued for the head", async () => {
    const { harness, projection, pullRequestId } = await triggerHead();
    await queueTakeover(harness, getRecoveryJobKey(pullRequestId, "other"), 0);

    expect(
      await projection.readTakeoverJob(pullRequestId, HEAD),
    ).toBeUndefined();
  });

  it("returns undefined for a PR outside the caller's tenant", async () => {
    const { harness, pullRequestId } = await triggerHead();
    await queueTakeover(harness, getRecoveryJobKey(pullRequestId, HEAD), 0);
    const other = createGenerationProjection(harness.handle, CTX_B);

    expect(await other.readTakeoverJob(pullRequestId, HEAD)).toBeUndefined();
  });
});
