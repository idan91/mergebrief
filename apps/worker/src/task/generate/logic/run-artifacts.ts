import type { Generator } from "generators";
import {
  AuditActorTypes,
  AuditMetadataKeys,
  AuditOutcomes,
  GenerationKinds,
  writeAudit,
  type AuditEntry,
} from "persistence";
import { PrSpanFailureKinds } from "brief-core/pr-span";
import { GenerationStatuses } from "types/generations";
import { AUDIT_OPERATION_GENERATE } from "../consts";
import type { ParsedGeneratePayload } from "../../payload";
import {
  RunDecisionKinds,
  type BriefGenerationInputs,
  type BriefOriginLoader,
  type BriefRef,
  type FreshRun,
  type GeneratedBrief,
  type GenerationOrigin,
  type GeneratingRun,
  type MultiCallRunInputs,
  type PrefetchedSpan,
  type ProducedBrief,
  type RevisionArtifactInputs,
  type RunContext,
  type RunInputs,
} from "../types";
import {
  buildAttemptFields,
  getGenerationOrigin,
  isReleasedHold,
} from "../utils";
import { listRunStops, traceRunStep } from "./step-span";
import {
  backfillMissingChunkLayout,
  recoverStoredBrief,
  writeFreshBrief,
} from "./brief-generation";
import {
  generateCheckpointDeltas,
  listCheckpointBaselines,
} from "./checkpoint-deltas";
import { createMultiCallRun, sweepSpanParts } from "./generation-parts";
import { readDefaultBranchGitAttributes } from "./git-attributes";
import { createRevisionSpanReader, readSpanBaseRefs } from "./revision-span";
import { dropStaleMarks } from "./span-marks";
import { createSpendCharge } from "./spend-gate";
import { throwOnClaimLost } from "./supersession-watch";
import {
  countPrChangedLines,
  resolveNarrativeSkip,
  writeRevisionArtifacts,
  writeSkippedNarrative,
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
  await sweepSpanParts(context);
  const generatedBrief = await recoverStoredBrief(payload, {
    store,
    prevBrief,
    baseSha: prInfo.baseSha,
    log,
  });
  await backfillMissingChunkLayout({
    store,
    pullRequestId: payload.pullRequestId,
    storedBrief,
    diff: inputs.diff,
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
  const gitAttributesRead = await readDefaultBranchGitAttributes(
    context.source,
    context.log,
  );
  const multiCall = createMultiCallRun(
    context,
    decision.runId,
    gitAttributesRead,
  );
  const generated = await writeFreshBriefOverParts(payload, multiCall, {
    fullRegeneration: deps.fullRegeneration,
    anchorGenerator: deps.generator,
    effort: deps.effort,
    store: context.store,
    source: context.source,
    projection: context.projection,
    target: context.target,
    runId: decision.runId,
    watch: context.watch,
    entryCommentManager: context.entryCommentManager,
    entryCommentAllowed: inputs.entryCommentAllowed,
    generatingEntryIsSilent: isReleasedHold(context.projected),
    translate: deps.translate,
    priorBriefs: context.priorBriefs,
    prevBrief: context.prevBrief,
    prevSpanRead: inputs.prevSpanRead,
    prInfo: context.prInfo,
    diff: inputs.diff,
    locator: inputs.locator,
    meta: inputs.meta,
    repoConfig: inputs.repoConfig,
    loadContext: inputs.loadContext,
    stops: listRunStops(context),
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

/** The fresh brief, with the span's parts discarded when the failure is the merge's. */
async function writeFreshBriefOverParts(
  payload: ParsedGeneratePayload,
  multiCall: MultiCallRunInputs,
  inputs: Omit<BriefGenerationInputs, "multiCall">,
): Promise<GeneratedBrief> {
  try {
    return await writeFreshBrief(payload, { ...inputs, multiCall });
  } catch (error) {
    await multiCall.discardPartsOnMergeFailure(error);
    throw error;
  }
}

/**
 * The revision artifacts over the prevHead...head span, then one delta core
 * per checkpoint, the one sharing the revision span's key first. The span
 * read before the model call is reused by the delta loop, so a checkpoint at
 * the previous briefed head does not re-read it.
 */
export async function writeFollowOnArtifacts(
  context: RunContext,
  inputs: RunInputs,
  brief: ProducedBrief,
  generator: Generator,
): Promise<void> {
  const { deps, payload, watch, log } = context;
  const chargeSpend = createSpendCharge(context);
  const checkpointShas = await listCheckpointBaselines(
    context.repo,
    payload,
    context.prevBrief?.headSha,
  );
  const spend = { generator, chargeSpend };
  const prevSpan = await traceRunStep(
    "generation.revision",
    listRunStops(context),
    () => writeRevisionSpan(context, inputs, brief, spend, checkpointShas),
  );
  const deltaCount = await traceRunStep(
    "generation.deltas",
    listRunStops(context),
    async (span) => {
      const written = await generateCheckpointDeltas(payload, {
        hugeSpanRatio: deps.hugeSpanRatio,
        store: context.store,
        baselineShas: checkpointShas,
        locator: inputs.locator,
        meta: inputs.meta,
        source: context.source,
        priorBriefs: context.priorBriefs,
        prevSpan,
        readSpan: createRevisionSpanReader(context),
        baseSha: context.prInfo.baseSha,
        generator,
        watch,
        chargeSpend,
        effort: deps.effort,
        briefHeadIndex: brief.briefRef.headIndex,
        wholePrChangedLines: countPrChangedLines(inputs.files),
        loadContext: inputs.loadContext,
        stops: listRunStops(context),
        loadBriefOrigin: createBriefOriginLoader(context, brief),
        log,
      });
      span.setAttributes({ "mergebrief.deltas_written": written });
      return written;
    },
  );
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

/**
 * A skip record carries the brief's origin, as the narrative stub does. A
 * stored brief this run did not read back is read once, and only when a
 * skip needs it.
 */
function createBriefOriginLoader(
  context: RunContext,
  brief: ProducedBrief,
): BriefOriginLoader {
  const { generatedBrief } = brief;
  if (generatedBrief !== undefined) {
    const origin = getGenerationOrigin(generatedBrief.generation);
    return () => Promise.resolve(origin);
  }

  let loaded: Promise<GenerationOrigin> | undefined;
  return () => {
    loaded ??= readStoredBriefOrigin(context);
    return loaded;
  };
}

async function readStoredBriefOrigin(
  context: RunContext,
): Promise<GenerationOrigin> {
  const { store, payload, prInfo } = context;
  const row = await store.briefs.get(
    payload.pullRequestId,
    prInfo.baseSha,
    payload.headSha,
  );
  if (row === undefined) {
    throw new Error("generate: the run's stored brief row is gone");
  }

  return { provider: row.provider, model: row.model, effort: row.effort };
}

async function writeRevisionSpan(
  context: RunContext,
  inputs: RunInputs,
  brief: ProducedBrief,
  spend: Pick<RevisionArtifactInputs, "generator" | "chargeSpend">,
  checkpointShas: readonly string[],
): Promise<PrefetchedSpan | undefined> {
  const { deps, payload, prevBrief, log } = context;
  const spanRead = inputs.prevSpanRead;
  if (prevBrief === undefined || spanRead === undefined) {
    return undefined;
  }

  const baselineSha = prevBrief.headSha;
  if (!spanRead.ok) {
    const diffTooLarge = spanRead.error.kind === PrSpanFailureKinds.TOO_LARGE;
    if (diffTooLarge) {
      await writeRefusedSpanSkip(context, prevBrief, brief);
    } else {
      log.warn("generate: revision span unavailable; skipping its artifacts");
    }
    return { baselineSha, unread: true, diffTooLarge };
  }

  const span = spanRead.value;
  const refs = readSpanBaseRefs(prevBrief, context.prInfo.baseSha);
  const marksDuty = await writeRevisionArtifacts(payload, {
    revisionNarrative: deps.revisionNarrative,
    hugeSpanRatio: deps.hugeSpanRatio,
    store: context.store,
    locator: inputs.locator,
    meta: inputs.meta,
    span,
    refs,
    checkpointSharesSpan: checkpointShas.includes(baselineSha),
    prevBrief,
    briefRef: brief.briefRef,
    generatedBrief: brief.generatedBrief,
    generator: spend.generator,
    chargeSpend: spend.chargeSpend,
    watch: context.watch,
    stops: listRunStops(context),
    effort: deps.effort,
    wholePrChangedLines: countPrChangedLines(inputs.files),
    loadContext: inputs.loadContext,
    log,
  });
  return { baselineSha, span, refs, marksDuty };
}

/** A span GitHub would not render still gets its skip record, without marks: stale ones are dropped first. */
async function writeRefusedSpanSkip(
  context: RunContext,
  prevBrief: RevisionArtifactInputs["prevBrief"],
  brief: ProducedBrief,
): Promise<void> {
  const { deps, payload, store, log } = context;
  const { generatedBrief, briefRef } = brief;
  const skipped = resolveNarrativeSkip(deps.revisionNarrative, true);
  if (generatedBrief === undefined || skipped === undefined) {
    return;
  }

  const key = {
    pullRequestId: payload.pullRequestId,
    baselineSha: prevBrief.headSha,
    headSha: payload.headSha,
  };
  const refs = readSpanBaseRefs(prevBrief, context.prInfo.baseSha);
  const record = {
    store,
    prevBrief,
    briefRef,
    generatedBrief,
    log,
    dropStaleMarks: () => dropStaleMarks(store, key, refs),
  };
  await writeSkippedNarrative(payload, record, skipped);
}

/**
 * Mark the run succeeded, then sweep projections of heads this one replaced
 * before pickup: debounce replacement means no worker run carried them, so
 * terminal `superseded` applies as to a drained abort. A head triggered after
 * pickup is newer than this run and keeps its row.
 */
export async function finishRun(
  context: RunContext,
  briefRef: BriefRef,
): Promise<void> {
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
  log.info("generation succeeded", {
    evt: "generation.succeeded",
    prNumber: prRow.prNumber,
    briefId: String(briefRef.id),
  });
  warnOnUnpaidTakeover(context);
}

/** A takeover claims, and so uses one of the head's attempts, even when it costs no unit. */
function warnOnUnpaidTakeover(context: RunContext): void {
  const { recovering, run, log } = context;
  if (!recovering || run.attempt === undefined || run.providerCalls > 0) {
    return;
  }

  log.warn(
    "generate: the recovery run made no provider call, its claim still used one of the head's attempts",
    buildAttemptFields(run.attempt),
  );
}

/**
 * A run standing on the pair's stored brief without a claim settles the row
 * it found pending (a claim released at shutdown) or failed (an earlier
 * attempt), whether its owed work landed, met the cap or failed for good.
 */
export async function settleStoredBriefRun(context: RunContext): Promise<void> {
  const { projection, target, run, pickedUpAt } = context;
  if (run.standsOnStoredBrief !== true) {
    return;
  }
  await sweepSpanParts(context);
  await projection.settleStoredBrief(target, pickedUpAt);
}

/**
 * A claimed run finishes through its claim, first giving its units back
 * when it made no model call, as a brief carried over an unchanged span
 * does; a stored-brief run settles the row.
 */
async function recordRunSuccess(context: RunContext): Promise<void> {
  const { projection, target, run, pickedUpAt } = context;
  if (run.runId === undefined) {
    await projection.settleStoredBrief(target, pickedUpAt);
    return;
  }

  if (run.providerCalls === 0) {
    throwOnClaimLost(await projection.refundRun(run.runId));
    context.log.info(
      "generate: run made no model call, its attempt row now costs 0 units",
    );
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
