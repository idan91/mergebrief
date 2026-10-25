// The ingest gate: a trigger whose caller says the PR needs a collaborator's
// approval projects a new head `awaiting-trigger` and still queues the
// ordinary job, until the PR carries an approval. Runs on the PGlite harness for the
// `graphile_worker` stub the enqueue calls by name.
import { describe, expect, it } from "vitest";
import {
  createIngestRoutines,
  type IngestOutcome,
  type TriggerGenerationInput,
} from "../src/stores/ingest";
import { createArtifactStore } from "../src/stores/artifact-store";
import { createGenerationProjection } from "../src/stores/generation";
import {
  parseTenantContext,
  type ScopeContext,
} from "../src/stores/scope-context";
import { approveTestTrigger, claimTestRun } from "../src/testing";
import { isGrantRowId, isPullRequestRowId, isReviewerId } from "../src/types";
import {
  GenerationFailureCodes,
  GenerationStatuses,
  PrStates,
  type Mutable,
} from "types";
import {
  approveGatedPullRequest,
  brandWith,
  countQueuedJobs,
  expectCheckViolation,
  GATE_CTX,
  GATE_HEAD_SHA,
  GATE_REPO_ID,
  GATE_REVIEWER,
  makeBriefTarget,
  registerSharedPglite,
} from "./helpers";

const BASE_SHA = "f95f852bd8fca8fcc58a9a2d6c842781e32a215e";

const shared = registerSharedPglite();

interface TriggerOptions {
  readonly requiresTriggerApproval?: boolean;
  readonly ctx?: ScopeContext;
}

async function trigger(options: TriggerOptions = {}): Promise<IngestOutcome> {
  const input: Mutable<TriggerGenerationInput> = {
    pullRequest: {
      repoId: GATE_REPO_ID,
      prNumber: 7,
      baseSha: BASE_SHA,
      state: PrStates.OPEN,
    },
    headSha: GATE_HEAD_SHA,
  };
  if (options.requiresTriggerApproval !== undefined) {
    input.requiresTriggerApproval = options.requiresTriggerApproval;
  }
  if (options.ctx !== undefined && "ownerUserId" in options.ctx) {
    input.grantId = brandWith(isGrantRowId, 9n);
  }

  const ingest = createIngestRoutines(shared.handle, options.ctx ?? GATE_CTX);
  return ingest.triggerGeneration(input);
}

function readGeneration(outcome: IngestOutcome) {
  if (outcome.generation === undefined) {
    throw new Error("expected a generation row on this trigger");
  }
  return outcome.generation;
}

describe("triggerGeneration under the trigger approval gate", () => {
  it("projects awaiting-trigger and still queues the job", async () => {
    const outcome = await trigger({ requiresTriggerApproval: true });

    const row = readGeneration(outcome);
    expect(row.status).toBe(GenerationStatuses.AWAITING_TRIGGER);
    expect(row.attempts).toBe(0);
    expect(row.runId).toBeNull();
    expect(row.triggeredAt).not.toBeNull();
    expect(outcome.queued).toBe(true);
    expect(await countQueuedJobs(shared)).toBe(1);
  });

  it("keeps a redelivered gated trigger at one row, one job, no attempt", async () => {
    const first = await trigger({ requiresTriggerApproval: true });

    const second = await trigger({ requiresTriggerApproval: true });

    expect(readGeneration(second).id).toBe(readGeneration(first).id);
    expect(readGeneration(second).status).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(readGeneration(second).attempts).toBe(0);
    expect(await countQueuedJobs(shared)).toBe(1);
  });

  it("keeps a pending head pending under a later gated trigger", async () => {
    const first = await trigger();

    const gated = await trigger({ requiresTriggerApproval: true });

    expect(readGeneration(gated).id).toBe(readGeneration(first).id);
    expect(readGeneration(gated).status).toBe(GenerationStatuses.PENDING);
    expect(readGeneration(gated).attempts).toBe(readGeneration(first).attempts);
    expect(gated.queued).toBe(true);
    expect(await countQueuedJobs(shared)).toBe(1);
  });

  it("keeps a failed head's failure and queues no rerun when gated", async () => {
    await trigger();
    await shared.harness.raw(
      "update generation set status = 'failed', error_code = 'provider-timeout'",
    );
    await shared.harness.raw("delete from graphile_worker.jobs");

    const gated = await trigger({ requiresTriggerApproval: true });

    expect(readGeneration(gated).status).toBe(GenerationStatuses.FAILED);
    expect(readGeneration(gated).errorCode).toBe(
      GenerationFailureCodes.PROVIDER_TIMEOUT,
    );
    expect(gated.queued).toBe(false);
    expect(await countQueuedJobs(shared)).toBe(0);
  });

  it("projects pending once the PR carries an approval", async () => {
    const first = await trigger({ requiresTriggerApproval: true });
    await approveGatedPullRequest(shared, first.pullRequest.id);

    const second = await trigger({ requiresTriggerApproval: true });

    expect(readGeneration(second).status).toBe(GenerationStatuses.PENDING);
    expect(second.queued).toBe(true);
  });

  it("projects pending when the caller requires no approval", async () => {
    await trigger({ requiresTriggerApproval: true });

    const trusted = await trigger({ requiresTriggerApproval: false });

    expect(readGeneration(trusted).status).toBe(GenerationStatuses.PENDING);
  });

  it("lets a stored brief for the pair cover the event before the gate", async () => {
    const first = await trigger();
    const written = await createArtifactStore(
      shared.handle,
      GATE_CTX,
    ).briefs.write({
      pullRequestId: brandWith(isPullRequestRowId, first.pullRequest.id),
      baseSha: BASE_SHA,
      headSha: GATE_HEAD_SHA,
      headIndex: 1,
      commitCount: 1,
      provider: "stub",
      model: "stub",
      effort: "low",
      body: "{}",
      usedGroupIds: [],
    });
    await shared.harness.raw("update generation set status = 'succeeded'");
    await shared.harness.raw("delete from graphile_worker.jobs");

    const gated = await trigger({ requiresTriggerApproval: true });

    expect(gated.coveredBy).toBe(written.id);
    expect(gated.generation).toBeUndefined();
    expect(await countQueuedJobs(shared)).toBe(0);
  });

  it("never re-projects a head a live run holds", async () => {
    const first = await trigger();
    const projection = createGenerationProjection(shared.handle, GATE_CTX);
    await claimTestRun(
      projection,
      makeBriefTarget(first.pullRequest.id, GATE_HEAD_SHA),
    );
    await shared.harness.raw("delete from graphile_worker.jobs");

    const gated = await trigger({ requiresTriggerApproval: true });

    expect(readGeneration(gated).status).toBe(GenerationStatuses.RUNNING);
    expect(gated.queued).toBe(false);
    expect(await countQueuedJobs(shared)).toBe(0);
  });

  it("never gates the url-box owner world", async () => {
    const ownerCtx = { ownerUserId: brandWith(isReviewerId, 555n) };

    const pasted = await trigger({
      requiresTriggerApproval: true,
      ctx: ownerCtx,
    });

    expect(readGeneration(pasted).status).toBe(GenerationStatuses.PENDING);
  });
});

describe("approvePullRequestTrigger", () => {
  it("records the first approval and never moves it", async () => {
    const first = await trigger({ requiresTriggerApproval: true });
    const other = brandWith(isReviewerId, 4242n);

    const approved = await approveTestTrigger(
      shared.handle,
      GATE_CTX,
      first.pullRequest.id,
      GATE_REVIEWER,
    );
    const again = await approveTestTrigger(
      shared.handle,
      GATE_CTX,
      first.pullRequest.id,
      other,
    );

    expect(approved?.triggerApprovedBy).toBe(GATE_REVIEWER);
    expect(approved?.triggerApprovedAt).toBeInstanceOf(Date);
    expect(again?.triggerApprovedBy).toBe(GATE_REVIEWER);
    expect(again?.triggerApprovedAt).toEqual(approved?.triggerApprovedAt);
  });

  it("writes nothing on a PR already approved", async () => {
    const first = await trigger({ requiresTriggerApproval: true });
    const approved = await approveTestTrigger(
      shared.handle,
      GATE_CTX,
      first.pullRequest.id,
      GATE_REVIEWER,
    );

    const again = await approveTestTrigger(
      shared.handle,
      GATE_CTX,
      first.pullRequest.id,
      brandWith(isReviewerId, 4242n),
    );

    expect(again?.rowVersion).toBe(approved?.rowVersion);
    expect(again?.updatedAt).toEqual(approved?.updatedAt);
  });

  it("returns undefined for a PR outside the scope and writes nothing", async () => {
    const first = await trigger();
    const otherCtx = parseTenantContext({ installationId: 101n });

    const approved = await approveTestTrigger(
      shared.handle,
      otherCtx,
      first.pullRequest.id,
      GATE_REVIEWER,
    );

    expect(approved).toBeUndefined();
    const rows = await shared.harness.raw(
      "select trigger_approved_by from pull_request",
    );
    expect(rows).toEqual([{ trigger_approved_by: null }]);
  });
});

describe("pull_request trigger approval shape", () => {
  it("refuses an approver without an approval time", async () => {
    await trigger();

    await expectCheckViolation(
      shared.harness.raw("update pull_request set trigger_approved_by = 1"),
      "pull_request_trigger_approval_shape",
    );
  });
});

describe("generationProjection.markAwaitingTrigger", () => {
  it("moves a pending row to awaiting-trigger without an attempt", async () => {
    const first = await trigger();
    const projection = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(first.pullRequest.id, GATE_HEAD_SHA);

    const marked = await projection.markAwaitingTrigger(target);

    if (!marked.ok) {
      throw new Error(marked.error.message);
    }
    expect(marked.value.status).toBe(GenerationStatuses.AWAITING_TRIGGER);
    expect(marked.value.attempts).toBe(readGeneration(first).attempts);
    expect(marked.value.phase).toBeNull();
  });

  it("refuses a row a live lease holds", async () => {
    const first = await trigger();
    const projection = createGenerationProjection(shared.handle, GATE_CTX);
    const target = makeBriefTarget(first.pullRequest.id, GATE_HEAD_SHA);
    await claimTestRun(projection, target);

    const marked = await projection.markAwaitingTrigger(target);

    expect(marked.ok).toBe(false);
    expect((await projection.get(target))?.status).toBe(
      GenerationStatuses.RUNNING,
    );
  });
});
