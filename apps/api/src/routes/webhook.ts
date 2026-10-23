/* oxlint-disable house/comment-run -- the trust boundary and its status contract are the
   one thing a reader must know before touching this handler, and neither fits eight lines */
// The trust boundary. Nothing is trusted until the HMAC over the RAW body verifies against
// the configured secret; only then is the payload parsed and mapped to tenant-scoped writes.
// Tenancy comes from the SIGNED payload's installation.id, never from a spoofable header.
//
// Return 200 fast for every handled or ignored delivery (GitHub times out at 10s): upsert
// rows and enqueue one debounced job, with no model call and no GitHub API call. Natural-key
// upserts plus graphile job_key replacement make redelivery idempotent. A pull request or
// review delivery's signature digest is recorded after its dispatch succeeds, and the same
// signature within 72h is skipped; a failed one records nothing, so its redelivery processes.
// Concurrent duplicates both process: the seen-set holds no lock, the writes are idempotent.
//
// Status contract:
//   401 missing or invalid signature (nothing parsed, nothing written)
//   400 signed but unparseable (bad JSON or malformed handled payload)
//   413 body exceeds the webhook size cap (nothing read past the cap)
//   200 handled, deliberately ignored, or already processed within 72h
//   500 unexpected throw, the seen-set read and record included (sanitized body)
/* oxlint-enable house/comment-run */
import { Hono } from "hono";
import { type RequestLogEnv } from "../request-logging";
import { HttpStatuses, type Mutable, type DraftPolicy } from "types";
import { DEFAULT_DRAFT_POLICY } from "generators/instance-policy";
import {
  InstallationActions,
  InstallationRepositoriesActions,
  ParsedWebhookEventKinds,
  PullRequestActions,
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
  type UncoveredWork,
  type PullRequestLifecycle,
  type PullRequestUpsertInput,
  type TenantContext,
  type TriggerGenerationInput,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { ApiErrorCodes } from "contract";
import {
  BadRequest,
  InternalError,
  PayloadTooLarge,
  Unauthorized,
} from "../shared-errors/api-error";
import { readRawBodyWithinLimit } from "./read-body";

export interface WebhookRouteDeps {
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
}

/**
 * The `ready_for_review` enqueue window (constant, not a knob): short because
 * the author is actively watching after mark-ready; still trailing so the
 * common click-ready-then-push burst coalesces. Supersession abort covers
 * pushes landing after it fires.
 */
const READY_FLIP_DEBOUNCE_SECONDS = 10;

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

  return upsert;
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
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedPullRequestEvent,
  policy: DraftPolicy,
  log: Logger,
): Promise<void> {
  if (event.action === PullRequestActions.CLOSED) {
    // Terminal state write, NO enqueue; the close time is what the worker's
    // retention sweep reads.
    const recorded = await createIngestRoutines(handle, ctx).recordState(
      shapePullRequestUpsert(event, {
        state: event.merged === true ? PrStates.MERGED : PrStates.CLOSED,
        closedAt: event.closedAt ?? new Date(),
      }),
    );
    if (!recorded.applied) {
      logSkippedEvent(log, event);
    }
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
    await triggerGeneration(
      handle,
      ctx,
      event,
      windowOverrides(event, event.draft, policy),
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

async function handlePullRequestReview(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedPullRequestReviewEvent,
  policy: DraftPolicy,
  log: Logger,
): Promise<void> {
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
  // Pin to the reviewed commit, never the delivery-time head; skip bots to avoid unused spend.
  // Write before enqueueing so the worker sees the baseline. Newest-submission wins on redelivery.
  if (event.reviewerType !== "Bot") {
    await tenant.checkpoints.upsertOnSubmit({
      pullRequestId: known.id,
      reviewerId: event.reviewerId,
      reviewerLogin: event.reviewerLogin,
      lastSubmittedSha: event.commitId,
      submittedAt: event.submittedAt,
    });
  }
  // Review events carry no draft flag; the STORED row (loaded above for the
  // known-PR guard) supplies it. Under drafts-off the checkpoint still
  // landed, it's reviewer-baseline state, not spend, but no job enqueues.
  if (known.draft && !policy.generate) {
    return;
  }
  // No window override: damping exists for WIP push storms, and a submitted
  // review is deliberate human engagement, its gap-filler regeneration
  // takes the normal window even on a damped draft.
  await triggerGeneration(handle, ctx, event, {}, log);
}

async function triggerGeneration(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedPullRequestEvent | ParsedPullRequestReviewEvent,
  overrides: Pick<
    TriggerGenerationInput,
    "debounceSeconds" | "regenerationDebounceSeconds" | "refreshRunAt"
  >,
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

  // Draft + author ride pull_request events only; a review omits both, so
  // omission preserves the stored values (same as base_sha).
  if ("draft" in event) {
    pullRequest.draft = event.draft;
  }

  if ("authorLogin" in event && event.authorLogin !== undefined) {
    pullRequest.authorLogin = event.authorLogin;
  }
  if ("updatedAt" in event && event.updatedAt !== undefined) {
    pullRequest.githubUpdatedAt = event.updatedAt;
  }
  const input: Mutable<TriggerGenerationInput> = {
    pullRequest,
    headSha: event.headSha,
    reopen,
    ...overrides,
  };
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

async function handleInstallation(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedInstallationEvent,
): Promise<void> {
  if (event.action === InstallationActions.DELETED) {
    // App uninstalled → the tenant offboards: createPurgeRoutines deletes all PR
    // aggregates (children cascade) and emits its own `delete` audit entry, in
    // one transaction. Sessions and tokens stay; GitHub stops confirming access.
    await createPurgeRoutines(handle, ctx).purgeInstallation();
  }
  // `created` is a no-op: rows appear lazily when the first PR event lands.
}

async function handleInstallationRepositories(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedInstallationRepositoriesEvent,
): Promise<void> {
  if (event.action !== InstallationRepositoriesActions.REMOVED) {
    return; // `added` is a no-op, same lazy-row reasoning as install-created.
  }
  // ONE set-based transaction (not a per-repo Promise.all, which would open N
  // concurrent pool connections and could starve the webhook's fast 200 on a
  // large deselection). Per-repo audit granularity is preserved inside it.
  await createPurgeRoutines(handle, ctx).purgeRepos(event.repoIdsRemoved);
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

async function dispatch(
  handle: AppDatabase,
  event: ParsedWebhookEvent,
  policy: DraftPolicy,
  log: Logger,
): Promise<void> {
  if (event.kind === ParsedWebhookEventKinds.IGNORED) {
    return;
  }
  if (event.kind === ParsedWebhookEventKinds.GITHUB_APP_AUTHORIZATION) {
    return handleAppAuthorization(handle, event, log);
  }
  // The tenant boundary: the branded installation id from the SIGNED payload,
  // revalidated through persistence's context schema.
  const ctx = parseTenantContext({ installationId: event.installationId });
  switch (event.kind) {
    case ParsedWebhookEventKinds.PULL_REQUEST:
      return handlePullRequest(handle, ctx, event, policy, log);
    case ParsedWebhookEventKinds.PULL_REQUEST_REVIEW:
      return handlePullRequestReview(handle, ctx, event, policy, log);
    case ParsedWebhookEventKinds.INSTALLATION:
      return handleInstallation(handle, ctx, event);
    case ParsedWebhookEventKinds.INSTALLATION_REPOSITORIES:
      return handleInstallationRepositories(handle, ctx, event);
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
): Promise<void> {
  const policy = deps.draftPolicy ?? DEFAULT_DRAFT_POLICY;
  const runDispatch = () =>
    traceStep("webhook.dispatch", readEventAttributes(event), () =>
      dispatch(deps.handle, event, policy, log),
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
    return;
  }

  await runDispatch();
  await deliveries.recordDelivery(
    { signatureDigest, deliveryId: delivery.deliveryId },
    delivery.receivedAt,
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
    try {
      await dispatchOnce(
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
    return c.json({ ok: true }, HttpStatuses.OK);
  });

  return app;
}
