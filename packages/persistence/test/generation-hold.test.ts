// The worker's bot hold and the release of an approved PR's held head. Both
// read the pull request's approval under its row lock; the interleaving with a
// concurrent approval runs on real Postgres in generation-hold-postgres.
import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  GenerationErrorCodes,
} from "../src/index";
import { succeedTestRun } from "../src/testing";
import type { PullRequestRowId } from "../src/types";
import { GenerationStatuses, PrStates } from "types";
import {
  approveGatedPullRequest,
  countQueuedJobs,
  GATE_CTX,
  GATE_HEAD_SHA,
  GATE_REPO_ID,
  makeBriefTarget,
  registerSharedPglite,
} from "./helpers";

const shared = registerSharedPglite();

async function seedPendingHead() {
  const pr = await createTenantRepository(
    shared.handle,
    GATE_CTX,
  ).pullRequests.upsert({
    repoId: GATE_REPO_ID,
    prNumber: 7,
    state: PrStates.OPEN,
    repoSlug: "acme/hold",
  });
  const gen = createGenerationProjection(shared.handle, GATE_CTX);
  const target = makeBriefTarget(pr.id, GATE_HEAD_SHA);
  await gen.upsertPending(target);
  return { pullRequestId: pr.id, gen, target };
}

describe("markAwaitingTrigger", () => {
  it("holds a pending head on a pull request nobody approved", async () => {
    const { gen, target } = await seedPendingHead();

    const held = await gen.markAwaitingTrigger(target);

    expect(held.ok && held.value.status).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
  });

  it("refuses to hold a head once a collaborator approved the PR", async () => {
    const { pullRequestId, gen, target } = await seedPendingHead();
    await approveGatedPullRequest(shared, pullRequestId);

    const held = await gen.markAwaitingTrigger(target);

    expect(!held.ok && held.error.code).toBe(
      GenerationErrorCodes.TRIGGER_APPROVED,
    );
    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.PENDING);
  });

  it("keeps a succeeded head", async () => {
    const { gen, target } = await seedPendingHead();
    await succeedTestRun(gen, target);

    const held = await gen.markAwaitingTrigger(target);

    expect(!held.ok && held.error.code).toBe(GenerationErrorCodes.STATUS_KEPT);
  });
});

describe("releaseApprovedHold", () => {
  async function seedHeldHead() {
    const seeded = await seedPendingHead();
    const held = await seeded.gen.markAwaitingTrigger(seeded.target);
    expect(held.ok).toBe(true);
    return seeded;
  }

  function release(pullRequestId: PullRequestRowId) {
    const ingest = createIngestRoutines(shared.handle, GATE_CTX);
    return ingest.releaseApprovedHold({
      pullRequestId,
      headSha: GATE_HEAD_SHA,
    });
  }

  it("moves an approved PR's held head to pending and queues it", async () => {
    const { pullRequestId, gen, target } = await seedHeldHead();
    await approveGatedPullRequest(shared, pullRequestId);

    const released = await release(pullRequestId);

    expect(released.queued).toBe(true);
    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.PENDING);
    expect(await countQueuedJobs(shared)).toBe(1);
  });

  it("leaves a held head whose PR nobody approved", async () => {
    const { pullRequestId, gen, target } = await seedHeldHead();

    const released = await release(pullRequestId);

    expect(released.queued).toBe(false);
    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.AWAITING_TRIGGER);
    expect(await countQueuedJobs(shared)).toBe(0);
  });

  it("queues nothing for an approved head no longer held", async () => {
    const { pullRequestId } = await seedPendingHead();
    await approveGatedPullRequest(shared, pullRequestId);

    const released = await release(pullRequestId);

    expect(released.queued).toBe(false);
    expect(await countQueuedJobs(shared)).toBe(0);
  });
});
