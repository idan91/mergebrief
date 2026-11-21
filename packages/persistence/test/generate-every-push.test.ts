// The per-PR switch that skips trigger conditions: turning it on releases a
// held head as a Generate click does, a hold while it is on is refused, and
// turning it off leaves every head as it stands.
import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  GenerateEveryPushOutcomes,
  GenerationErrorCodes,
  parseScopeContext,
  parseTenantContext,
} from "../src/index";
import { GenerationStatuses, PrStates } from "types";
import type { UnmetCondition } from "types/trigger-conditions";
import {
  GATE_CTX,
  GATE_HEAD_SHA,
  GATE_REPO_ID,
  GATE_REVIEWER,
  brandWith,
  makeBriefTarget,
  registerSharedPglite,
} from "./helpers";
import { isReviewerId } from "../src/types";

const shared = registerSharedPglite();

const UNMET: readonly UnmetCondition[] = [{ kind: "never", setBy: "repo" }];
const LATER_PUSHER = brandWith(isReviewerId, 4242n);

async function seedPendingHead() {
  const triggered = await createIngestRoutines(
    shared.handle,
    GATE_CTX,
  ).triggerGeneration({
    pullRequest: { repoId: GATE_REPO_ID, prNumber: 7, state: PrStates.OPEN },
    headSha: GATE_HEAD_SHA,
    debounceSeconds: 0,
  });
  const pullRequestId = triggered.pullRequest.id;
  const gen = createGenerationProjection(shared.handle, GATE_CTX);
  const target = makeBriefTarget(pullRequestId, GATE_HEAD_SHA);
  return { pullRequestId, gen, target };
}

async function seedHeldHead() {
  const seeded = await seedPendingHead();
  const held = await seeded.gen.markHeld(seeded.target, UNMET);
  expect(held.ok).toBe(true);
  return seeded;
}

function turnOn(
  pullRequestId: Awaited<ReturnType<typeof seedPendingHead>>["pullRequestId"],
  userId = GATE_REVIEWER,
) {
  return createIngestRoutines(shared.handle, GATE_CTX).turnOnGenerateEveryPush({
    pullRequestId,
    userId,
  });
}

async function readGenerateJobRunAt(): Promise<Date[]> {
  const rows = await shared.harness.raw(
    "select run_at from graphile_worker.jobs where task_identifier = 'generate'",
  );
  return rows.map((row) => new Date(String(row["run_at"])));
}

describe("turnOnGenerateEveryPush", () => {
  it("stamps the pusher and releases a held head with its job queued", async () => {
    const { pullRequestId, gen, target } = await seedHeldHead();

    const outcome = await turnOn(pullRequestId);

    expect(outcome).toBe(GenerateEveryPushOutcomes.RELEASED);
    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.PENDING);
    expect(row?.generateRequestedAt).not.toBeNull();
    expect(row?.unmetConditions).toBeNull();
    expect(await readGenerateJobRunAt()).toHaveLength(1);
    const pr = await createTenantRepository(
      shared.handle,
      GATE_CTX,
    ).pullRequests.getById(pullRequestId);
    expect(pr?.generateEveryPushBy).toBe(GATE_REVIEWER);
    expect(pr?.generateEveryPushAt).toBeInstanceOf(Date);
  });

  it("leaves a pending head as queued and releases nothing", async () => {
    const { pullRequestId, gen, target } = await seedPendingHead();

    const outcome = await turnOn(pullRequestId);

    expect(outcome).toBe(GenerateEveryPushOutcomes.ON);
    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.PENDING);
    expect(row?.generateRequestedAt).toBeNull();
  });

  it("keeps the first pusher's stamp and its row_version", async () => {
    const { pullRequestId } = await seedPendingHead();
    await turnOn(pullRequestId);
    const { pullRequests } = createTenantRepository(shared.handle, GATE_CTX);
    const first = await pullRequests.getById(pullRequestId);

    await turnOn(pullRequestId, LATER_PUSHER);

    const again = await pullRequests.getById(pullRequestId);
    expect(again?.generateEveryPushBy).toBe(GATE_REVIEWER);
    expect(again?.rowVersion).toBe(first?.rowVersion);
  });

  it("stores the switch on a closed PR but releases its held head never", async () => {
    const { pullRequestId, gen, target } = await seedHeldHead();
    await createTenantRepository(shared.handle, GATE_CTX).pullRequests.upsert({
      repoId: GATE_REPO_ID,
      prNumber: 7,
      state: PrStates.CLOSED,
      closedAt: new Date(),
    });

    const outcome = await turnOn(pullRequestId);

    expect(outcome).toBe(GenerateEveryPushOutcomes.ON);
    expect((await gen.get(target))?.status).toBe(GenerationStatuses.HELD);
  });

  it("writes nothing for a PR outside the scope or under an owner", async () => {
    const { pullRequestId, gen, target } = await seedHeldHead();
    const other = parseTenantContext({ installationId: 999n });
    const owner = parseScopeContext({ ownerUserId: 31337n });

    const outside = await createIngestRoutines(
      shared.handle,
      other,
    ).turnOnGenerateEveryPush({ pullRequestId, userId: GATE_REVIEWER });
    const owned = await createIngestRoutines(
      shared.handle,
      owner,
    ).turnOnGenerateEveryPush({ pullRequestId, userId: GATE_REVIEWER });

    expect(outside).toBe(GenerateEveryPushOutcomes.NOT_FOUND);
    expect(owned).toBe(GenerateEveryPushOutcomes.NOT_FOUND);
    expect((await gen.get(target))?.status).toBe(GenerationStatuses.HELD);
    const pr = await createTenantRepository(
      shared.handle,
      GATE_CTX,
    ).pullRequests.getById(pullRequestId);
    expect(pr?.generateEveryPushAt).toBeNull();
  });
});

describe("markHeld while generating on every push", () => {
  it("refuses to hold a head of a PR with the switch on", async () => {
    const { pullRequestId, gen, target } = await seedPendingHead();
    await turnOn(pullRequestId);

    const held = await gen.markHeld(target, UNMET);

    expect(!held.ok && held.error.code).toBe(GenerationErrorCodes.STATUS_KEPT);
    expect((await gen.get(target))?.status).toBe(GenerationStatuses.PENDING);
  });

  it("holds a head again once the switch is off", async () => {
    const { pullRequestId, gen, target } = await seedPendingHead();
    await turnOn(pullRequestId);
    await createTenantRepository(
      shared.handle,
      GATE_CTX,
    ).pullRequests.turnOffGenerateEveryPush(pullRequestId);

    const held = await gen.markHeld(target, UNMET);

    expect(held.ok).toBe(true);
  });
});

describe("turnOffGenerateEveryPush", () => {
  it("clears the pair and leaves a released head pending", async () => {
    const { pullRequestId, gen, target } = await seedHeldHead();
    await turnOn(pullRequestId);

    const row = await createTenantRepository(
      shared.handle,
      GATE_CTX,
    ).pullRequests.turnOffGenerateEveryPush(pullRequestId);

    expect(row?.generateEveryPushBy).toBeNull();
    expect(row?.generateEveryPushAt).toBeNull();
    expect((await gen.get(target))?.status).toBe(GenerationStatuses.PENDING);
  });

  it("writes nothing on a row already off, row_version included", async () => {
    const { pullRequestId } = await seedPendingHead();
    const { pullRequests } = createTenantRepository(shared.handle, GATE_CTX);
    const before = await pullRequests.getById(pullRequestId);

    const after = await pullRequests.turnOffGenerateEveryPush(pullRequestId);

    expect(after?.rowVersion).toBe(before?.rowVersion);
  });

  it("answers undefined for a PR outside the scope and leaves it on", async () => {
    const { pullRequestId } = await seedPendingHead();
    await turnOn(pullRequestId);
    const other = parseTenantContext({ installationId: 999n });

    const outside = await createTenantRepository(
      shared.handle,
      other,
    ).pullRequests.turnOffGenerateEveryPush(pullRequestId);

    expect(outside).toBeUndefined();
    const pr = await createTenantRepository(
      shared.handle,
      GATE_CTX,
    ).pullRequests.getById(pullRequestId);
    expect(pr?.generateEveryPushAt).not.toBeNull();
  });
});
