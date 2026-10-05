import { type Brief, type PrLocator } from "brief-core";
import type { PullRequestInfo } from "github";
import type { Logger } from "logging";
import { scheduleUrlBoxRegeneration } from "../url-box-regeneration";
import {
  createArtifactStore,
  writeAudit,
  AuditOutcomes,
  AuditActorTypes,
  AuditMetadataKeys,
  createTenantRepository,
  isOwnerContext,
  createGenerationProjection,
  GenerationKinds,
  type GenerationProjection,
  type GenerationRow,
  type GenerationTarget,
  type PullRequestRow,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import { PrStates, PullRequestSources } from "types/pull-requests";
import { entryCommentBody } from "../entry-comment";
import { splitRepoSlug } from "../github-port";
import { PermanentJobError } from "../failure";
import { parseGeneratePayload, type ParsedGeneratePayload } from "../payload";
import { generateBrief, recoverStoredBrief } from "./logic/brief-generation";
import {
  resolveEntryCommentAllowed,
  resolveReadyEntryAllowed,
} from "./logic/entry-comment-gate";
import { createEntryCommentManager } from "./logic/entry-comment-manager";
import { generateCheckpointDeltas } from "./logic/checkpoint-deltas";
import { throwOnGitHubFailure } from "./logic/errors";
import { reportJobFailure } from "./logic/job-failure";
import { buildPrMetadata, recordResolvedStack } from "./logic/pr-metadata";
import { applySpendGate, refuseAtCap } from "./logic/spend-gate";
import { createTicketContextLoader } from "./logic/ticket-context";
import {
  countPrChangedLines,
  writeRevisionArtifacts,
} from "./logic/revision-artifacts";
import {
  createSupersessionWatch,
  SupersededSignal,
  bindAbortSignal,
} from "./logic/supersession-watch";
import { acquireRepoConfig, buildRepoConfigOrigin } from "../repo-config";
import {
  AUDIT_OPERATION_GENERATE,
  DEFAULT_HEAD_POLL_INTERVAL_MS,
} from "./consts";
import type {
  BriefRef,
  CoreMessageLog,
  GenerateTask,
  GenerateTaskDeps,
  GenerateTaskHelpers,
  PrefetchedSpan,
  RunState,
} from "./types";
import { getBriefTarget, getPrLocator, createNoopLogger } from "./utils";

export type { GenerateTaskDeps } from "./types";

/**
 * Build the generate task. The returned function is graphile's `Task` shape;
 * tests call it directly with a payload (helpers optional).
 */
export function createGenerateTask(deps: GenerateTaskDeps): GenerateTask {
  const log = deps.log ?? createNoopLogger();

  return async function generate(
    rawPayload: unknown,
    helpers?: GenerateTaskHelpers,
  ): Promise<void> {
    const parsed = parseGeneratePayload(rawPayload);
    if (!parsed.ok) {
      // Poisoned/foreign job: no projection row is addressable, drop it.
      log.warn(`generate: dropping malformed payload — ${parsed.error}`);
      return;
    }
    const payload = parsed.value;
    const jobLog = log.child({
      prId: String(payload.pullRequestId),
      headSha: payload.headSha,
    });
    const projection = createGenerationProjection(deps.handle, payload.ctx);
    const target = getBriefTarget(payload);
    const run: RunState = { leaveRow: false };

    try {
      await runGeneration(
        deps,
        payload,
        target,
        run,
        helpers?.abortSignal,
        helpers?.job,
        jobLog,
      );
    } catch (error) {
      if (error instanceof SupersededSignal) {
        if (!run.leaveRow) await projection.markSuperseded(target);
        jobLog.info(`generate: superseded (${error.message})`);
        return;
      }
      if (helpers?.abortSignal?.aborted === true) {
        // Graceful shutdown aborted the in-flight work. NOT a supersession
        // (the head didn't move) and NOT a failure (nothing is wrong with the
        // job): leave the projection as-is and rethrow so graphile returns
        // the job to the queue for the next worker.
        jobLog.info("generate: aborted by shutdown — job returns to the queue");
        throw error;
      }
      const permanent = await reportJobFailure(error, {
        deps,
        projection,
        target,
        leaveRow: run.leaveRow,
        job: helpers?.job,
        log: jobLog,
      });
      if (permanent) {
        return;
      }
      throw error;
    }
  };
}

/**
 * A run ingest did not project as pending projects itself. Only a succeeded
 * row (or none) means that: a failed row is graphile retrying a transient
 * failure, and a retry keeps its status until the gate decides.
 */
async function projectIfUnprojected(
  projection: GenerationProjection,
  target: GenerationTarget,
  current: GenerationRow | undefined,
): Promise<void> {
  if (
    current !== undefined &&
    current.status !== GenerationStatuses.SUCCEEDED
  ) {
    return;
  }
  const projected = await projection.upsertPending(target);
  if (!projected.ok) {
    throw new Error(
      `generate: could not project the run: ${projected.error.code}`,
    );
  }
}

async function runGeneration(
  deps: GenerateTaskDeps,
  payload: ParsedGeneratePayload,
  target: GenerationTarget,
  run: RunState,
  shutdownSignal: AbortSignal | undefined,
  job: GenerateTaskHelpers["job"],
  log: Logger,
): Promise<void> {
  const { handle, github } = deps;
  const { ctx, pullRequestId, headSha } = payload;
  const repo = createTenantRepository(handle, ctx);
  const projection = createGenerationProjection(handle, ctx);
  const store = createArtifactStore(handle, ctx);
  const auditScope = isOwnerContext(ctx)
    ? { installationId: null, source: PullRequestSources.URL }
    : {
        installationId: ctx.installationId,
        source: PullRequestSources.INSTALLATION,
      };

  const pr = await repo.pullRequests.getById(pullRequestId);
  if (pr === undefined) {
    // Row purged/never existed: nothing addressable, nothing to mark.
    log.warn(
      `generate: pull_request ${pullRequestId} not in tenant — dropping job`,
    );
    return;
  }
  if (
    payload.grantId === undefined &&
    (pr.state === PrStates.CLOSED || pr.state === PrStates.MERGED)
  ) {
    // App world: a brief for a terminal PR would never be read (same rule as
    // the enqueue gate); the pending projection row must not sit forever.
    // Url-box jobs generate regardless, briefing a merged PR is that door's
    // primary use.
    throw new SupersededSignal(`pull_request ${pr.prNumber} is ${pr.state}`);
  }
  if (pr.repoSlug === null || splitRepoSlug(pr.repoSlug) === undefined) {
    throw new PermanentJobError("pull_request row has no usable repo slug");
  }
  // Re-bind post-guard so the narrowing survives into the inner closure.
  const prRow: PullRequestRow = pr;
  // A succeeded row is one ingest left alone for work over a stored brief:
  // nothing before the brief lookup may mark it. The fresh path below claims
  // it and clears the flag.
  const projected = await projection.get(target);
  run.leaveRow = projected?.status === GenerationStatuses.SUCCEEDED;
  // Taken before the source opens: a url-box source may read the head while
  // opening and serve that read as the run's first.
  const pickedUpAt = new Date();
  // The cap gate needs the source for an Entry comment update, and the brief
  // lookup needs the live base, so a capped job pays one PR read and no more.
  const source =
    payload.grantId === undefined
      ? await github.openPullRequestSource(
          payload.ctx.installationId,
          pr.repoSlug,
          pr.prNumber,
        )
      : await github.openUrlBoxPullRequestSource(
          payload.grantId,
          pr.repoSlug,
          pr.prNumber,
          payload.ctx.ownerUserId,
        );
  const entryCommentManager = createEntryCommentManager(payload, {
    source,
    repo,
    prRow,
    publicBaseUrl: deps.publicBaseUrl,
    log,
  });

  // Installation jobs rely on the newer push webhook. Url-box jobs may have no webhook,
  // so every supersession path must schedule the observed head before standing down.
  const grantId = payload.grantId;
  async function scheduleUrlBoxRegenerationIfMoved(
    observed?: PullRequestInfo,
  ): Promise<void> {
    if (grantId === undefined) {
      return;
    }
    // A read the caller already has beats a fresh one: the successor is known
    // to exist, and re-reading could fail. `throwOnGitHubFailure` on the fallback is
    // deliberate, a transient failure must RETRY the job rather than finalize
    // `superseded`, which would drop the successor head on the floor.
    const observedPr =
      observed ?? throwOnGitHubFailure(await source.fetchPullRequest());
    if (observedPr.headSha === headSha) {
      return;
    }
    await scheduleUrlBoxRegeneration(deps.handle, payload.ctx, {
      prNumber: prRow.prNumber,
      repoId: prRow.repoId,
      grantId,
      info: observedPr,
      log,
    });
  }

  const prInfo = throwOnGitHubFailure(await source.fetchPullRequest());
  // The Inbox sorts by GitHub's updated_at; a url row learns it here and on
  // the live read, an installation row here and from webhooks.
  const stamped = await repo.pullRequests.advanceGithubUpdatedAt(
    pullRequestId,
    prInfo.updatedAt,
  );
  if (!stamped.ok) {
    log.debug(`generate: updated_at stamp skipped, ${stamped.error.message}`);
  }
  if (prInfo.headSha !== headSha) {
    await scheduleUrlBoxRegenerationIfMoved(prInfo);
    throw new SupersededSignal(
      `head advanced ${headSha.slice(0, 8)} → ${prInfo.headSha.slice(0, 8)}`,
    );
  }
  if (payload.grantId === undefined && prInfo.state !== "open") {
    throw new SupersededSignal(
      `pull_request ${pr.prNumber} is ${prInfo.state} on GitHub`,
    );
  }

  // A stored brief for the pair means this run reaches no model: it skips
  // the cap and leaves the generation row as it found it.
  const priorBriefs = await store.briefs.listForPullRequest(pullRequestId);
  const existingBrief = priorBriefs.find(
    (row) => row.baseSha === prInfo.baseSha && row.headSha === headSha,
  );
  const prevBrief = priorBriefs
    .toReversed()
    .find((row) => row.headSha !== headSha);
  const gateInputs = {
    deps,
    projection,
    target,
    prRow,
    repoSlug: pr.repoSlug,
    entryCommentManager,
    job,
    log,
  };
  const watch = createSupersessionWatch(
    source,
    headSha,
    deps.headPollIntervalMs ?? DEFAULT_HEAD_POLL_INTERVAL_MS,
  );

  /**
   * The ready Entry, once the artifact exists. On skip reruns an identical
   * ready body must not re-ping; only skips need the read, a fresh run still
   * carries a generating body and always refreshes.
   */
  async function postReadyEntry(
    entryCommentAllowed: boolean,
    headIndex: number,
  ): Promise<void> {
    await watch.assertCurrent();
    const readyEntryAllowed = await resolveReadyEntryAllowed(payload, {
      prInfo,
      source,
      entryCommentAllowed,
      log,
    });
    if (!readyEntryAllowed) return;
    const readyBody = entryCommentBody(
      entryCommentManager.buildDeepLink(headIndex),
    );
    const alreadyLive =
      existingBrief !== undefined &&
      (await entryCommentManager.matches(readyBody));
    if (alreadyLive) {
      log.info(
        "generate: entry comment already current — skipping repost (no re-ping)",
      );
      return;
    }
    await entryCommentManager.refresh(readyBody);
  }

  /** What a capped run over a stored brief still does: the Entry reaches no model. */
  async function postOwedReadyEntry(headIndex: number): Promise<void> {
    const repoConfig = prInfo.draft
      ? await acquireRepoConfig(source, log)
      : undefined;
    const entryCommentAllowed = await resolveEntryCommentAllowed(payload, {
      prInfo,
      repoConfig,
      entryCommentManager,
      log,
    });
    await postReadyEntry(entryCommentAllowed, headIndex);
  }

  if (existingBrief !== undefined) {
    run.leaveRow = true;
    if (await refuseAtCap(payload, gateInputs)) {
      await postOwedReadyEntry(existingBrief.headIndex);
      return;
    }
  } else {
    // Ingest projects a run it expects; one it classified as covered by the
    // stored base, while the live base moved, arrives unprojected and
    // projects itself, so the attempt counts and the wait state shows.
    await projectIfUnprojected(projection, target, projected);
    run.leaveRow = false;
    const capped = await applySpendGate(payload, gateInputs);
    if (capped) {
      return;
    }
  }

  // The generator aborts on EITHER trigger: a superseding push (the watch) or
  // graceful shutdown (graphile's helpers.abortSignal). The two are told
  // apart in `createGenerateTask`'s catch, superseded vs back-to-queue.
  const generatorSignal =
    shutdownSignal === undefined
      ? watch.signal
      : AbortSignal.any([watch.signal, shutdownSignal]);
  const generator = bindAbortSignal(deps.generator, generatorSignal);
  try {
    await generateArtifacts();
  } catch (error) {
    // The poller aborting an in-flight SDK call surfaces as its rejection (an
    // APIUserAbortError); that is the abort, not a failure.
    const outcome =
      watch.signal.aborted && !(error instanceof SupersededSignal)
        ? new SupersededSignal("head advanced mid-call (streaming poll)")
        : error;
    if (outcome instanceof SupersededSignal) {
      await scheduleUrlBoxRegenerationIfMoved(watch.getObserved());
    }
    throw outcome;
  } finally {
    watch.stop();
  }
  return;

  async function generateArtifacts(): Promise<void> {
    watch.startPolling();
    const files = throwOnGitHubFailure(await source.fetchPullRequestFiles());
    const diff = throwOnGitHubFailure(await source.fetchDiff());
    const openPullRequests = await source.listOpenPullRequests();

    const locator: PrLocator = getPrLocator(prRow);
    const meta = buildPrMetadata({
      prInfo,
      files,
      prRow,
      openPullRequests,
      log,
    });
    await recordResolvedStack({ repo, prRow, meta, log, now: new Date() });

    const coreMessageLog: CoreMessageLog = (message) => log.info(message);

    // The anchoring plan needs the prevHead→head span BEFORE the model call;
    // the revision-artifact phase below reuses the same Result (unwrap stays
    // deferred there so a permanent 406 still lands after the brief write).
    const prevSpanFetch =
      prevBrief === undefined
        ? undefined
        : await source.fetchCompareDiff(prevBrief.headSha, headSha);

    let briefRef: BriefRef;
    let generatedBrief: Brief | undefined;
    // Fresh default-branch config reads fail open with recorded fetch-failed outcomes.
    // Draft skip drains also need settings for the Entry gate; unavailable settings close it.
    const repoConfig =
      existingBrief === undefined || prInfo.draft
        ? await acquireRepoConfig(source, log)
        : undefined;
    if (repoConfig !== undefined && existingBrief === undefined) {
      // Record config outcomes before generation so failed or superseded runs retain them.
      // A draft skip drain must not overwrite outcomes with config that never shaped the brief.
      await projection.recordRepoConfig(
        target,
        buildRepoConfigOrigin(repoConfig),
      );
    }
    const loadContext = createTicketContextLoader(payload, {
      deps,
      source,
      prInfo,
      locator,
      meta,
      repoConfig,
      coreMessageLog,
      log,
    });
    const entryCommentAllowed = await resolveEntryCommentAllowed(payload, {
      prInfo,
      repoConfig,
      entryCommentManager,
      log,
    });
    if (existingBrief === undefined) {
      const generated = await generateBrief(payload, {
        fullRegeneration: deps.fullRegeneration,
        anchorGenerator: deps.generator,
        effort: deps.effort,
        store,
        source,
        projection,
        target,
        entryCommentManager,
        entryCommentAllowed,
        priorBriefs,
        prevBrief,
        prevSpanFetch,
        prInfo,
        files,
        diff,
        locator,
        meta,
        repoConfig,
        loadContext,
        generator,
        coreMessageLog,
        log,
      });
      briefRef = generated.briefRef;
      generatedBrief = generated.generatedBrief;
      await writeAudit(handle, {
        ...auditScope,
        actorType: AuditActorTypes.SYSTEM,
        operation: AUDIT_OPERATION_GENERATE,
        outcome: AuditOutcomes.OK,
        targetType: "brief",
        targetId: briefRef.id,
        metadata: { [AuditMetadataKeys.KIND]: GenerationKinds.BRIEF },
      });
    } else {
      log.info(
        `generate: brief for ${headSha.slice(0, 8)} already stored — skipping generation`,
      );
      briefRef = { id: existingBrief.id, headIndex: existingBrief.headIndex };
      generatedBrief = await recoverStoredBrief(payload, {
        store,
        prevBrief,
        baseSha: prInfo.baseSha,
        log,
      });
    }

    // The ready Entry lands before the slower delta work.
    await postReadyEntry(entryCommentAllowed, briefRef.headIndex);

    // The prevHead...head span diff is fetched ONCE and reused by the delta
    // loop below, a checkpoint at the previous briefed head (the common
    // reviewed-last-push case) must not re-fetch the same compare diff.
    let prevSpan: PrefetchedSpan | undefined;
    if (prevBrief !== undefined && prevSpanFetch !== undefined) {
      const revDiff = throwOnGitHubFailure(prevSpanFetch);
      prevSpan = {
        baselineSha: prevBrief.headSha,
        diff: revDiff,
        marksWritten: true,
      };
      await writeRevisionArtifacts(payload, {
        revisionNarrative: deps.revisionNarrative,
        hugeSpanRatio: deps.hugeSpanRatio,
        store,
        locator,
        meta,
        revDiff,
        prevBrief,
        briefRef,
        generatedBrief,
        generator,
        watch,
        effort: deps.effort,
        wholePrChangedLines: countPrChangedLines(files),
        loadContext,
        log,
      });
    }

    const deltaCount = await generateCheckpointDeltas(payload, {
      hugeSpanRatio: deps.hugeSpanRatio,
      store,
      repo,
      locator,
      meta,
      source,
      priorBriefs,
      prevSpan,
      generator,
      watch,
      effort: deps.effort,
      briefHeadIndex: briefRef.headIndex,
      wholePrChangedLines: countPrChangedLines(files),
      loadContext,
      log,
    });
    if (deltaCount > 0) {
      await writeAudit(handle, {
        ...auditScope,
        actorType: AuditActorTypes.SYSTEM,
        operation: AUDIT_OPERATION_GENERATE,
        outcome: AuditOutcomes.OK,
        targetType: "pull_request",
        targetId: pullRequestId,
        metadata: {
          [AuditMetadataKeys.KIND]: GenerationKinds.DELTA,
          [AuditMetadataKeys.COUNT]: deltaCount,
        },
      });
    }

    await projection.markSucceeded(target);
    // Sweep projections of heads this one replaced pre-drain: debounce
    // replacement means no worker run ever carried them, so terminal
    // `superseded` applies the same as to a drained abort. A head triggered
    // after pickup is newer than this run and keeps its row.
    const swept = await projection.supersedeStaleBriefs(
      pullRequestId,
      headSha,
      pickedUpAt,
    );
    if (swept > 0) {
      log.info(`generate: swept ${swept} stale pending brief projection(s)`);
    }
    log.info(
      `generate: succeeded for ${prRow.prNumber}@${headSha.slice(0, 8)}`,
    );
  }
}
