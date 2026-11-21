import type { TFunction } from "i18next";
import { isPermanentGitHubError, type PullRequestInfo } from "github";
import type { Logger } from "logging";
import {
  createArtifactStore,
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  parseUnmetConditions,
  ScopeViolationError,
  utcDayBounds,
  type BriefSpanRow,
  type GenerationRow,
  type PullRequestRow,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import {
  buildEntryCommentBody,
  buildEntryCommentCappedBody,
  buildEntryCommentClosedBody,
  buildEntryCommentFailedBody,
  buildEntryCommentHeldBody,
  buildEntryCommentOnDemandBody,
  isEntryCommentBody,
  isHeadClosedEntryBody,
  isHeadReadyEntryBody,
  isUnsettledEntryBody,
  isOpenHeadEntryBody,
} from "../../entry-comment";
import { PermanentJobError, TransientJobError } from "../../failure";
import { splitRepoSlug, type PullRequestSource } from "../../github-port";
import type {
  ParsedGeneratePayload,
  TenantGeneratePayload,
} from "../../payload";
import { acquireRepoConfig, type AcquiredRepoConfig } from "../../repo-config";
import { ENTRY_SYNC_DELAY_SECONDS } from "../consts";
import {
  EntryWrites,
  type EntryCommentManager,
  type EntryWrite,
  type GenerateTaskDeps,
  type GenerateTaskHelpers,
  type LiveBodyMatcher,
  type RunStart,
} from "../types";
import {
  buildHeldEntryLinks,
  deriveNextHeadIndex,
  getBriefTarget,
  isLastJobAttempt,
} from "../utils";
import { createEntryCommentManager } from "./entry-comment-manager";
import { resolveEntryCommentAllowed } from "./entry-comment-gate";

/** The body the head's row names, and the live bodies it may replace. */
export interface EntrySyncPlan {
  readonly body: string;
  readonly isReplaceable: LiveBodyMatcher;
  /** Post the body when no comment is live; the closed body never does. */
  readonly createsComment: boolean;
  /** Rewrite a replaceable body in place, as a hold does, so nobody is pinged. */
  readonly inPlace?: boolean;
}

interface EntrySyncFacts {
  readonly translate: TFunction;
  readonly entryCommentManager: EntryCommentManager;
  readonly publicBaseUrl: string;
  readonly prRow: PullRequestRow;
  readonly prInfo: PullRequestInfo;
  readonly briefs: readonly BriefSpanRow[];
  readonly row: GenerationRow | undefined;
  readonly headSha: string;
}

/**
 * Queue the head's Entry sync, so an Entry the run's own post loses, to
 * GitHub, to a dead process or to another writer's swap, still lands: ahead
 * of a write that ends the run failed, and after a terminal post that
 * failed, lost its swap or stood down on an unread head. A url-box job
 * writes no Entry. A queue failure only warns: the run's own post still goes.
 */
export async function queueEntrySync(
  start: Pick<RunStart, "deps" | "payload" | "log">,
): Promise<void> {
  const { deps, payload, log } = start;
  if (payload.grantId !== undefined) {
    return;
  }

  try {
    await enqueueEntrySync(deps, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`generate: entry sync not queued, ${message}`);
  }
}

async function enqueueEntrySync(
  deps: GenerateTaskDeps,
  payload: ParsedGeneratePayload,
): Promise<void> {
  const ingest = createIngestRoutines(deps.handle, payload.ctx);
  await ingest.queueEntrySync({
    pullRequestId: payload.pullRequestId,
    headSha: payload.headSha,
    delaySeconds: ENTRY_SYNC_DELAY_SECONDS,
  });
}

/**
 * A terminal post GitHub failed in a way a retry may clear, or whose swap
 * another writer won, leaves its Entry to the head's sync, which renders it
 * again from the head, the row and the stored brief. A refusal for good
 * meets the same answer there, and a write that landed or left the thread on
 * purpose needs none, so a sync that finds its body live queues no other.
 */
export async function queueEntrySyncOnLostWrite(
  start: Pick<RunStart, "deps" | "payload" | "log">,
  write: EntryWrite,
): Promise<void> {
  const lost = write === EntryWrites.FAILED || write === EntryWrites.CONFLICTED;
  if (!lost) {
    return;
  }
  await queueEntrySync(start);
}

/**
 * Render the head's Entry comment from its row: the ready body over a stored
 * brief, the closed body once the pull request is no longer open, the failed,
 * on-demand or capped body the row's status names, through the same compare-and-set
 * every run's post takes. On an open PR a moved head is the newer run's
 * thread; a closed or merged one is rendered for GitHub's last head, since no
 * run will post on it again. A GitHub failure throws so graphile retries.
 */
export async function syncEntryComment(
  deps: GenerateTaskDeps,
  payload: TenantGeneratePayload,
  log: Logger,
): Promise<void> {
  const repo = createTenantRepository(deps.handle, payload.ctx);
  const prRow = await repo.pullRequests.getById(payload.pullRequestId);
  if (prRow === undefined) {
    log.info("entry sync: no pull request row, nothing to sync");
    return;
  }
  const repoSlug = readUsableRepoSlug(prRow);
  if (repoSlug === undefined) {
    log.info("entry sync: no usable repository slug, nothing to sync");
    return;
  }

  const source = await deps.github.openPullRequestSource(
    payload.ctx.installationId,
    repoSlug,
    prRow.prNumber,
  );
  const prInfo = await readSyncedPullRequest(source, log);
  if (prInfo === undefined) {
    return;
  }
  const headMoved =
    prInfo.state === "open" && prInfo.headSha !== payload.headSha;
  if (headMoved) {
    log.info("entry sync: head moved, the newer head's run owns the Entry");
    return;
  }

  const entryCommentManager = createEntryCommentManager(payload, {
    source,
    repo,
    prRow,
    publicBaseUrl: deps.publicBaseUrl,
    log,
  });
  const repoConfig = prInfo.draft
    ? await acquireRepoConfig(source, log)
    : undefined;
  throwOnRetryableSettingsRead(repoConfig);
  const allowed = await resolveEntryCommentAllowed(payload, {
    prInfo,
    repoConfig,
    entryCommentManager,
    log,
  });
  if (!allowed) {
    return;
  }

  const store = createArtifactStore(deps.handle, payload.ctx);
  const projection = createGenerationProjection(deps.handle, payload.ctx);
  const briefs = await store.briefs.listForPullRequest(payload.pullRequestId);
  const target = getBriefTarget(payload);
  const row = await projection.get(target);
  const plan = planEntrySync({
    translate: deps.translate,
    entryCommentManager,
    publicBaseUrl: deps.publicBaseUrl,
    prRow,
    prInfo,
    briefs,
    row,
    headSha: prInfo.headSha,
  });
  await writeEntrySync({ deps, payload, log }, entryCommentManager, plan);
}

/**
 * A draft's Entry gate reads `settings.yaml`. The run's own post stands down
 * on an unread one, but the sync exists to land a lost post, so a read a
 * retry may clear is graphile's to retry; a refused read stands down.
 */
function throwOnRetryableSettingsRead(
  repoConfig: AcquiredRepoConfig | undefined,
): void {
  const failure = repoConfig?.settingsFetchFailure;
  if (failure === undefined) {
    return;
  }
  if (isPermanentGitHubError(failure)) {
    return;
  }
  throw new TransientJobError(
    `entry sync: settings read failed, ${failure.message}`,
  );
}

/** A failure no retry clears: a row outside the payload's scope, a refused credential. */
export function isPermanentSyncFailure(error: unknown): boolean {
  const permanent =
    error instanceof PermanentJobError || error instanceof ScopeViolationError;
  return permanent;
}

/** The sync's last attempt is the queue giving up on a stale thread. */
export function reportEntrySyncFailure(
  log: Logger,
  job: GenerateTaskHelpers["job"],
): void {
  const retried = job === undefined || !isLastJobAttempt(job);
  if (retried) {
    log.warn("entry sync: the Entry comment did not land, graphile retries");
    return;
  }
  log.error("entry sync: retries exhausted, the Entry may not match the row", {
    evt: "job.retries.exhausted",
    attempt: job.attempts,
    maxAttempts: job.max_attempts,
  });
}

function readUsableRepoSlug(prRow: PullRequestRow): string | undefined {
  const slug = prRow.repoSlug;
  if (slug === null) {
    return undefined;
  }
  if (splitRepoSlug(slug) === undefined) {
    return undefined;
  }
  return slug;
}

/** A refused read ends the sync; any other failure is graphile's to retry. */
async function readSyncedPullRequest(
  source: PullRequestSource,
  log: Logger,
): Promise<PullRequestInfo | undefined> {
  const read = await source.fetchPullRequest();
  if (read.ok) {
    return read.value;
  }
  if (isPermanentGitHubError(read.error)) {
    log.warn(`entry sync: pull request read refused, ${read.error.message}`);
    return undefined;
  }
  throw new TransientJobError(
    `entry sync: pull request read failed, ${read.error.message}`,
  );
}

/**
 * A sync whose swap another writer won queues its successor, which reads the
 * facts again: while this job runs, graphile adds that job beside it. A
 * successor that cannot be queued throws, so graphile retries this sync.
 */
async function writeEntrySync(
  start: Pick<RunStart, "deps" | "payload" | "log">,
  entryCommentManager: EntryCommentManager,
  plan: EntrySyncPlan | undefined,
): Promise<void> {
  const { log } = start;
  if (plan === undefined) {
    log.debug("entry sync: the row names no Entry body to sync");
    return;
  }

  const write = await writePlannedEntry(entryCommentManager, plan);
  if (write === EntryWrites.REFUSED) {
    log.warn("entry sync: GitHub refused the Entry comment write for good");
    return;
  }
  if (write === EntryWrites.FAILED) {
    throw new TransientJobError("entry sync: the Entry comment write failed");
  }
  if (write === EntryWrites.CONFLICTED) {
    log.info("entry sync: another writer holds the Entry, syncing again");
    await queueSyncSuccessor(start);
  }
}

export function writePlannedEntry(
  entryCommentManager: EntryCommentManager,
  plan: EntrySyncPlan,
): Promise<EntryWrite> {
  const { body, isReplaceable } = plan;
  if (plan.inPlace === true && plan.createsComment) {
    return entryCommentManager.editOrCreate(body, isReplaceable);
  }
  if (plan.inPlace === true) {
    return entryCommentManager.editMatching(body, isReplaceable);
  }
  if (plan.createsComment) {
    return entryCommentManager.replaceOrCreate(body, isReplaceable);
  }
  return entryCommentManager.replace(body, isReplaceable);
}

async function queueSyncSuccessor(
  start: Pick<RunStart, "deps" | "payload" | "log">,
): Promise<void> {
  try {
    await enqueueEntrySync(start.deps, start.payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TransientJobError(`entry sync: successor not queued, ${message}`);
  }
}

/**
 * A stored brief for the head wins whatever the row says; then a closed or
 * merged PR, whose thread must stop promising a brief; then the failed,
 * on-demand, capped or held body. A pending, running or superseded row leaves the
 * thread to its run, and only an open PR gets a comment created. On an open PR
 * read at this head, the ready, on-demand and capped bodies replace any marked
 * body, as the run's own posts do; the failed body keeps an older head's ready
 * Entry. A closed PR keeps an older head's ready body if its kind token reads;
 * this head's brief replaces its closed body, posted while the run generated.
 */
function planEntrySync(facts: EntrySyncFacts): EntrySyncPlan | undefined {
  const { translate, entryCommentManager, prInfo, briefs, headSha } = facts;
  const open = prInfo.state === "open";
  const isOwnBody = selectOwnBodyMatcher(headSha, open);

  const headBrief = findStoredHeadBrief(briefs, prInfo, headSha);
  if (headBrief !== undefined) {
    const briefLink = {
      ...entryCommentManager.buildDeepLink(headBrief.headIndex),
      headSha,
    };
    const isClosedReplaceable: LiveBodyMatcher = (live) => {
      const staleReady = isHeadReadyEntryBody(live, headSha);
      const outdatedClosed = isHeadClosedEntryBody(live, headSha);
      const replaceable = staleReady || outdatedClosed || isOwnBody(live);
      return replaceable;
    };
    return {
      body: buildEntryCommentBody(translate, briefLink),
      isReplaceable: open ? isEntryCommentBody : isClosedReplaceable,
      createsComment: open,
    };
  }
  if (!open) {
    return {
      body: buildEntryCommentClosedBody(translate, headSha),
      isReplaceable: isOwnBody,
      createsComment: false,
    };
  }
  return planRowEntry(facts, isOwnBody);
}

/**
 * On an open PR, the brief the run's own posts count as stored: this head on
 * the current base, so a retargeted head's failed rerun keeps its failed body.
 * A closed or merged PR keeps the head's last brief on any base.
 */
function findStoredHeadBrief(
  briefs: readonly BriefSpanRow[],
  prInfo: PullRequestInfo,
  headSha: string,
): BriefSpanRow | undefined {
  if (prInfo.state !== "open") {
    return briefs.findLast((brief) => brief.headSha === headSha);
  }
  return briefs.findLast((brief) => {
    const sameSpan =
      brief.headSha === headSha && brief.baseSha === prInfo.baseSha;
    return sameSpan;
  });
}

/**
 * On an open PR the closed body a reopen outdated is this head's too. A
 * closed PR's older head can still hold the thread when the PR closed inside
 * the debounce window, and nothing else will replace it.
 */
function selectOwnBodyMatcher(headSha: string, open: boolean): LiveBodyMatcher {
  if (open) {
    return (live) => isOpenHeadEntryBody(live, headSha);
  }
  return isUnsettledEntryBody;
}

function planRowEntry(
  facts: EntrySyncFacts,
  isOwnBody: LiveBodyMatcher,
): EntrySyncPlan | undefined {
  const { translate, entryCommentManager, briefs, row } = facts;
  const nextLink = entryCommentManager.buildDeepLink(
    deriveNextHeadIndex(briefs),
  );
  const failureCode = row?.errorCode ?? undefined;
  const failedWithCode =
    row?.status === GenerationStatuses.FAILED && failureCode !== undefined;
  if (failedWithCode) {
    return {
      body: buildEntryCommentFailedBody(translate, nextLink, failureCode),
      isReplaceable: isOwnBody,
      createsComment: true,
    };
  }
  if (row?.status === GenerationStatuses.AWAITING_TRIGGER) {
    return {
      body: buildEntryCommentOnDemandBody(translate, nextLink),
      isReplaceable: isEntryCommentBody,
      createsComment: true,
    };
  }
  if (row?.status === GenerationStatuses.CAPPED) {
    return planCappedEntry(facts, row);
  }
  if (row?.status === GenerationStatuses.HELD) {
    return planHeldEntry(facts, row);
  }
  return undefined;
}

/** The held body, rewritten in place over any marked body so a hold pings nobody. */
function planHeldEntry(
  facts: EntrySyncFacts,
  row: GenerationRow,
): EntrySyncPlan | undefined {
  const { translate, entryCommentManager, briefs } = facts;
  const unmet = parseUnmetConditions(row.unmetConditions)?.conditions;
  if (unmet === undefined || unmet.length === 0) {
    return undefined;
  }
  const links = buildHeldEntryLinks(entryCommentManager, briefs);
  return {
    body: buildEntryCommentHeldBody(translate, { ...links, unmet }),
    isReplaceable: isEntryCommentBody,
    createsComment: true,
    inPlace: true,
  };
}

/** The capped post only updates a comment, so the sync recreates one only where the row still tracks it. */
function planCappedEntry(
  facts: EntrySyncFacts,
  row: GenerationRow,
): EntrySyncPlan {
  const { translate, publicBaseUrl, prRow, headSha } = facts;
  const params = row.errorParams;
  const units = params !== null && "needed" in params ? params : undefined;
  const body = buildEntryCommentCappedBody(translate, {
    publicBaseUrl,
    repoId: prRow.repoId,
    prNumber: prRow.prNumber,
    headSha,
    resetsAt: utcDayBounds(row.updatedAt).to,
    units,
  });
  return {
    body,
    isReplaceable: isEntryCommentBody,
    createsComment: prRow.entryCommentId !== null,
  };
}
