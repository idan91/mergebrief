// A head trigger conditions hold: the worker's hold, a re-trigger keeping
// it, the claim releasing it, and a Generate click winning against a hold.
import { describe, expect, it } from "vitest";
import {
  ClaimOutcomes,
  createGenerationProjection,
  createIngestRoutines,
  GenerationErrorCodes,
  isGrantRowId,
  isReviewerId,
  MAX_GENERATION_ATTEMPTS,
  isRepoId,
  parseScopeContext,
  parseTenantContext,
  parseUnmetConditions,
  TriggerOnDemandOutcomes,
  type RepoId,
  type ScopeContext,
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
  brandWith,
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

function trigger(requiresTriggerApproval = false) {
  return createIngestRoutines(shared.handle, GATE_CTX).triggerGeneration({
    pullRequest: { repoId: GATE_REPO_ID, prNumber: 7, state: PrStates.OPEN },
    headSha: GATE_HEAD_SHA,
    debounceSeconds: 0,
    requiresTriggerApproval,
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

  it("keeps a head that failed in a way a rerun cannot help", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA);
    await failTestRun(gen, target, {
      code: GenerationFailureCodes.OUTPUT_CUT,
    });

    const held = await gen.markHeld(target, UNMET);

    expect(held.ok).toBe(false);
    const row = await gen.get(target);
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    expect(row?.errorCode).toBe(GenerationFailureCodes.OUTPUT_CUT);
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

  it("stays held and queues its job when a gated trigger names it", async () => {
    const { gen, target } = await seedHeldHead();

    const again = await trigger(true);

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

describe("recheckCurrentHead", () => {
  async function clearQueue() {
    await shared.harness.raw("delete from graphile_worker.jobs");
  }

  function recheck(
    pullRequestId: Awaited<ReturnType<typeof seedHeldHead>>["pullRequestId"],
  ) {
    return createIngestRoutines(shared.handle, GATE_CTX).recheckCurrentHead({
      pullRequestId,
    });
  }

  it("queues a held head's job and leaves the row held", async () => {
    const { pullRequestId, gen, target } = await seedHeldHead();
    await clearQueue();

    const outcome = await recheck(pullRequestId);

    expect(outcome).toEqual({ queued: true });
    expect(await countQueuedJobs(shared)).toBe(1);
    expect((await gen.get(target))?.status).toBe(GenerationStatuses.HELD);
  });

  it("queues a fresh job beside a pending head's job a check has locked", async () => {
    const triggered = await trigger();
    await shared.harness.raw(
      "update graphile_worker.jobs set locked_at = now()",
    );

    const outcome = await recheck(triggered.pullRequest.id);

    expect(outcome).toEqual({ queued: true });
    const keys = await shared.harness.raw(
      "select key from graphile_worker.jobs order by id",
    );
    expect(keys.map((job) => job["key"])).toEqual([
      null,
      `generate:${triggered.pullRequest.id}`,
    ]);
  });

  it("keeps a pending head's waiting job as it is", async () => {
    const triggered = await trigger();
    const readRunAt = () =>
      shared.harness.raw("select id, run_at from graphile_worker.jobs");
    const before = await readRunAt();

    await recheck(triggered.pullRequest.id);

    expect(await readRunAt()).toEqual(before);
  });

  it("keeps a waiting generate-large job's task and run_at", async () => {
    const { pullRequestId } = await seedHeldHead();
    await shared.harness.raw(
      "update graphile_worker.jobs set task_identifier = 'generate-large', run_at = now() + interval '1 hour'",
    );
    const readJobs = () =>
      shared.harness.raw(
        "select id, task_identifier, run_at from graphile_worker.jobs",
      );
    const before = await readJobs();

    const outcome = await recheck(pullRequestId);

    expect(outcome).toEqual({ queued: false });
    expect(await readJobs()).toEqual(before);
  });

  it("queues a fresh job beside a failed head's job a retry has locked", async () => {
    const triggered = await trigger();
    const pullRequestId = triggered.pullRequest.id;
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    await failTestRun(gen, makeBriefTarget(pullRequestId, GATE_HEAD_SHA), {
      code: GenerationFailureCodes.PROVIDER_TIMEOUT,
    });
    await shared.harness.raw(
      "update graphile_worker.jobs set locked_at = now()",
    );

    const outcome = await recheck(pullRequestId);

    expect(outcome).toEqual({ queued: true });
    expect(await countQueuedJobs(shared)).toBe(2);
  });

  it.each([
    GenerationFailureCodes.GITHUB_ACCESS,
    GenerationFailureCodes.OUTPUT_CUT,
    GenerationFailureCodes.ATTEMPTS_EXHAUSTED,
  ] as const)("leaves a final %s failure's locked job alone", async (code) => {
    const triggered = await trigger();
    const pullRequestId = triggered.pullRequest.id;
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    await failTestRun(gen, makeBriefTarget(pullRequestId, GATE_HEAD_SHA), {
      code,
    });
    await shared.harness.raw(
      "update graphile_worker.jobs set locked_at = now()",
    );

    const outcome = await recheck(pullRequestId);

    expect(outcome).toEqual({ queued: false });
    expect(await countQueuedJobs(shared)).toBe(1);
  });

  it("leaves a transient failure's locked job alone once claims ran out", async () => {
    const triggered = await trigger();
    const pullRequestId = triggered.pullRequest.id;
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    await failTestRun(gen, makeBriefTarget(pullRequestId, GATE_HEAD_SHA), {
      code: GenerationFailureCodes.PROVIDER_TIMEOUT,
    });
    await shared.harness.raw(
      `update generation set claims = ${MAX_GENERATION_ATTEMPTS}`,
    );
    await shared.harness.raw(
      "update graphile_worker.jobs set locked_at = now()",
    );

    const outcome = await recheck(pullRequestId);

    expect(outcome).toEqual({ queued: false });
    expect(await countQueuedJobs(shared)).toBe(1);
  });

  it("queues nothing once the pull request is closed", async () => {
    const { pullRequestId, gen, target } = await seedHeldHead();
    await clearQueue();
    await shared.harness.raw("update pull_request set state = 'closed'");

    const outcome = await recheck(pullRequestId);

    expect(outcome).toEqual({ queued: false });
    expect(await countQueuedJobs(shared)).toBe(0);
    expect((await gen.get(target))?.status).toBe(GenerationStatuses.HELD);
  });

  it("queues nothing under an owner scope", async () => {
    const ownerCtx = { ownerUserId: brandWith(isReviewerId, 555n) };
    const ingest = createIngestRoutines(shared.handle, ownerCtx);
    const recorded = await ingest.recordState({
      repoId: GATE_REPO_ID,
      prNumber: 9,
      state: PrStates.OPEN,
    });
    const pullRequestId = recorded.pullRequest.id;
    await createGenerationProjection(shared.handle, ownerCtx).upsertPending(
      makeBriefTarget(pullRequestId, GATE_HEAD_SHA),
    );
    await ingest.requeueGenerateJob({
      pullRequestId,
      headSha: GATE_HEAD_SHA,
      grantId: brandWith(isGrantRowId, 9n),
      delaySeconds: 0,
    });
    await shared.harness.raw(
      "update graphile_worker.jobs set locked_at = now()",
    );

    const outcome = await ingest.recheckCurrentHead({ pullRequestId });

    expect(outcome).toEqual({ queued: false });
    expect(await countQueuedJobs(shared)).toBe(1);
  });

  it("leaves a pending head with no job alone", async () => {
    const triggered = await trigger();
    await clearQueue();

    const outcome = await recheck(triggered.pullRequest.id);

    expect(outcome).toEqual({ queued: false });
    expect(await countQueuedJobs(shared)).toBe(0);
  });

  it("leaves a pending head's unlocked waiting job unqueued", async () => {
    const triggered = await trigger();

    const outcome = await recheck(triggered.pullRequest.id);

    expect(outcome).toEqual({ queued: false });
    expect(await countQueuedJobs(shared)).toBe(1);
  });

  it.each([
    ["with no job", true],
    ["with an unlocked waiting job", false],
  ])("leaves a failed head %s alone", async (_case, emptyQueue) => {
    const triggered = await trigger();
    const pullRequestId = triggered.pullRequest.id;
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    await failTestRun(gen, makeBriefTarget(pullRequestId, GATE_HEAD_SHA), {
      code: GenerationFailureCodes.PROVIDER_TIMEOUT,
    });
    if (emptyQueue) {
      await clearQueue();
    }
    const before = await countQueuedJobs(shared);

    const outcome = await recheck(pullRequestId);

    expect(outcome).toEqual({ queued: false });
    expect(await countQueuedJobs(shared)).toBe(before);
  });

  it("queues nothing for a head a run has claimed", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    await claimTestRun(
      gen,
      makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA),
    );
    await clearQueue();

    const outcome = await recheck(triggered.pullRequest.id);

    expect(outcome).toEqual({ queued: false });
    expect(await countQueuedJobs(shared)).toBe(0);
  });
});

describe("a claim on a failure a rerun cannot help", () => {
  it("is refused and writes nothing", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA);
    await failTestRun(gen, target, {
      code: GenerationFailureCodes.OUTPUT_SECRET,
    });
    const before = await gen.get(target);

    const claiming = claimTestRun(gen, target);

    await expect(claiming).rejects.toThrow(ClaimOutcomes.HOPELESS);
    expect(await gen.get(target)).toEqual(before);
  });

  it("goes through once a trigger projects the head again", async () => {
    const triggered = await trigger();
    const gen = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA);
    await failTestRun(gen, target, {
      code: GenerationFailureCodes.OUTPUT_CUT,
    });
    await trigger();

    const runId = await claimTestRun(gen, target);

    expect((await gen.get(target))?.runId).toBe(runId);
  });
});

describe("recheckHeadsAtSha", () => {
  const OTHER_CTX = parseTenantContext({ installationId: 101n });
  const OTHER_REPO_ID = brandWith(isRepoId, 201n);
  const NEXT_HEAD_SHA = "5f0c6a2b9d1e4c3a8b7f6e5d4c3b2a1908f7e6d5";

  interface HeldSeed {
    readonly ctx?: ScopeContext;
    readonly repoId?: RepoId;
    readonly prNumber?: number;
  }

  async function seedHeldAt(seed: HeldSeed = {}) {
    const ctx = seed.ctx ?? GATE_CTX;
    const triggered = await createIngestRoutines(
      shared.handle,
      ctx,
    ).triggerGeneration({
      pullRequest: {
        repoId: seed.repoId ?? GATE_REPO_ID,
        prNumber: seed.prNumber ?? 7,
        state: PrStates.OPEN,
      },
      headSha: GATE_HEAD_SHA,
      debounceSeconds: 0,
    });
    const pullRequestId = triggered.pullRequest.id;
    const held = await createGenerationProjection(shared.handle, ctx).markHeld(
      makeBriefTarget(pullRequestId, GATE_HEAD_SHA),
      UNMET,
    );
    expect(held.ok).toBe(true);
    return pullRequestId;
  }

  async function clearQueue() {
    await shared.harness.raw("delete from graphile_worker.jobs");
  }

  function recheckAtSha(ctx: ScopeContext = GATE_CTX, headSha = GATE_HEAD_SHA) {
    return createIngestRoutines(shared.handle, ctx).recheckHeadsAtSha({
      repoId: GATE_REPO_ID,
      headSha,
    });
  }

  it("queues each open PR whose current head is the held SHA", async () => {
    const first = await seedHeldAt();
    const second = await seedHeldAt({ prNumber: 8 });
    await clearQueue();

    const outcome = await recheckAtSha();

    expect(outcome.rechecked).toEqual([first, second]);
    expect(await countQueuedJobs(shared)).toBe(2);
    const row = await createGenerationProjection(shared.handle, GATE_CTX).get(
      makeBriefTarget(first, GATE_HEAD_SHA),
    );
    expect(row?.status).toBe(GenerationStatuses.HELD);
  });

  it("never wakes another installation's PR at the same SHA", async () => {
    await seedHeldAt({ ctx: OTHER_CTX });
    await clearQueue();

    const outcome = await recheckAtSha();

    expect(outcome.rechecked).toEqual([]);
    expect(await countQueuedJobs(shared)).toBe(0);
  });

  it("wakes only the caller's installation when both hold the SHA", async () => {
    const own = await seedHeldAt();
    await seedHeldAt({ ctx: OTHER_CTX });
    await clearQueue();

    const outcome = await recheckAtSha();

    expect(outcome.rechecked).toEqual([own]);
    expect(await countQueuedJobs(shared)).toBe(1);
  });

  it("never wakes a PR in another repository at the same SHA", async () => {
    await seedHeldAt({ repoId: OTHER_REPO_ID });
    await clearQueue();

    expect((await recheckAtSha()).rechecked).toEqual([]);
    expect(await countQueuedJobs(shared)).toBe(0);
  });

  it("queues the job of a pending head at the SHA", async () => {
    const triggered = await trigger();
    await clearQueue();

    const outcome = await recheckAtSha();

    expect(outcome.rechecked).toEqual([triggered.pullRequest.id]);
    expect(await countQueuedJobs(shared)).toBe(1);
  });

  it("queues a fresh job beside a pending head's locked job", async () => {
    const triggered = await trigger();
    await shared.harness.raw(
      "update graphile_worker.jobs set locked_at = now()",
    );

    await recheckAtSha();

    const keys = await shared.harness.raw(
      "select key from graphile_worker.jobs order by id",
    );
    expect(keys.map((job) => job["key"])).toEqual([
      null,
      `generate:${triggered.pullRequest.id}`,
    ]);
  });

  it("queues nothing for a head at the SHA a run has claimed", async () => {
    const triggered = await trigger();
    await claimTestRun(
      createGenerationProjection(shared.handle, GATE_CTX),
      makeBriefTarget(triggered.pullRequest.id, GATE_HEAD_SHA),
    );
    await clearQueue();

    expect((await recheckAtSha()).rechecked).toEqual([]);
    expect(await countQueuedJobs(shared)).toBe(0);
  });

  it("queues nothing for a closed PR whose head is held", async () => {
    await seedHeldAt();
    await createIngestRoutines(shared.handle, GATE_CTX).recordState({
      repoId: GATE_REPO_ID,
      prNumber: 7,
      state: PrStates.CLOSED,
      closedAt: new Date(),
    });
    await clearQueue();

    expect((await recheckAtSha()).rechecked).toEqual([]);
    expect(await countQueuedJobs(shared)).toBe(0);
  });

  it("queues nothing for a held SHA the PR has pushed past", async () => {
    await seedHeldAt();
    await createIngestRoutines(shared.handle, GATE_CTX).triggerGeneration({
      pullRequest: { repoId: GATE_REPO_ID, prNumber: 7, state: PrStates.OPEN },
      headSha: NEXT_HEAD_SHA,
      debounceSeconds: 0,
    });
    await clearQueue();

    expect((await recheckAtSha()).rechecked).toEqual([]);
    expect(await countQueuedJobs(shared)).toBe(0);
  });

  it("queues nothing in the url-box owner world", async () => {
    await seedHeldAt();
    await clearQueue();

    const ownerCtx = parseScopeContext({ ownerUserId: GATE_REVIEWER });

    expect((await recheckAtSha(ownerCtx)).rechecked).toEqual([]);
    expect(await countQueuedJobs(shared)).toBe(0);
  });
});
