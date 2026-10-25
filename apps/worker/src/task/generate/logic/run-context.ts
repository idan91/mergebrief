import type { PullRequestInfo } from "github";
import {
  createArtifactStore,
  createTenantRepository,
  isOwnerContext,
  type PullRequestRow,
  type ScopeContext,
  type TenantRepository,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import { PrStates, PullRequestSources } from "types/pull-requests";
import { PermanentJobError } from "../../failure";
import { splitRepoSlug, type PullRequestSource } from "../../github-port";
import { scheduleUrlBoxRegeneration } from "../../url-box-regeneration";
import { CLAIM_LEASE_MS, DEFAULT_HEAD_POLL_INTERVAL_MS } from "../consts";
import type {
  AuditScope,
  RunContext,
  RunProgress,
  RunScope,
  RunStart,
} from "../types";
import { createEntryCommentManager } from "./entry-comment-manager";
import { throwOnGitHubFailure } from "./errors";
import {
  createSupersessionWatch,
  SupersededSignal,
} from "./supersession-watch";

interface GuardedPullRequest {
  readonly prRow: PullRequestRow;
  readonly repoSlug: string;
}

/**
 * Read the row, open its source and take the first GitHub read, recording
 * the scope in `progress` once the source opened. Undefined means the row is
 * gone and the job drops; a terminal or moved PR throws `SupersededSignal`.
 */
export async function openRun(
  start: RunStart,
  progress: RunProgress,
): Promise<RunContext | undefined> {
  const scope = await openRunScope(start);
  if (scope === undefined) {
    return undefined;
  }
  progress.scope = scope;

  const { payload, store, deps } = scope;
  const prInfo = await readLivePullRequest(scope);
  // A stored brief for the pair means this run reaches no model.
  const priorBriefs = await store.briefs.listForPullRequest(
    payload.pullRequestId,
  );
  const existingBrief = priorBriefs.find(
    (row) => row.baseSha === prInfo.baseSha && row.headSha === payload.headSha,
  );
  const prevBrief = priorBriefs
    .toReversed()
    .find((row) => row.headSha !== payload.headSha);
  const watch = createSupersessionWatch(
    scope.source,
    payload.headSha,
    deps.headPollIntervalMs ?? DEFAULT_HEAD_POLL_INTERVAL_MS,
    () => renewRunClaim(start),
  );

  return { ...scope, prInfo, priorBriefs, existingBrief, prevBrief, watch };
}

/** True while the run holds its claim, or holds none to lose. */
async function renewRunClaim(start: RunStart): Promise<boolean> {
  const { projection, target, run } = start;
  if (run.runId === undefined) {
    return true;
  }

  const renewed = await projection.renewLease(
    target,
    run.runId,
    CLAIM_LEASE_MS,
  );
  return renewed.ok;
}

async function openRunScope(start: RunStart): Promise<RunScope | undefined> {
  const { deps, payload, projection, target, run, log } = start;
  const repo = createTenantRepository(deps.handle, payload.ctx);
  const guarded = await readGuardedPullRequest(start, repo);
  if (guarded === undefined) {
    return undefined;
  }

  // A succeeded row is one ingest left alone for work over a stored brief:
  // nothing before the run decision may mark it.
  const projected = await projection.get(target);
  run.leaveRow = projected?.status === GenerationStatuses.SUCCEEDED;
  // Taken before the source opens: a url-box source may read the head while
  // opening and serve that read as the run's first.
  const pickedUpAt = new Date();
  const source = await openRunSource(start, guarded);
  const entryCommentManager = createEntryCommentManager(payload, {
    source,
    repo,
    prRow: guarded.prRow,
    publicBaseUrl: deps.publicBaseUrl,
    log,
  });

  return {
    ...start,
    ...guarded,
    repo,
    store: createArtifactStore(deps.handle, payload.ctx),
    auditScope: getAuditScope(payload.ctx),
    projected,
    pickedUpAt,
    source,
    entryCommentManager,
  };
}

async function readGuardedPullRequest(
  start: RunStart,
  repo: TenantRepository,
): Promise<GuardedPullRequest | undefined> {
  const { payload, log } = start;
  const pr = await repo.pullRequests.getById(payload.pullRequestId);
  if (pr === undefined) {
    log.warn(
      `generate: pull_request ${payload.pullRequestId} not in tenant — dropping job`,
    );
    return undefined;
  }

  const terminal = pr.state === PrStates.CLOSED || pr.state === PrStates.MERGED;
  if (payload.grantId === undefined && terminal) {
    // App world: a brief for a terminal PR would never be read. Url-box jobs
    // generate regardless, briefing a merged PR is that door's primary use.
    throw new SupersededSignal(`pull_request ${pr.prNumber} is ${pr.state}`);
  }
  if (pr.repoSlug === null || splitRepoSlug(pr.repoSlug) === undefined) {
    throw new PermanentJobError("pull_request row has no usable repo slug");
  }

  return { prRow: pr, repoSlug: pr.repoSlug };
}

async function openRunSource(
  start: RunStart,
  guarded: GuardedPullRequest,
): Promise<PullRequestSource> {
  const { deps, payload, log } = start;
  const { prRow, repoSlug } = guarded;
  if (payload.grantId === undefined) {
    return deps.github.openPullRequestSource(
      payload.ctx.installationId,
      repoSlug,
      prRow.prNumber,
    );
  }

  return deps.github.openUrlBoxPullRequestSource({
    grantId: payload.grantId,
    repoSlug,
    prNumber: prRow.prNumber,
    ownerUserId: payload.ctx.ownerUserId,
    log,
  });
}

function getAuditScope(ctx: ScopeContext): AuditScope {
  if (isOwnerContext(ctx)) {
    return { installationId: null, source: PullRequestSources.URL };
  }

  return {
    installationId: ctx.installationId,
    source: PullRequestSources.INSTALLATION,
  };
}

async function readLivePullRequest(scope: RunScope): Promise<PullRequestInfo> {
  const { payload, source, repo, log } = scope;
  const { headSha } = payload;
  const prInfo = throwOnGitHubFailure(await source.fetchPullRequest());
  // The Inbox sorts by GitHub's updated_at; a url row learns it here and on
  // the live read, an installation row here and from webhooks.
  const stamped = await repo.pullRequests.advanceGithubUpdatedAt(
    payload.pullRequestId,
    prInfo.updatedAt,
  );
  if (stamped === undefined) {
    log.debug(
      `generate: updated_at stamp skipped, pull_request ${payload.pullRequestId} not found`,
    );
  }

  if (prInfo.headSha !== headSha) {
    await scheduleUrlBoxRegenerationIfMoved(scope, prInfo);
    throw new SupersededSignal(
      `head advanced ${headSha.slice(0, 8)} → ${prInfo.headSha.slice(0, 8)}`,
    );
  }
  if (payload.grantId === undefined && prInfo.state !== "open") {
    throw new SupersededSignal(
      `pull_request ${scope.prRow.prNumber} is ${prInfo.state} on GitHub`,
    );
  }

  return prInfo;
}

/**
 * Installation jobs rely on the newer push webhook; a url-box job may have
 * none, so every supersession path schedules the observed head before
 * standing down. A read the caller already has beats a fresh one. The
 * fallback read throws on failure on purpose: a transient failure must retry
 * the job rather than finalize `superseded` and drop the successor head.
 */
export async function scheduleUrlBoxRegenerationIfMoved(
  scope: RunScope,
  observed?: PullRequestInfo,
): Promise<void> {
  const { deps, payload, source, prRow, log } = scope;
  const { grantId } = payload;
  if (grantId === undefined) {
    return;
  }

  const observedPr =
    observed ?? throwOnGitHubFailure(await source.fetchPullRequest());
  if (observedPr.headSha === payload.headSha) {
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
