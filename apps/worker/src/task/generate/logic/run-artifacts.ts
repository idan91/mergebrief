import type { Generator } from "generators";
import {
  AuditActorTypes,
  AuditMetadataKeys,
  AuditOutcomes,
  GenerationKinds,
  writeAudit,
  type AuditEntry,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import { AUDIT_OPERATION_GENERATE } from "../consts";
import {
  RunDecisionKinds,
  type FreshRun,
  type GeneratingRun,
  type PrefetchedSpan,
  type ProducedBrief,
  type RevisionArtifactInputs,
  type RunContext,
  type RunInputs,
} from "../types";
import { buildAttemptFields } from "../utils";
import { recoverStoredBrief, writeFreshBrief } from "./brief-generation";
import { generateCheckpointDeltas } from "./checkpoint-deltas";
import { throwOnGitHubFailure } from "./errors";
import { createSpendCharge } from "./spend-gate";
import { throwOnClaimLost } from "./supersession-watch";
import {
  countPrChangedLines,
  writeRevisionArtifacts,
} from "./revision-artifacts";

type GenerateAuditTarget = Pick<
  AuditEntry,
  "targetType" | "targetId" | "metadata"
>;

/** The fresh brief through the model, or the stored one read back. */
export async function produceBrief(
  context: RunContext,
  decision: GeneratingRun,
  inputs: RunInputs,
  generator: Generator,
): Promise<ProducedBrief> {
  if (decision.kind === RunDecisionKinds.FRESH) {
    return generateFreshBrief(context, decision, inputs, generator);
  }

  const { payload, store, prevBrief, prInfo, log } = context;
  const { storedBrief } = decision;
  log.info(
    `generate: brief for ${payload.headSha.slice(0, 8)} already stored — skipping generation`,
  );
  const generatedBrief = await recoverStoredBrief(payload, {
    store,
    prevBrief,
    baseSha: prInfo.baseSha,
    log,
  });
  const briefRef = { id: storedBrief.id, headIndex: storedBrief.headIndex };
  return { briefRef, generatedBrief };
}

async function generateFreshBrief(
  context: RunContext,
  decision: FreshRun,
  inputs: RunInputs,
  generator: Generator,
): Promise<ProducedBrief> {
  const { deps, payload } = context;
  const generated = await writeFreshBrief(payload, {
    fullRegeneration: deps.fullRegeneration,
    anchorGenerator: deps.generator,
    effort: deps.effort,
    store: context.store,
    source: context.source,
    projection: context.projection,
    target: context.target,
    runId: decision.runId,
    entryCommentManager: context.entryCommentManager,
    entryCommentAllowed: inputs.entryCommentAllowed,
    priorBriefs: context.priorBriefs,
    prevBrief: context.prevBrief,
    prevSpanFetch: inputs.prevSpanFetch,
    prInfo: context.prInfo,
    diff: inputs.diff,
    locator: inputs.locator,
    meta: inputs.meta,
    repoConfig: inputs.repoConfig,
    loadContext: inputs.loadContext,
    generator,
    coreMessageLog: inputs.coreMessageLog,
    log: context.log,
  });

  await recordGenerateAudit(context, {
    targetType: "brief",
    targetId: generated.briefRef.id,
    metadata: { [AuditMetadataKeys.KIND]: GenerationKinds.BRIEF },
  });
  return generated;
}

/**
 * The revision artifacts over the prevHead...head span, then one delta core
 * per checkpoint. The span diff is unwrapped once and reused by the delta
 * loop, so a checkpoint at the previous briefed head does not re-fetch it.
 */
export async function writeFollowOnArtifacts(
  context: RunContext,
  inputs: RunInputs,
  brief: ProducedBrief,
  generator: Generator,
): Promise<void> {
  const { deps, payload, watch, log } = context;
  const chargeSpend = createSpendCharge(context);
  const prevSpan = await writeRevisionSpan(context, inputs, brief, {
    generator,
    chargeSpend,
  });
  const deltaCount = await generateCheckpointDeltas(payload, {
    hugeSpanRatio: deps.hugeSpanRatio,
    store: context.store,
    repo: context.repo,
    locator: inputs.locator,
    meta: inputs.meta,
    source: context.source,
    priorBriefs: context.priorBriefs,
    prevSpan,
    generator,
    watch,
    chargeSpend,
    effort: deps.effort,
    briefHeadIndex: brief.briefRef.headIndex,
    wholePrChangedLines: countPrChangedLines(inputs.files),
    loadContext: inputs.loadContext,
    log,
  });
  if (deltaCount > 0) {
    await recordGenerateAudit(context, {
      targetType: "pull_request",
      targetId: payload.pullRequestId,
      metadata: {
        [AuditMetadataKeys.KIND]: GenerationKinds.DELTA,
        [AuditMetadataKeys.COUNT]: deltaCount,
      },
    });
  }
}

async function writeRevisionSpan(
  context: RunContext,
  inputs: RunInputs,
  brief: ProducedBrief,
  spend: Pick<RevisionArtifactInputs, "generator" | "chargeSpend">,
): Promise<PrefetchedSpan | undefined> {
  const { deps, payload, prevBrief } = context;
  if (prevBrief === undefined || inputs.prevSpanFetch === undefined) {
    return undefined;
  }

  const revDiff = throwOnGitHubFailure(inputs.prevSpanFetch);
  await writeRevisionArtifacts(payload, {
    revisionNarrative: deps.revisionNarrative,
    hugeSpanRatio: deps.hugeSpanRatio,
    store: context.store,
    locator: inputs.locator,
    meta: inputs.meta,
    revDiff,
    prevBrief,
    briefRef: brief.briefRef,
    generatedBrief: brief.generatedBrief,
    generator: spend.generator,
    chargeSpend: spend.chargeSpend,
    watch: context.watch,
    effort: deps.effort,
    wholePrChangedLines: countPrChangedLines(inputs.files),
    loadContext: inputs.loadContext,
    log: context.log,
  });
  return { baselineSha: prevBrief.headSha, diff: revDiff, marksWritten: true };
}

/**
 * Mark the run succeeded, then sweep projections of heads this one replaced
 * before pickup: debounce replacement means no worker run carried them, so
 * terminal `superseded` applies as to a drained abort. A head triggered after
 * pickup is newer than this run and keeps its row.
 */
export async function finishRun(context: RunContext): Promise<void> {
  const { payload, projection, pickedUpAt, prRow, log } = context;
  await recordRunSuccess(context);
  const swept = await projection.supersedeStaleBriefs(
    payload.pullRequestId,
    payload.headSha,
    pickedUpAt,
  );
  if (swept > 0) {
    log.info(`generate: swept ${swept} stale pending brief projection(s)`);
  }
  log.info(
    `generate: succeeded for ${prRow.prNumber}@${payload.headSha.slice(0, 8)}`,
  );
  warnOnUnpaidTakeover(context);
}

/** A takeover claims, and so counts, even when nothing was left to pay for. */
function warnOnUnpaidTakeover(context: RunContext): void {
  const { recovering, run, log } = context;
  if (!recovering || run.attempt === undefined || run.providerCalls > 0) {
    return;
  }

  log.warn(
    "generate: the recovery run made no provider call, its claim still counts as an attempt",
    buildAttemptFields(run.attempt),
  );
}

/** A claimed run finishes through its claim; a stored-brief run settles the row. */
async function recordRunSuccess(context: RunContext): Promise<void> {
  const { projection, target, run, pickedUpAt } = context;
  if (run.runId === undefined) {
    await projection.settleStoredBrief(target, pickedUpAt);
    return;
  }

  const finished = await projection.finishRun(target, run.runId, {
    status: GenerationStatuses.SUCCEEDED,
  });
  throwOnClaimLost(finished);
}

async function recordGenerateAudit(
  context: RunContext,
  auditTarget: GenerateAuditTarget,
): Promise<void> {
  await writeAudit(context.deps.handle, {
    ...context.auditScope,
    ...auditTarget,
    actorType: AuditActorTypes.SYSTEM,
    operation: AUDIT_OPERATION_GENERATE,
    outcome: AuditOutcomes.OK,
  });
}
