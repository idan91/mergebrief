import type { Generator } from "generators";
import {
  AuditActorTypes,
  AuditMetadataKeys,
  AuditOutcomes,
  GenerationKinds,
  writeAudit,
  type AuditEntry,
} from "persistence";
import { AUDIT_OPERATION_GENERATE } from "../consts";
import {
  RunDecisionKinds,
  type GeneratingRun,
  type PrefetchedSpan,
  type ProducedBrief,
  type RunContext,
  type RunInputs,
} from "../types";
import { generateBrief, recoverStoredBrief } from "./brief-generation";
import { generateCheckpointDeltas } from "./checkpoint-deltas";
import { throwOnGitHubFailure } from "./errors";
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
    return generateFreshBrief(context, inputs, generator);
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
  inputs: RunInputs,
  generator: Generator,
): Promise<ProducedBrief> {
  const { deps, payload } = context;
  const generated = await generateBrief(payload, {
    fullRegeneration: deps.fullRegeneration,
    anchorGenerator: deps.generator,
    effort: deps.effort,
    store: context.store,
    source: context.source,
    projection: context.projection,
    target: context.target,
    entryCommentManager: context.entryCommentManager,
    entryCommentAllowed: inputs.entryCommentAllowed,
    priorBriefs: context.priorBriefs,
    prevBrief: context.prevBrief,
    prevSpanFetch: inputs.prevSpanFetch,
    prInfo: context.prInfo,
    files: inputs.files,
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
  const prevSpan = await writeRevisionSpan(context, inputs, brief, generator);
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
  generator: Generator,
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
    generator,
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
  const { payload, projection, target, pickedUpAt, prRow, log } = context;
  await projection.markSucceeded(target);
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
