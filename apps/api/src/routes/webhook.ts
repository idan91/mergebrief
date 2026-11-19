/* oxlint-disable house/comment-run -- the trust boundary and its status contract are the
   one thing a reader must know before touching this handler, and neither fits eight lines */
// The trust boundary. Nothing is trusted until the HMAC over the RAW body verifies against
// the configured secret; only then is the payload parsed and mapped to tenant-scoped writes.
// Tenancy comes from the SIGNED payload's installation.id, never from a spoofable header.
//
// Return 200 fast for every handled or ignored delivery (GitHub times out at 10s): upsert
// rows and enqueue one debounced job, with no model call. The only GitHub calls are bounded
// confirmation reads, no retry, well inside the budget: a destructive event's before it
// purges, and the repository permission of a reviewer or PR author no association trusts,
// whose failure counts them off the team.
// Natural-key upserts plus graphile job_key replacement make redelivery idempotent. A pull
// request or review delivery's signature digest is recorded after its dispatch succeeds, and
// the same signature within 72h is skipped; a failed one records nothing, so its redelivery
// processes. Concurrent duplicates both process: the seen-set holds no lock, the writes are
// idempotent. A destructive event bypasses the seen-set: its confirmation is its replay guard.
//
// Status contract:
//   401 missing or invalid signature (nothing parsed, nothing written)
//   400 signed but unparseable (bad JSON or malformed handled payload)
//   413 body exceeds the webhook size cap (nothing read past the cap)
//   200 handled, deliberately ignored, or already processed within 72h
//   502 a destructive event GitHub could not confirm (nothing purged, delivery not recorded)
//   500 unexpected throw, the seen-set read and record included (sanitized body)
/* oxlint-enable house/comment-run */
import {
  isAccountListed,
  type InstanceAccessPolicy,
} from "../access/instance-access";
import { Hono } from "hono";
import { type RequestLogEnv } from "../request-logging";
import {
  HttpStatuses,
  type DraftPolicy,
  type Mutable,
  type Result,
} from "types";
import { DEFAULT_DRAFT_POLICY } from "generators/instance-policy";
import {
  GitHubAccountTypes,
  InstallationActions,
  InstallationPresences,
  InstallationRepositoriesActions,
  ParsedWebhookEventKinds,
  PullRequestActions,
  TRUSTED_AUTHOR_ASSOCIATIONS,
  TRUSTED_COLLABORATOR_PERMISSIONS,
  parseWebhookEvent,
  verifyWebhookSignature,
  type ParsedGitHubAppAuthorizationEvent,
  type ParsedInstallationEvent,
  type ParsedInstallationRepositoriesEvent,
  type ParsedPullRequestEvent,
  type ParsedPullRequestReviewEvent,
  type ParsedWebhookEvent,
  type ParsedWebhookEventKind,
  type PullRequestAction,
  type AuthorAssociation,
  type GitHubCallFailure,
} from "github";
import { traceStep, type Logger, type SpanAttributes } from "logging";
import {
  UncoveredWorks,
  createTenantRepository,
  createIngestRoutines,
  createWebhookDeliveryStore,
  digestWebhookSignature,
  isDeliveryId,
  parseTenantContext,
  createPurgeRoutines,
  deleteUserCredentials,
  type AppDatabase,
  type DeliveryId,
  type RepoId,
  type UncoveredWork,
  type PullRequestLifecycle,
  type PullRequestUpsertInput,
  type TenantContext,
  type TriggerGenerationInput,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { ApiErrorCodes } from "contract";
import {
  BadGateway,
  BadRequest,
  InternalError,
  PayloadTooLarge,
  Unauthorized,
} from "../shared-errors/api-error";
import { readRawBodyWithinLimit } from "./read-body";
import { parseOwnerAndName } from "./repos/utils";
import type {
  InstallationBinder,
  InstallationPresenceReader,
} from "../access/types";

/** The access policy says which repository owners' deliveries may start a run. */
export interface WebhookRouteDeps extends InstanceAccessPolicy {
  readonly handle: AppDatabase;
  /** `GITHUB_WEBHOOK_SECRET`, injected by the startup wiring. */
  readonly webhookSecret: string;
  /**
   * Instance draft-PR policy, loaded from `mergebrief.config.yaml` by the
   * startup wiring. Omitted = the zero-config default (drafts generate, no
   * damping), so a root that doesn't wire it is running defaults, not silently
   * misconfigured.
   */
  readonly draftPolicy?: DraftPolicy;
  /** A removal is confirmed against the installation's own repository list. */
  readonly bindInstallationGitHub: InstallationBinder;
  /** An uninstall is confirmed on the App's JWT: a gone installation cannot mint. */
  readonly readInstallationPresence: InstallationPresenceReader;
  /** Overrides the confirmation bound, so a test can time out in milliseconds. */
  readonly webhookConfirmationTimeoutMs?: number;
}

/** GitHub did not answer a confirmation read; `error` is absent when the bound passed first. */
interface ConfirmationFailure {
  readonly error?: GitHubCallFailure;
}

/** Someone a delivery names, asked about on the repository it names. */
interface RepositoryPerson {
  /** Absent for a gone account, which no permission read can answer. */
  readonly login: string | undefined;
  readonly association: AuthorAssociation | undefined;
  readonly repoFullName: string;
  readonly repoPrivate: boolean;
  /** How this person's log lines name them. */
  readonly logFields: Readonly<Record<string, unknown>>;
}

/** What a trigger sets beyond the event itself. */
type TriggerOptions = Pick<
  TriggerGenerationInput,
  | "debounceSeconds"
  | "regenerationDebounceSeconds"
  | "refreshRunAt"
  | "requiresTriggerApproval"
>;

/** The removed ids GitHub no longer lists, and those it still holds. */
interface RemovalConfirmation {
  readonly absent: readonly RepoId[];
  readonly stillHeld: readonly RepoId[];
}

const DISPATCHED: Result<void, ConfirmationFailure> = {
  ok: true,
  value: undefined,
};

/** Half of GitHub's 10s delivery budget: the purge and the answer need the rest. */
const CONFIRMATION_TIMEOUT_MS = 5 * 1000;

/**
 * The `ready_for_review` enqueue window (constant, not a knob): short because
 * the author is actively watching after mark-ready; still trailing so the
 * common click-ready-then-push burst coalesces. Supersession abort covers
 * pushes landing after it fires.
 */
const READY_FLIP_DEBOUNCE_SECONDS = 10;

/** The close lands first, so the Entry sync reads the PR closed. */
const CLOSE_ENTRY_SYNC_DELAY_SECONDS = 0;

/** Hard cap for public webhook bodies: enough for GitHub JSON, bounded for DoS. */
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

/**
 * Kinds that bypass the seen-set. A revoke or an uninstall can legitimately
 * repeat byte for byte, and their handlers are idempotent.
 */
const SEEN_SET_EXEMPT_KINDS: ReadonlySet<ParsedWebhookEventKind> = new Set([
  ParsedWebhookEventKinds.IGNORED,
  ParsedWebhookEventKinds.GITHUB_APP_AUTHORIZATION,
  ParsedWebhookEventKinds.INSTALLATION,
  ParsedWebhookEventKinds.INSTALLATION_REPOSITORIES,
]);

/**
 * The `pull_request` actions that always (re)queue a generation. `closed` is
 * handled separately (state write, NO enqueue); `edited` queues only when it
 * moved the base; anything else the parser normalizes is a no-op here.
 */
const GENERATION_TRIGGER_ACTIONS: ReadonlySet<PullRequestAction> = new Set([
  PullRequestActions.OPENED,
  PullRequestActions.SYNCHRONIZE,
  PullRequestActions.REOPENED,
  PullRequestActions.READY_FOR_REVIEW,
  PullRequestActions.REVIEW_REQUESTED,
]);

function isGenerationTrigger(event: ParsedPullRequestEvent): boolean {
  if (event.action === PullRequestActions.EDITED) {
    return event.baseChanged === true;
  }
  return GENERATION_TRIGGER_ACTIONS.has(event.action);
}

/** The work an event names that a stored brief for its pair leaves undone. */
function nameUncoveredWork(
  event: ParsedPullRequestEvent | ParsedPullRequestReviewEvent,
): UncoveredWork | undefined {
  if (!("action" in event)) {
    return UncoveredWorks.REVIEW;
  }
  if (event.action === PullRequestActions.READY_FOR_REVIEW) {
    return UncoveredWorks.ENTRY_COMMENT;
  }
  return undefined;
}

/** The row every `pull_request` handler writes; a deleted author omits the login. */
function shapePullRequestUpsert(
  event: ParsedPullRequestEvent,
  lifecycle: PullRequestLifecycle,
): PullRequestUpsertInput {
  const upsert: Mutable<PullRequestUpsertInput> = {
    repoId: event.repoId,
    prNumber: event.prNumber,
    repoSlug: event.repoFullName,
    title: event.title,
    baseSha: event.baseSha,
    draft: event.draft,
    ...lifecycle,
  };

  if (event.authorLogin !== undefined) {
    upsert.authorLogin = event.authorLogin;
  }
  if (event.updatedAt !== undefined) {
    upsert.githubUpdatedAt = event.updatedAt;
  }
  if (event.createdAt !== undefined) {
    upsert.githubCreatedAt = event.createdAt;
  }

  return upsert;
}

function shapeCloseUpsert(
  event: ParsedPullRequestEvent,
): PullRequestUpsertInput {
  return shapePullRequestUpsert(event, {
    state: event.merged === true ? PrStates.MERGED : PrStates.CLOSED,
    closedAt: event.closedAt ?? new Date(),
  });
}

type IngestRoutines = ReturnType<typeof createIngestRoutines>;

/** A tracked Entry comment may still promise a brief, so its head's Entry sync re-renders it. */
async function syncTrackedEntry(
  ingest: IngestRoutines,
  recorded: Awaited<ReturnType<IngestRoutines["recordState"]>>,
): Promise<void> {
  const tracksEntry = recorded.pullRequest.entryCommentId !== null;
  if (recorded.applied && tracksEntry) {
    await ingest.queueEntrySync({
      pullRequestId: recorded.pullRequest.id,
      delaySeconds: CLOSE_ENTRY_SYNC_DELAY_SECONDS,
    });
  }
}

/** The late-event guard left the row alone; the delivery was older. */
function logSkippedEvent(
  log: Logger,
  event: ParsedPullRequestEvent | ParsedPullRequestReviewEvent,
): void {
  log.debug("webhook event older than the stored row, skipped", {
    repoId: String(event.repoId),
    prNumber: event.prNumber,
    action: "action" in event ? event.action : "review-submitted",
  });
}

async function handlePullRequest(
  deps: WebhookRouteDeps,
  ctx: TenantContext,
  event: ParsedPullRequestEvent,
  policy: DraftPolicy,
  log: Logger,
): Promise<void> {
  const { handle } = deps;
  if (event.action === PullRequestActions.CLOSED) {
    // Terminal state write, no generation; the close time is what the
    // worker's retention sweep reads.
    const ingest = createIngestRoutines(handle, ctx);
    const recorded = await ingest.recordState(shapeCloseUpsert(event));
    if (!recorded.applied) {
      logSkippedEvent(log, event);
    }
    await syncTrackedEntry(ingest, recorded);
    return;
  }
  if (event.action === PullRequestActions.CONVERTED_TO_DRAFT) {
    // Draft re-entry updates lifecycle only. Enqueueing can repost Entry comments, spend on
    // comparisons, create phantom pending state or retry a previously failed generation.
    // It advances the guard like every state write: an older push that lands
    // after it is skipped whole, never applied over the draft flag.
    const recorded = await createIngestRoutines(handle, ctx).recordState(
      shapePullRequestUpsert(event, { state: PrStates.OPEN }),
    );
    if (!recorded.applied) {
      logSkippedEvent(log, event);
    }
    return;
  }
  if (isGenerationTrigger(event)) {
    if (event.draft && !policy.generate) {
      // Drafts excluded by instance policy still need lifecycle updates. A reopened draft
      // must clear terminal state now; no later event carries the reopen intent.
      // The eventual ready_for_review event takes the normal first-generation path.
      const recorded = await createIngestRoutines(handle, ctx).recordState(
        shapePullRequestUpsert(event, { state: PrStates.OPEN }),
        { reopen: event.action === PullRequestActions.REOPENED },
      );
      if (!recorded.applied) {
        logSkippedEvent(log, event);
      }
      return;
    }
    const requiresApproval = await requiresTriggerApproval(
      deps,
      ctx,
      event,
      log,
    );
    await triggerGeneration(
      handle,
      ctx,
      event,
      {
        ...windowOverrides(event, event.draft, policy),
        requiresTriggerApproval: requiresApproval,
      },
      log,
    );
  }
}

/**
 * Ready flips replace pending draft damping with the short window.
 * Configured draft damping applies only after a successful brief, keeping first briefs fast.
 */
function windowOverrides(
  event: ParsedPullRequestEvent,
  isDraft: boolean,
  policy: DraftPolicy,
): Pick<
  TriggerGenerationInput,
  "debounceSeconds" | "regenerationDebounceSeconds" | "refreshRunAt"
> {
  if (event.action === PullRequestActions.READY_FOR_REVIEW) {
    return { debounceSeconds: READY_FLIP_DEBOUNCE_SECONDS, refreshRunAt: true };
  }
  if (isDraft && policy.debounceSeconds !== null) {
    return { regenerationDebounceSeconds: policy.debounceSeconds };
  }
  return {};
}

/** Plain warn, no taxonomy row: the delivery still answers 200, the person counted off the team. */
function logPermissionUnconfirmed(
  log: Logger,
  person: RepositoryPerson,
  failure: ConfirmationFailure,
): void {
  const fields: Record<string, unknown> = {
    ...person.logFields,
    timedOut: failure.error === undefined,
  };
  if (failure.error !== undefined) {
    fields["code"] = failure.error.code;
  }
  log.warn("repository permission unconfirmed, counted off the team", fields);
}

/**
 * Whether the person is on the repository's team. Only invited people see a
 * private (not internal) repo, so everyone there counts. On a public or
 * internal repo a trusted association counts at once; anyone else, a private
 * org member included, needs write access, and a permission read that fails
 * counts as none.
 */
async function isOnRepositoryTeam(
  deps: WebhookRouteDeps,
  ctx: TenantContext,
  person: RepositoryPerson,
  log: Logger,
): Promise<boolean> {
  if (person.repoPrivate) {
    return true;
  }
  const { association, login } = person;
  if (
    association !== undefined &&
    TRUSTED_AUTHOR_ASSOCIATIONS.has(association)
  ) {
    return true;
  }
  const repo = parseOwnerAndName(person.repoFullName);
  const askable = repo !== undefined && login !== undefined;
  if (!askable) {
    return false;
  }

  const permission = await confirmWithin(deps, () =>
    deps
      .bindInstallationGitHub(ctx.installationId)
      .forRepo(repo)
      .readCollaboratorPermission(login),
  );
  if (!permission.ok) {
    logPermissionUnconfirmed(log, person, permission.error);
    return false;
  }
  if (TRUSTED_COLLABORATOR_PERMISSIONS.has(permission.value)) {
    return true;
  }

  log.debug("repository permission below write, counted off the team", {
    ...person.logFields,
    permission: permission.value,
  });
  return false;
}

/** A bot reviewer never earns a checkpoint; anyone else must be on the team. */
async function isReviewerTrusted(
  deps: WebhookRouteDeps,
  ctx: TenantContext,
  event: ParsedPullRequestReviewEvent,
  log: Logger,
): Promise<boolean> {
  if (event.reviewerType === GitHubAccountTypes.BOT) {
    return false;
  }
  const reviewer: RepositoryPerson = {
    login: event.reviewerLogin,
    association: event.reviewerAssociation,
    repoFullName: event.repoFullName,
    repoPrivate: event.repoPrivate,
    logFields: {
      reviewerLogin: event.reviewerLogin,
      association: event.reviewerAssociation,
    },
  };
  return isOnRepositoryTeam(deps, ctx, reviewer, log);
}

/**
 * Whether the PR's author owes a Trigger approval: anyone off the team does.
 * A bot never does here, because the worker decides for it from `trustedBots`.
 */
async function requiresTriggerApproval(
  deps: WebhookRouteDeps,
  ctx: TenantContext,
  event: ParsedPullRequestEvent | ParsedPullRequestReviewEvent,
  log: Logger,
): Promise<boolean> {
  if (event.authorIsBot) {
    return false;
  }
  const logFields = { repoId: String(event.repoId), prNumber: event.prNumber };
  const author: RepositoryPerson = {
    login: event.authorLogin,
    association: event.authorAssociation,
    repoFullName: event.repoFullName,
    repoPrivate: event.repoPrivate,
    logFields,
  };
  const onTeam = await isOnRepositoryTeam(deps, ctx, author, log);
  if (!onTeam) {
    log.debug(
      "pull request author off the team, head gated unless already approved",
      logFields,
    );
  }
  return !onTeam;
}

async function handlePullRequestReview(
  deps: WebhookRouteDeps,
  ctx: TenantContext,
  event: ParsedPullRequestReviewEvent,
  policy: DraftPolicy,
  log: Logger,
): Promise<void> {
  const { handle } = deps;
  // Requeue submitted reviews only for known PRs; inserting here could invent an open
  // row for a closed PR. Unknown PRs wait for their pull_request delivery.
  // The ingest guard preserves terminal state and skips enqueueing for known closed PRs.
  const tenant = createTenantRepository(handle, ctx);
  const known = await tenant.pullRequests.getByNumber(
    event.repoId,
    event.prNumber,
  );
  if (known === undefined) {
    return;
  }
  // Only webhooks write checkpoints, including echoes of our own submissions.
  // Pin to the reviewed commit, never the delivery-time head. Each checkpoint costs a delta
  // call inside one capped run, so only a trusted, non-bot reviewer gets one.
  // Write before enqueueing so the worker sees the baseline. Newest-submission wins on redelivery.
  // Review events carry no draft flag; the STORED row supplies it. Under drafts-off the
  // checkpoint still lands, it's reviewer-baseline state, not spend, but no job enqueues.
  // The two reads run at once: each may take half of GitHub's delivery budget.
  const generates = !known.draft || policy.generate;
  // Ingest ignores the author's standing once a collaborator approved the PR.
  const asksAboutAuthor = generates && known.triggerApprovedAt === null;
  const [writesCheckpoint, requiresApproval] = await Promise.all([
    isReviewerTrusted(deps, ctx, event, log),
    asksAboutAuthor ? requiresTriggerApproval(deps, ctx, event, log) : false,
  ]);
  if (writesCheckpoint) {
    await tenant.checkpoints.upsertOnSubmit({
      pullRequestId: known.id,
      reviewerId: event.reviewerId,
      reviewerLogin: event.reviewerLogin,
      lastSubmittedSha: event.commitId,
      submittedAt: event.submittedAt,
    });
  }
  if (!generates) {
    return;
  }
  // No window override: damping exists for WIP push storms, and a submitted
  // review is deliberate human engagement, its gap-filler regeneration
  // takes the normal window even on a damped draft.
  await triggerGeneration(
    handle,
    ctx,
    event,
    { requiresTriggerApproval: requiresApproval },
    log,
  );
}

async function triggerGeneration(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedPullRequestEvent | ParsedPullRequestReviewEvent,
  options: TriggerOptions,
  log: Logger,
): Promise<void> {
  // Only a `reopened` pull_request event may transition a terminal PR back to
  // open; a review or any other trigger merely implies the PR is open and must
  // not resurrect a since-closed PR (a review CAN be submitted on a closed one).
  const reopen =
    "action" in event && event.action === PullRequestActions.REOPENED;
  type IngestPullRequest = Parameters<
    ReturnType<typeof createIngestRoutines>["triggerGeneration"]
  >[0]["pullRequest"];
  const pullRequest: Mutable<IngestPullRequest> = {
    repoId: event.repoId,
    prNumber: event.prNumber,
    repoSlug: event.repoFullName,
    title: event.title,
    state: PrStates.OPEN,
  };
  // Review events carry no base SHA; omission preserves the stored one.
  if ("baseSha" in event) {
    pullRequest.baseSha = event.baseSha;
  }

  // Draft and author are written from pull_request events only: a review
  // carries no draft, and its author login feeds the gate but is never
  // stored, so omission preserves the stored values (same as base_sha).
  if ("draft" in event) {
    pullRequest.draft = event.draft;
  }

  const isPullRequestEvent =
    event.kind === ParsedWebhookEventKinds.PULL_REQUEST;
  const namesAuthor = isPullRequestEvent && event.authorLogin !== undefined;
  if (namesAuthor) {
    pullRequest.authorLogin = event.authorLogin;
  }
  if ("updatedAt" in event && event.updatedAt !== undefined) {
    pullRequest.githubUpdatedAt = event.updatedAt;
  }
  if ("createdAt" in event && event.createdAt !== undefined) {
    pullRequest.githubCreatedAt = event.createdAt;
  }
  const input: Mutable<TriggerGenerationInput> = {
    pullRequest,
    headSha: event.headSha,
    reopen,
    ...options,
  };
  if (event.kind === ParsedWebhookEventKinds.PULL_REQUEST_REVIEW) {
    input.reviewSubmittedAt = event.submittedAt;
  }
  const uncoveredWork = nameUncoveredWork(event);
  if (uncoveredWork !== undefined) {
    input.uncoveredWork = uncoveredWork;
  }
  const ingest = createIngestRoutines(handle, ctx);
  const outcome = await traceStep("generation.trigger", {}, async (span) => {
    const triggered = await ingest.triggerGeneration(input);
    span.setAttributes({
      "mergebrief.pr_id": String(triggered.pullRequest.id),
      "mergebrief.applied": triggered.applied,
      "mergebrief.queued": triggered.queued,
      "mergebrief.covered_by_brief": triggered.coveredBy !== undefined,
    });
    return triggered;
  });
  if (!outcome.applied) {
    logSkippedEvent(log, event);
  }
  if (outcome.queued) {
    log.info("generation enqueued", {
      evt: "generation.enqueue",
      repoId: String(event.repoId),
      prNumber: event.prNumber,
      prId: String(outcome.pullRequest.id),
      headSha: event.headSha,
    });
  }
  if (outcome.coveredBy !== undefined) {
    log.debug("webhook event covered by a stored brief, nothing queued", {
      repoId: String(event.repoId),
      prNumber: event.prNumber,
      briefId: String(outcome.coveredBy),
    });
  }
}

/**
 * One bound over a whole confirmation read, so a removal's two reads cannot
 * together outlast GitHub's delivery budget. A destructive event answers its
 * failure with 502; a failed permission read answers 200, the person off the team.
 */
async function confirmWithin<Confirmed>(
  deps: WebhookRouteDeps,
  read: () => Promise<Result<Confirmed, GitHubCallFailure>>,
): Promise<Result<Confirmed, ConfirmationFailure>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<undefined>((resolve) => {
    timer = setTimeout(
      () => resolve(undefined),
      deps.webhookConfirmationTimeoutMs ?? CONFIRMATION_TIMEOUT_MS,
    );
  });

  const answer = await Promise.race([read(), bound]);
  clearTimeout(timer);

  if (answer === undefined) {
    return { ok: false, error: {} };
  }
  if (!answer.ok) {
    return { ok: false, error: { error: answer.error } };
  }
  return answer;
}

async function handleInstallation(
  deps: WebhookRouteDeps,
  ctx: TenantContext,
  event: ParsedInstallationEvent,
  log: Logger,
): Promise<Result<void, ConfirmationFailure>> {
  if (event.action !== InstallationActions.DELETED) {
    return DISPATCHED; // `created` is a no-op: rows appear lazily with the first PR event.
  }

  const presence = await confirmWithin(deps, () =>
    deps.readInstallationPresence(ctx.installationId),
  );
  if (!presence.ok) {
    return presence;
  }
  if (presence.value === InstallationPresences.PRESENT) {
    log.warn("installation deleted event unconfirmed, github still holds it", {
      installationId: String(ctx.installationId),
    });
    return DISPATCHED;
  }

  // The tenant offboards: createPurgeRoutines deletes all PR aggregates
  // (children cascade) and emits its own `delete` audit entry, in one
  // transaction. Sessions and tokens stay; GitHub stops confirming access.
  await createPurgeRoutines(deps.handle, ctx).purgeInstallation();
  return DISPATCHED;
}

/**
 * The installation's own list is the authority; one it cannot list is
 * purged whole only when the App's JWT reads it gone. A suspended
 * installation lists nothing and still reads present, so it fails here.
 */
async function confirmRemovedRepoIds(
  deps: WebhookRouteDeps,
  ctx: TenantContext,
  removed: readonly RepoId[],
): Promise<Result<RemovalConfirmation, GitHubCallFailure>> {
  const listed = await deps
    .bindInstallationGitHub(ctx.installationId)
    .listInstallationRepoIds();
  if (listed.ok) {
    const held = listed.value;
    return {
      ok: true,
      value: {
        absent: removed.filter((repoId) => !held.has(repoId)),
        stillHeld: removed.filter((repoId) => held.has(repoId)),
      },
    };
  }

  const presence = await deps.readInstallationPresence(ctx.installationId);
  if (!presence.ok) {
    return presence;
  }
  if (presence.value === InstallationPresences.GONE) {
    return { ok: true, value: { absent: removed, stillHeld: [] } };
  }
  return listed;
}

async function handleInstallationRepositories(
  deps: WebhookRouteDeps,
  ctx: TenantContext,
  event: ParsedInstallationRepositoriesEvent,
  log: Logger,
): Promise<Result<void, ConfirmationFailure>> {
  if (event.action !== InstallationRepositoriesActions.REMOVED) {
    return DISPATCHED; // `added` is a no-op, same lazy-row reasoning as install-created.
  }

  const confirmed = await confirmWithin(deps, () =>
    confirmRemovedRepoIds(deps, ctx, event.repoIdsRemoved),
  );
  if (!confirmed.ok) {
    return confirmed;
  }
  if (confirmed.value.stillHeld.length > 0) {
    log.warn(
      "repositories removed event unconfirmed, github still lists some",
      {
        installationId: String(ctx.installationId),
        repoIds: confirmed.value.stillHeld.map(String),
      },
    );
  }

  // ONE set-based transaction (not a per-repo Promise.all, which would open N
  // concurrent pool connections and could starve the webhook's fast 200 on a
  // large deselection). Per-repo audit granularity is preserved inside it.
  await createPurgeRoutines(deps.handle, ctx).purgeRepos(
    confirmed.value.absent,
  );
  return DISPATCHED;
}

/** A revoked authorization ends every sign-in of that user; GitHub already killed the token. */
async function handleAppAuthorization(
  handle: AppDatabase,
  event: ParsedGitHubAppAuthorizationEvent,
  log: Logger,
): Promise<void> {
  const deleted = await deleteUserCredentials(handle, event.userId);
  log.info("app authorization revoked, credentials deleted", {
    evt: "authorization.revoked",
    reviewerId: String(event.userId),
    sessions: deleted.sessions,
    tokens: deleted.tokens,
    grants: deleted.grants,
  });
}

/**
 * A delivery naming no owner matches nothing, so it starts nothing. Checked
 * ahead of the seen-set: a drop records nothing, so a redelivery after the
 * account is listed still runs.
 */
function findUnlistedOwnerDelivery(
  deps: WebhookRouteDeps,
  event: ParsedWebhookEvent,
): ParsedPullRequestEvent | ParsedPullRequestReviewEvent | undefined {
  const startsRuns =
    event.kind === ParsedWebhookEventKinds.PULL_REQUEST ||
    event.kind === ParsedWebhookEventKinds.PULL_REQUEST_REVIEW;
  if (!startsRuns) {
    return undefined;
  }
  const ownerId = event.repoOwnerId;
  const listed = ownerId !== undefined && isAccountListed(deps, ownerId);
  return listed ? undefined : event;
}

/**
 * A stored PR's close and reopen still land: retention never reaches a row left
 * open, and a row left closed refuses every push once the account is relisted.
 * Neither writes a new row or starts a run, since the account is out. Only a
 * close syncs the Entry: a closed PR's sync never posts, and an open PR's may.
 */
async function recordUnlistedLifecycle(
  deps: WebhookRouteDeps,
  event: ParsedPullRequestEvent | ParsedPullRequestReviewEvent,
): Promise<void> {
  if (event.kind !== ParsedWebhookEventKinds.PULL_REQUEST) {
    return;
  }
  const isClose = event.action === PullRequestActions.CLOSED;
  const isReopen = event.action === PullRequestActions.REOPENED;
  if (!isClose && !isReopen) {
    return;
  }

  const ctx = parseTenantContext({ installationId: event.installationId });
  const known = await createTenantRepository(
    deps.handle,
    ctx,
  ).pullRequests.getByNumber(event.repoId, event.prNumber);
  if (known === undefined) {
    return;
  }

  const ingest = createIngestRoutines(deps.handle, ctx);
  if (isClose) {
    const recorded = await ingest.recordState(shapeCloseUpsert(event));
    await syncTrackedEntry(ingest, recorded);
    return;
  }
  await ingest.recordState(
    shapePullRequestUpsert(event, { state: PrStates.OPEN }),
    { reopen: true },
  );
}

/** A destructive event's failure is the route's 502; every other event's work throws or completes. */
async function dispatch(
  deps: WebhookRouteDeps,
  event: ParsedWebhookEvent,
  policy: DraftPolicy,
  log: Logger,
): Promise<Result<void, ConfirmationFailure>> {
  if (event.kind === ParsedWebhookEventKinds.IGNORED) {
    return DISPATCHED;
  }
  if (event.kind === ParsedWebhookEventKinds.GITHUB_APP_AUTHORIZATION) {
    await handleAppAuthorization(deps.handle, event, log);
    return DISPATCHED;
  }
  // The tenant boundary: the branded installation id from the SIGNED payload,
  // revalidated through persistence's context schema.
  const ctx = parseTenantContext({ installationId: event.installationId });
  switch (event.kind) {
    case ParsedWebhookEventKinds.PULL_REQUEST:
      await handlePullRequest(deps, ctx, event, policy, log);
      return DISPATCHED;
    case ParsedWebhookEventKinds.PULL_REQUEST_REVIEW:
      await handlePullRequestReview(deps, ctx, event, policy, log);
      return DISPATCHED;
    case ParsedWebhookEventKinds.INSTALLATION:
      return handleInstallation(deps, ctx, event, log);
    case ParsedWebhookEventKinds.INSTALLATION_REPOSITORIES:
      return handleInstallationRepositories(deps, ctx, event, log);
  }
}

/** A verified delivery: its signature digest keys the seen-set. */
interface VerifiedDelivery {
  readonly signature: string;
  readonly deliveryId: DeliveryId | undefined;
  readonly receivedAt: Date;
}

/**
 * Dispatch an event unless the seen-set holds its signature from within the
 * window, then record it. Every seen-set failure throws to the route's 500.
 */
async function dispatchOnce(
  deps: WebhookRouteDeps,
  event: ParsedWebhookEvent,
  delivery: VerifiedDelivery,
  log: Logger,
): Promise<Result<void, ConfirmationFailure>> {
  const unlisted = findUnlistedOwnerDelivery(deps, event);
  if (unlisted !== undefined) {
    log.warn(
      "webhook: ignored a delivery from an account this instance does not list",
      {
        accountId: String(unlisted.repoOwnerId),
        repo: unlisted.repoFullName,
      },
    );
    await recordUnlistedLifecycle(deps, unlisted);
    return DISPATCHED;
  }

  const policy = deps.draftPolicy ?? DEFAULT_DRAFT_POLICY;
  const runDispatch = () =>
    traceStep("webhook.dispatch", readEventAttributes(event), () =>
      dispatch(deps, event, policy, log),
    );
  if (SEEN_SET_EXEMPT_KINDS.has(event.kind)) {
    return runDispatch();
  }

  const deliveries = createWebhookDeliveryStore(deps.handle);
  const signatureDigest = digestWebhookSignature(delivery.signature);
  if (
    await deliveries.hasRecentDelivery(signatureDigest, delivery.receivedAt)
  ) {
    log.debug("webhook delivery already processed, skipped", {
      evt: "webhook.delivery.duplicate",
    });
    return DISPATCHED;
  }

  const dispatched = await runDispatch();
  if (!dispatched.ok) {
    return dispatched;
  }
  await deliveries.recordDelivery(
    { signatureDigest, deliveryId: delivery.deliveryId },
    delivery.receivedAt,
  );
  return dispatched;
}

/** No taxonomy row: the 502 in GitHub's delivery log is the signal, and the worker resends it. */
function logUnconfirmed(log: Logger, failure: ConfirmationFailure): void {
  const fields: Record<string, unknown> = {
    timedOut: failure.error === undefined,
  };
  if (failure.error !== undefined) {
    fields["code"] = failure.error.code;
  }
  log.warn(
    "destructive event unconfirmed, github unavailable, nothing purged",
    fields,
  );
}

/** The parsed event's own vocabulary only, never payload text. */
function readEventAttributes(event: ParsedWebhookEvent): SpanAttributes {
  const attributes: SpanAttributes = { "mergebrief.webhook.kind": event.kind };
  if ("action" in event) {
    attributes["mergebrief.webhook.action"] = event.action;
  }
  return attributes;
}

/** Mountable webhook route; deps injected so tests pass a PGlite handle. */
export function webhookRoute(deps: WebhookRouteDeps): Hono<RequestLogEnv> {
  const app = new Hono<RequestLogEnv>();

  app.post("/github", async (c) => {
    // Delivery ids are untrusted before signature verification. Bind only bounded GUID-shaped
    // values for operator correlation, preventing log injection and volume inflation.
    const receivedAt = new Date();
    const rawDeliveryId = c.req.header("x-github-delivery");
    const deliveryId =
      rawDeliveryId !== undefined && isDeliveryId(rawDeliveryId)
        ? rawDeliveryId
        : undefined;
    const log =
      deliveryId === undefined
        ? c.get("logger")
        : c.get("logger").child({ deliveryId });

    // Verify the HMAC over the RAW body BEFORE any parsing, the exact bytes
    // GitHub signed, never a JSON re-encode.
    const rawBody = await readRawBodyWithinLimit(
      c.req.raw,
      MAX_WEBHOOK_BODY_BYTES,
    );
    if (!rawBody.ok) {
      throw new PayloadTooLarge(ApiErrorCodes.REQUEST_TOO_LARGE);
    }
    const raw = new TextDecoder().decode(rawBody.value);
    const signature = c.req.header("x-hub-signature-256");
    const eventName = c.req.header("x-github-event") ?? "";

    const verified = await traceStep("webhook.verify", {}, async (span) => {
      const checked = await verifyWebhookSignature({
        secret: deps.webhookSecret,
        payload: raw,
        signature,
      });
      span.setAttributes({ "mergebrief.verified": checked.ok });
      return checked;
    });
    const signatureRefused = !verified.ok || signature === undefined;
    if (signatureRefused) {
      // Warn, not error, raw hits are scanner noise; a SUSTAINED rate
      // (secret drift after rotation) is what an operator alerts on.
      log.warn("webhook signature verification failed", {
        evt: "webhook.verify.fail",
      });
      throw new Unauthorized(ApiErrorCodes.INVALID_SIGNATURE);
    }

    // Signed, so now worth parsing. Bad JSON from a signer is still a 400.
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new BadRequest();
    }

    // Zod boundary: malformed-but-signed handled payload → 400.
    const parsed = parseWebhookEvent({ eventName, payload });
    if (!parsed.ok) {
      throw new BadRequest();
    }

    // Map the event to tenant-scoped writes. Unexpected throw → 500 with a
    // sanitized body, internals never reach the caller.
    const event = parsed.value;
    let dispatched: Result<void, ConfirmationFailure>;
    try {
      dispatched = await dispatchOnce(
        deps,
        event,
        { signature, deliveryId, receivedAt },
        log,
      );
    } catch (error) {
      log.error("webhook dispatch failed", {
        evt: "webhook.dispatch.fail",
        err: error,
      });
      throw new InternalError();
    }
    if (!dispatched.ok) {
      logUnconfirmed(log, dispatched.error);
      throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
    }
    return c.json({ ok: true }, HttpStatuses.OK);
  });

  return app;
}
