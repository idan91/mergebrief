// A head trigger conditions hold: the worker's hold, a re-trigger keeping
// it, the claim releasing it, and a Generate click winning against a hold.
import { describe, expect, it } from "vitest";
import {
  createGenerationProjection,
  createIngestRoutines,
  GenerationErrorCodes,
  parseUnmetConditions,
  TriggerOnDemandOutcomes,
} from "../src/index";
import { claimTestRun, succeedTestRun } from "../src/testing";
import { GenerationStatuses, PrStates } from "types";
import type { UnmetCondition } from "types/trigger-conditions";
import {
  GATE_CTX,
  GATE_HEAD_SHA,
  GATE_REPO_ID,
  GATE_REVIEWER,
  countQueuedJobs,
  makeBriefTarget,
  registerSharedPglite,
} from "./helpers";

const shared = registerSharedPglite();

const UNMET: readonly UnmetCondition[] = [
  { kind: "ready-for-review", source: "instance" },
  {
    kind: "any",
    conditions: [
      { kind: "labels", source: "repo", labels: ["needs-brief"] },
      {
        kind: "size",
        source: "repo",
        count: "changed-lines",
        side: "max",
        limit: 500,
        actual: 1284,
      },
    ],
  },
];

function trigger() {
  return createIngestRoutines(shared.handle, GATE_CTX).triggerGeneration({
    pullRequest: { repoId: GATE_REPO_ID, prNumber: 7, state: PrStates.OPEN },
    headSha: GATE_HEAD_SHA,
    debounceSeconds: 0,
  });
}

async function seedHeldHead() {
  const triggered = await trigger();
  const pullRequestId = triggered.pullRequest.id;
  const gen = createGenerationProjection(shared.handle, GATE_CTX);
  const target = makeBriefTarget(pullRequestId, GATE_HEAD_SHA);
  const held = await gen.markHeld(target, UNMET);
  expect(held.ok).toBe(true);
  return { pullRequestId, gen, target };
}

function clickGenerate(
  pullRequestId: Awaited<ReturnType<typeof seedHeldHead>>["pullRequestId"],
) {
  return createIngestRoutines(shared.handle, GATE_CTX).triggerOnDemand({
    pullRequestId,
    approverId: GATE_REVIEWER,
  });
}

describe("markHeld", () => {
  it("holds a pending head and stores its unmet conditions", async () => {
    const { gen, target } = await seedHeldHead();

    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.HELD);
    expect(parseUnmetConditions(row?.unmetConditions ?? null)).toEqual(UNMET);
  });

  it("rewrites the conditions of a head already held", async () => {
    const { gen, target } = await seedHeldHead();
    const fewer: readonly UnmetCondition[] = [
      { kind: "never", source: "repo" },
    ];

    const again = await gen.markHeld(target, fewer);

    expect(again.ok).toBe(true);
    const row = await gen.get(target);
    expect(parseUnmetConditions(row?.unmetConditions ?? null)).toEqual(fewer);
  });

  it("keeps a succeeded head", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA);
    await succeedTestRun(gen, target);

    const held = await gen.markHeld(target, UNMET);

    expect(!held.ok && held.error.code).toBe(GenerationErrorCodes.STATUS_KEPT);
  });

  it("refuses a head a live run holds", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA);
    await claimTestRun(gen, target);

    const held = await gen.markHeld(target, UNMET);

    expect(held.ok).toBe(false);
    expect((await gen.get(target))?.status).toBe(GenerationStatuses.RUNNING);
  });
});

describe("a held head between checks", () => {
  it("stays held with its conditions when the same head triggers again", async () => {
    const { gen, target } = await seedHeldHead();
    const before = await countQueuedJobs(shared);

    await trigger();

    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.HELD);
    expect(parseUnmetConditions(row?.unmetConditions ?? null)).toEqual(UNMET);
    expect(await countQueuedJobs(shared)).toBeGreaterThanOrEqual(before);
  });

  it("is claimed by a run once its conditions pass, clearing them", async () => {
    const { gen, target } = await seedHeldHead();

    await claimTestRun(gen, target);

    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
    expect(row?.unmetConditions).toBeNull();
  });
});

describe("Generate on a held head", () => {
  it("releases the head to pending, stamped, and queues its job", async () => {
    const { pullRequestId, gen, target } = await seedHeldHead();

    const outcome = await clickGenerate(pullRequestId);

    expect(outcome).toBe(TriggerOnDemandOutcomes.QUEUED);
    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.PENDING);
    expect(row?.unmetConditions).toBeNull();
    expect(row?.generateRequestedAt).not.toBeNull();
  });

  it("wins against a hold the worker writes after the click", async () => {
    const { pullRequestId, gen, target } = await seedHeldHead();
    await clickGenerate(pullRequestId);

    const held = await gen.markHeld(target, UNMET);

    expect(!held.ok && held.error.code).toBe(GenerationErrorCodes.STATUS_KEPT);
    expect((await gen.get(target))?.status).toBe(GenerationStatuses.PENDING);
  });
});
