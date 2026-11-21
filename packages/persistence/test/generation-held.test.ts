// A head trigger conditions hold: the worker's hold, a re-trigger keeping
// it, the claim releasing it, and a Generate click winning against a hold.
import { describe, expect, it } from "vitest";
import {
  ClaimOutcomes,
  createGenerationProjection,
  createIngestRoutines,
  GenerationErrorCodes,
  parseUnmetConditions,
  TriggerOnDemandOutcomes,
} from "../src/index";
import { claimTestRun, failTestRun, succeedTestRun } from "../src/testing";
import {
  GenerationFailureCodes,
  GenerationStatuses,
  PrStates,
  type UnmetCondition,
} from "types";
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

function readStoredConditions(
  stored: string | null | undefined,
): readonly UnmetCondition[] | undefined {
  return parseUnmetConditions(stored ?? null)?.conditions;
}
const CAP_TEST_LEASE_MS = 120_000;

const UNMET: readonly UnmetCondition[] = [
  { kind: "ready-for-review", setBy: "instance" },
  {
    kind: "any",
    conditions: [
      { kind: "labels", setBy: "repo", labels: ["needs-brief"] },
      {
        kind: "size",
        setBy: "repo",
        measure: "changed-lines",
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

type SeededHeldHead = Awaited<ReturnType<typeof seedHeldHead>>;

const NEWER_HEAD_SHA = "b".repeat(40);

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
    expect(readStoredConditions(row?.unmetConditions)).toEqual(UNMET);
  });

  it("rewrites the conditions of a head already held", async () => {
    const { gen, target } = await seedHeldHead();
    const fewer: readonly UnmetCondition[] = [{ kind: "never", setBy: "repo" }];

    const again = await gen.markHeld(target, fewer);

    expect(again.ok).toBe(true);
    const row = await gen.get(target);
    expect(readStoredConditions(row?.unmetConditions)).toEqual(fewer);
  });

  it("keeps a succeeded head", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA);
    await succeedTestRun(gen, target);

    const held = await gen.markHeld(target, UNMET);

    expect(!held.ok && held.error.code).toBe(GenerationErrorCodes.STATUS_KEPT);
  });

  it("holds a head whose claimed attempt failed, with a fresh claim budget", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA);
    await failTestRun(gen, target, {
      code: GenerationFailureCodes.PROVIDER_TIMEOUT,
    });

    const held = await gen.markHeld(target, UNMET);

    expect(held.ok).toBe(true);
    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.HELD);
    expect(row?.claims).toBe(0);
    expect(row?.errorCode).toBeNull();
  });

  it("holds a head a transient settings read left failed", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA);
    await gen.markFailed(target, {
      code: GenerationFailureCodes.GITHUB_UNAVAILABLE,
    });

    const held = await gen.markHeld(target, UNMET);

    expect(held.ok).toBe(true);
    expect((await gen.get(target))?.status).toBe(GenerationStatuses.HELD);
  });

  it("cuts name lists and names past the stored bounds", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA);
    const checks = Array.from({ length: 150 }, (_, index) => `check-${index}`);
    const longName = "x".repeat(400);
    const unmet: readonly UnmetCondition[] = [
      {
        kind: "ci",
        setBy: "repo",
        failed: [longName],
        running: checks,
        missing: [],
        permissionMissing: false,
      },
    ];

    const held = await gen.markHeld(target, unmet);

    expect(held.ok).toBe(true);
    const row = await gen.get(target);
    const [stored] = readStoredConditions(row?.unmetConditions) ?? [];
    expect(stored).toEqual({
      ...unmet[0],
      failed: ["x".repeat(255)],
      running: checks.slice(0, 100),
    });
  });

  it("cuts names inside an any group's members", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA);
    const labels = Array.from({ length: 150 }, (_, index) => `label-${index}`);
    const longName = "y".repeat(400);
    const unmet: readonly UnmetCondition[] = [
      {
        kind: "any",
        conditions: [
          { kind: "labels", setBy: "repo", labels },
          { kind: "title-keywords", setBy: "repo", keywords: [longName] },
        ],
      },
    ];

    const held = await gen.markHeld(target, unmet);

    expect(held.ok).toBe(true);
    const row = await gen.get(target);
    expect(readStoredConditions(row?.unmetConditions)).toEqual([
      {
        kind: "any",
        conditions: [
          { kind: "labels", setBy: "repo", labels: labels.slice(0, 100) },
          {
            kind: "title-keywords",
            setBy: "repo",
            keywords: ["y".repeat(255)],
          },
        ],
      },
    ]);
  });

  it("cuts a base branch name past the stored bound", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA);
    const unmet: readonly UnmetCondition[] = [
      {
        kind: "base-branches",
        setBy: "repo",
        base: "z".repeat(400),
        branches: ["main"],
      },
    ];

    const held = await gen.markHeld(target, unmet);

    expect(held.ok).toBe(true);
    const row = await gen.get(target);
    const [stored] = readStoredConditions(row?.unmetConditions) ?? [];
    expect(stored).toEqual({ ...unmet[0], base: "z".repeat(255) });
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

    const again = await trigger();

    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.HELD);
    expect(readStoredConditions(row?.unmetConditions)).toEqual(UNMET);
    expect(again.queued).toBe(true);
    expect(await countQueuedJobs(shared)).toBe(1);
  });

  it("is claimed by a run once its conditions pass, clearing them", async () => {
    const { gen, target } = await seedHeldHead();

    await claimTestRun(gen, target);

    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
    expect(row?.unmetConditions).toBeNull();
  });

  it("ends capped at the day's cap, clearing its conditions", async () => {
    const { gen, target } = await seedHeldHead();

    const claimed = await gen.claimRun({
      target,
      leaseMs: CAP_TEST_LEASE_MS,
      from: new Date(0),
      to: new Date("2100-01-01T00:00:00.000Z"),
      cap: 0,
    });

    expect(claimed.ok && claimed.value.kind).toBe(ClaimOutcomes.CAPPED);
    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.CAPPED);
    expect(row?.unmetConditions).toBeNull();
  });
});

describe("unclaimed writes on a held head", () => {
  const marks = [
    [
      "markFailed",
      (gen: SeededHeldHead["gen"], target: SeededHeldHead["target"]) =>
        gen.markFailed(target, {
          code: GenerationFailureCodes.GITHUB_UNAVAILABLE,
        }),
    ],
    [
      "markSuperseded",
      (gen: SeededHeldHead["gen"], target: SeededHeldHead["target"]) =>
        gen.markSuperseded(target),
    ],
    [
      "markCapped",
      (gen: SeededHeldHead["gen"], target: SeededHeldHead["target"]) =>
        gen.markCapped(target),
    ],
  ] as const;

  it.each(marks)(
    "%s keeps the head held with its conditions",
    async (_markName, mark) => {
      const { gen, target } = await seedHeldHead();

      const marked = await mark(gen, target);

      expect(!marked.ok && marked.error.code).toBe(
        GenerationErrorCodes.STATUS_KEPT,
      );
      const row = await gen.get(target);
      expect(row?.status).toBe(GenerationStatuses.HELD);
      expect(readStoredConditions(row?.unmetConditions)).toEqual(UNMET);
    },
  );

  it("stays held when a newer head's run supersedes stale briefs", async () => {
    const { pullRequestId, gen, target } = await seedHeldHead();
    await createIngestRoutines(shared.handle, GATE_CTX).triggerGeneration({
      pullRequest: { repoId: GATE_REPO_ID, prNumber: 7, state: PrStates.OPEN },
      headSha: NEWER_HEAD_SHA,
      debounceSeconds: 0,
    });
    const pickedUpAt = await gen.readClock();

    const swept = await gen.supersedeStaleBriefs(
      pullRequestId,
      NEWER_HEAD_SHA,
      pickedUpAt,
    );

    expect(swept).toBe(0);
    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.HELD);
    expect(readStoredConditions(row?.unmetConditions)).toEqual(UNMET);
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

describe("reading stored unmet conditions", () => {
  const ready = { kind: "ready-for-review", setBy: "repo" };
  const labels = { kind: "labels", setBy: "repo", labels: ["needs-brief"] };
  const unknown = { kind: "deploy-window", setBy: "repo", opens: "09:00" };

  it("keeps the readable items beside one of an unknown kind", () => {
    const stored = JSON.stringify([unknown, ready]);

    expect(parseUnmetConditions(stored)).toEqual({
      conditions: [ready],
      partial: true,
    });
  });

  it("keeps an any group's readable members and drops an unknown key", () => {
    const group = { kind: "any", conditions: [unknown, labels] };
    const stored = JSON.stringify([{ ...ready, addedLater: true }, group]);

    expect(parseUnmetConditions(stored)).toEqual({
      conditions: [ready, { kind: "any", conditions: [labels] }],
      partial: true,
    });
  });

  it("reads a list it knows whole as complete", () => {
    const stored = JSON.stringify([{ ...ready, addedLater: true }, labels]);

    expect(parseUnmetConditions(stored)).toEqual({
      conditions: [ready, labels],
      partial: false,
    });
  });

  it("reads no item and marks the list partial when none is readable", () => {
    const stored = JSON.stringify([unknown]);

    expect(parseUnmetConditions(stored)).toEqual({
      conditions: [],
      partial: true,
    });
  });

  it("reads nothing for a row with no stored conditions", () => {
    expect(parseUnmetConditions(null)).toBeUndefined();
  });
});
