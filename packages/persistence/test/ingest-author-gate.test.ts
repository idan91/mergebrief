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
import { createTenantRepository } from "../src/stores/tenant";
import {
  parseTenantContext,
  type ScopeContext,
} from "../src/stores/scope-context";
import { claimTestRun } from "../src/testing";
import {
  isGrantRowId,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  type PullRequestRowId,
} from "../src/types";
import {
  GenerationFailureCodes,
  GenerationStatuses,
  PrStates,
  type Mutable,
} from "types";
import {
  brandWith,
  expectCheckViolation,
  makeBriefTarget,
  registerSharedPglite,
} from "./helpers";

const CTX = parseTenantContext({ installationId: 100n });
const REPO_ID = brandWith(isRepoId, 200n);
const REVIEWER = brandWith(isReviewerId, 31337n);
const HEAD_SHA = "ec26c3e57ca3a959ca5aad62de7213c562f8c821";
const BASE_SHA = "f95f852bd8fca8fcc58a9a2d6c842781e32a215e";

const shared = registerSharedPglite();

interface TriggerOptions {
  readonly requiresTriggerApproval?: boolean;
  readonly ctx?: ScopeContext;
}

async function trigger(options: TriggerOptions = {}): Promise<IngestOutcome> {
  const input: Mutable<TriggerGenerationInput> = {
    pullRequest: {
      repoId: REPO_ID,
      prNumber: 7,
      baseSha: BASE_SHA,
      state: PrStates.OPEN,
    },
    headSha: HEAD_SHA,
  };
  if (options.requiresTriggerApproval !== undefined) {
    input.requiresTriggerApproval = options.requiresTriggerApproval;
  }
  if (options.ctx !== undefined && "ownerUserId" in options.ctx) {
    input.grantId = brandWith(isGrantRowId, 9n);
  }

  const ingest = createIngestRoutines(shared.handle, options.ctx ?? CTX);
  return ingest.triggerGeneration(input);
}

function readGeneration(outcome: IngestOutcome) {
  if (outcome.generation === undefined) {
    throw new Error("expected a generation row on this trigger");
  }
  return outcome.generation;
}

async function countJobs(): Promise<number> {
  const jobs = await shared.harness.raw("select id from graphile_worker.jobs");
  return jobs.length;
}

async function approve(pullRequestId: PullRequestRowId): Promise<void> {
  const { pullRequests } = createTenantRepository(shared.handle, CTX);
  await pullRequests.approveTrigger(pullRequestId, REVIEWER);
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
    expect(await countJobs()).toBe(1);
  });

  it("keeps a redelivered gated trigger at one row, one job, no attempt", async () => {
    const first = await trigger({ requiresTriggerApproval: true });

    const second = await trigger({ requiresTriggerApproval: true });

    expect(readGeneration(second).id).toBe(readGeneration(first).id);
    expect(readGeneration(second).status).toBe(
      GenerationStatuses.AWAITING_TRIGGER,
    );
    expect(readGeneration(second).attempts).toBe(0);
    expect(await countJobs()).toBe(1);
  });

  it("keeps a pending head pending under a later gated trigger", async () => {
    const first = await trigger();

    const gated = await trigger({ requiresTriggerApproval: true });

    expect(readGeneration(gated).id).toBe(readGeneration(first).id);
    expect(readGeneration(gated).status).toBe(GenerationStatuses.PENDING);
    expect(readGeneration(gated).attempts).toBe(readGeneration(first).attempts);
    expect(gated.queued).toBe(true);
    expect(await countJobs()).toBe(1);
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
    expect(await countJobs()).toBe(0);
  });

  it("projects pending once the PR carries an approval", async () => {
    const first = await trigger({ requiresTriggerApproval: true });
    await approve(first.pullRequest.id);

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
    const written = await createArtifactStore(shared.handle, CTX).briefs.write({
      pullRequestId: brandWith(isPullRequestRowId, first.pullRequest.id),
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
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
    expect(await countJobs()).toBe(0);
  });

  it("never re-projects a head a live run holds", async () => {
    const first = await trigger();
    const projection = createGenerationProjection(shared.handle, CTX);
    await claimTestRun(
      projection,
      makeBriefTarget(first.pullRequest.id, HEAD_SHA),
    );
    await shared.harness.raw("delete from graphile_worker.jobs");

    const gated = await trigger({ requiresTriggerApproval: true });

    expect(readGeneration(gated).status).toBe(GenerationStatuses.RUNNING);
    expect(gated.queued).toBe(false);
    expect(await countJobs()).toBe(0);
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

describe("pullRequests.approveTrigger", () => {
  it("records the first approval and never moves it", async () => {
    const first = await trigger({ requiresTriggerApproval: true });
    const { pullRequests } = createTenantRepository(shared.handle, CTX);
    const other = brandWith(isReviewerId, 4242n);

    const approved = await pullRequests.approveTrigger(
      first.pullRequest.id,
      REVIEWER,
    );
    const again = await pullRequests.approveTrigger(
      first.pullRequest.id,
      other,
    );

    expect(approved?.triggerApprovedBy).toBe(REVIEWER);
    expect(approved?.triggerApprovedAt).toBeInstanceOf(Date);
    expect(again?.triggerApprovedBy).toBe(REVIEWER);
    expect(again?.triggerApprovedAt).toEqual(approved?.triggerApprovedAt);
  });

  it("writes nothing on a PR already approved", async () => {
    const first = await trigger({ requiresTriggerApproval: true });
    const { pullRequests } = createTenantRepository(shared.handle, CTX);
    const approved = await pullRequests.approveTrigger(
      first.pullRequest.id,
      REVIEWER,
    );

    const again = await pullRequests.approveTrigger(
      first.pullRequest.id,
      brandWith(isReviewerId, 4242n),
    );

    expect(again?.rowVersion).toBe(approved?.rowVersion);
    expect(again?.updatedAt).toEqual(approved?.updatedAt);
  });

  it("returns undefined for a PR outside the scope and writes nothing", async () => {
    const first = await trigger();
    const otherCtx = parseTenantContext({ installationId: 101n });
    const { pullRequests } = createTenantRepository(shared.handle, otherCtx);

    const approved = await pullRequests.approveTrigger(
      first.pullRequest.id,
      REVIEWER,
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
    const projection = createGenerationProjection(shared.handle, CTX);
    const target = makeBriefTarget(first.pullRequest.id, HEAD_SHA);

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
    const projection = createGenerationProjection(shared.handle, CTX);
    const target = makeBriefTarget(first.pullRequest.id, HEAD_SHA);
    await claimTestRun(projection, target);

    const marked = await projection.markAwaitingTrigger(target);

    expect(marked.ok).toBe(false);
    expect((await projection.get(target))?.status).toBe(
      GenerationStatuses.RUNNING,
    );
  });
});
