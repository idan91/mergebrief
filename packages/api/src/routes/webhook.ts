// POST /api/webhooks/github — the TRUST BOUNDARY. Everything that arrives here
// is untrusted until the HMAC over the RAW body verifies against the configured
// secret; only then is the payload parsed (github's Zod boundary) and mapped to
// tenant-scoped writes. The tenant is derived from the SIGNED payload's
// `installation.id` — never from a header a caller could spoof past the HMAC.
//
// Response discipline: this handler must return 200 FAST for every handled or
// ignored delivery (GitHub times webhooks out at 10s) — it only upserts rows
// and enqueues one debounced job; no LLM call, no generation, no GitHub API
// call. Idempotency is inherent in the write path (natural-key upserts +
// graphile `job_key` replace), so redeliveries need no dedup logic here.
//
// Status contract:
//   401 — missing/invalid signature (nothing read, nothing written)
//   400 — signed but unparseable (bad JSON / malformed handled payload)
//   413 — body exceeds the webhook size cap (nothing read past the cap)
//   200 — handled or deliberately ignored
//   500 — unexpected throw (sanitized body; internals stay in the log)
import { Hono } from "hono";
import { type RequestLogEnv } from "../request-logging";
import type { Mutable, DraftPolicy, Result } from "types";
import { DEFAULT_DRAFT_POLICY } from "../draft-policy";
import {
  InstallationActions,
  InstallationRepositoriesActions,
  ParsedWebhookEventKinds,
  PullRequestActions,
  parseWebhookEvent,
  verifyWebhookSignature,
  type ParsedInstallationEvent,
  type ParsedInstallationRepositoriesEvent,
  type ParsedPullRequestEvent,
  type ParsedPullRequestReviewEvent,
  type ParsedWebhookEvent,
  type PullRequestAction,
} from "github";
import {
  PrStates,
  createTenantRepository,
  createIngestRoutines,
  parseTenantContext,
  createPurgeRoutines,
  type AppDatabase,
  type TenantContext,
  type TriggerGenerationInput,
} from "persistence";
import { ApiErrorCodes } from "../error-response";
import {
  BadRequest,
  InternalError,
  PayloadTooLarge,
  Unauthorized,
} from "../shared-errors/api-error";

export interface WebhookRouteDeps {
  readonly handle: AppDatabase;
  /** `GITHUB_WEBHOOK_SECRET` — injected by the startup wiring. */
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

/** Raw-body read outcome; the only expected failure is the size cap. */
type RawBodyResult = Result<string, "body-too-large">;

/**
 * The `pull_request` actions that (re)queue a generation. `closed` is handled
 * separately (state write, NO enqueue); anything else the parser normalizes is
 * a no-op here.
 */
const GENERATION_TRIGGER_ACTIONS: ReadonlySet<PullRequestAction> = new Set([
  PullRequestActions.OPENED,
  PullRequestActions.SYNCHRONIZE,
  PullRequestActions.REOPENED,
  PullRequestActions.READY_FOR_REVIEW,
  PullRequestActions.REVIEW_REQUESTED,
]);

async function handlePullRequest(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedPullRequestEvent,
  policy: DraftPolicy,
): Promise<void> {
  if (event.action === PullRequestActions.CLOSED) {
    // Terminal state write, NO enqueue. `purgeAfter: null` = "never sweep":
    // the retention window is unconfigured, so closing arms nothing.
    await createTenantRepository(handle, ctx).pullRequests.upsert({
      repoId: event.repoId,
      prNumber: event.prNumber,
      repoSlug: event.repoFullName,
      title: event.title,
      baseSha: event.baseSha,
      draft: event.draft,
      ...(event.authorLogin === undefined
        ? {}
        : { authorLogin: event.authorLogin }),
      state: event.merged === true ? PrStates.MERGED : PrStates.CLOSED,
      closedAt: new Date(),
      purgeAfter: null,
    });
    return;
  }
  if (event.action === PullRequestActions.CONVERTED_TO_DRAFT) {
    // ready→draft re-entry: state-only. Persist through the terminal-preserving
    // ingest upsert, but do NOT touch the generation projection or enqueue —
    // re-triggering the worker's skip-path is not a no-op (Entry-comment repost
    // ping, compare-diff spend, phantom `queued` status, and a full LLM re-run
    // if the head's last generation failed).
    await createIngestRoutines(handle, ctx).recordState({
      repoId: event.repoId,
      prNumber: event.prNumber,
      repoSlug: event.repoFullName,
      title: event.title,
      baseSha: event.baseSha,
      draft: event.draft,
      ...(event.authorLogin === undefined
        ? {}
        : { authorLogin: event.authorLogin }),
      state: PrStates.OPEN,
    });
    return;
  }
  if (GENERATION_TRIGGER_ACTIONS.has(event.action)) {
    if (event.draft && !policy.generate) {
      // Instance policy: drafts don't generate. State-only write, same shape
      // as the converted_to_draft path — the PR stays current so
      // the eventual `ready_for_review` (draft: false) takes the normal
      // trigger path and produces the FIRST generation. A `reopened` draft
      // must still leave the terminal state here (the reopen flag), or the
      // row wedges closed forever — no later event carries the reopen intent.
      await createIngestRoutines(handle, ctx).recordState(
        {
          repoId: event.repoId,
          prNumber: event.prNumber,
          repoSlug: event.repoFullName,
          title: event.title,
          baseSha: event.baseSha,
          draft: event.draft,
          ...(event.authorLogin === undefined
            ? {}
            : { authorLogin: event.authorLogin }),
          state: PrStates.OPEN,
        },
        { reopen: event.action === PullRequestActions.REOPENED },
      );
      return;
    }
    await triggerGeneration(
      handle,
      ctx,
      event,
      windowOverrides(event, event.draft, policy),
    );
  }
}

/**
 * The enqueue-window rule: `ready_for_review` → the short constant flip window
 * (cancels a pending draft-damped job via job-key replace); a draft trigger
 * under configured damping → the regeneration window (persistence applies it
 * only once a prior brief SUCCEEDED, so a draft's first brief stays fast);
 * everything else → no override.
 */
function windowOverrides(
  event: ParsedPullRequestEvent,
  isDraft: boolean,
  policy: DraftPolicy,
): Pick<
  TriggerGenerationInput,
  "debounceSeconds" | "regenerationDebounceSeconds"
> {
  if (event.action === PullRequestActions.READY_FOR_REVIEW) {
    return { debounceSeconds: READY_FLIP_DEBOUNCE_SECONDS };
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
): Promise<void> {
  // Generation gap-filler: a submitted review re-queues the brief for the
  // current head — but only for a PR we have already
  // ingested. A review on an UNKNOWN PR would take the INSERT path and mint a
  // phantom `open` row (the PR may well be closed; reviews can be submitted on
  // closed PRs), so it is skipped: if we missed the PR's own events, the next
  // `pull_request` delivery ingests it properly. On a KNOWN terminal PR the
  // ingest guard preserves the lifecycle and skips the enqueue.
  const tenant = createTenantRepository(handle, ctx);
  const known = await tenant.pullRequests.getByNumber(
    event.repoId,
    event.prNumber,
  );
  if (known === undefined) {
    return;
  }
  // The WEBHOOK is the only checkpoint writer — including the echo of our own
  // submit route — so one code path covers in-app and native github.com
  // reviews. Pinned to `review.commit_id` (the head the reviewer actually
  // saw), never head-at-delivery. Bot-authored reviews are skipped: a bot
  // checkpoint would pre-warm delta baselines no human ever opens (LLM spend).
  // Ordered BEFORE the enqueue so the worker's state derivation sees the new
  // baseline. Redeliveries are safe (idempotent, newest-submission-wins).
  if (event.reviewerType !== "Bot") {
    const checkpointed = await tenant.checkpoints.upsertOnSubmit({
      pullRequestId: known.id,
      reviewerId: event.reviewerId,
      reviewerLogin: event.reviewerLogin,
      lastSubmittedSha: event.commitId,
      submittedAt: event.submittedAt,
    });
    if (!checkpointed.ok) {
      // The parent was verified above inside this tenant, so a failure here is
      // a programmer/infra error — surface it as the route's 500.
      throw new Error(`checkpoint upsert failed: ${checkpointed.error.code}`);
    }
  }
  // Review events carry no draft flag; the STORED row (loaded above for the
  // known-PR guard) supplies it. Under drafts-off the checkpoint still
  // landed — it's reviewer-baseline state, not spend — but no job enqueues.
  if (known.draft && !policy.generate) {
    return;
  }
  // No window override: damping exists for WIP push storms, and a submitted
  // review is deliberate human engagement — its gap-filler regeneration
  // takes the normal window even on a damped draft.
  await triggerGeneration(handle, ctx, event, {});
}

async function triggerGeneration(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedPullRequestEvent | ParsedPullRequestReviewEvent,
  overrides: Pick<
    TriggerGenerationInput,
    "debounceSeconds" | "regenerationDebounceSeconds"
  >,
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
  const result = await createIngestRoutines(handle, ctx).triggerGeneration({
    pullRequest,
    headSha: event.headSha,
    reopen,
    ...overrides,
  });
  if (!result.ok) {
    // Every override above is a validated constant or a loader-validated
    // policy value, so an error here is a programmer error — surface it as
    // the route's 500, never swallow it.
    throw new Error(`ingest trigger failed: ${result.error.code}`);
  }
}

async function handleInstallation(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedInstallationEvent,
): Promise<void> {
  if (event.action === InstallationActions.DELETED) {
    // App uninstalled → the tenant offboards: createPurgeRoutines deletes all PR
    // aggregates (children cascade) + sessions and emits its own `delete`
    // audit entry, in one transaction.
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

async function dispatch(
  handle: AppDatabase,
  event: ParsedWebhookEvent,
  policy: DraftPolicy,
): Promise<void> {
  if (event.kind === ParsedWebhookEventKinds.IGNORED) {
    return;
  }
  // The tenant boundary: the branded installation id from the SIGNED payload,
  // revalidated through persistence's context schema.
  const ctx = parseTenantContext({ installationId: event.installationId });
  switch (event.kind) {
    case ParsedWebhookEventKinds.PULL_REQUEST:
      return handlePullRequest(handle, ctx, event, policy);
    case ParsedWebhookEventKinds.PULL_REQUEST_REVIEW:
      return handlePullRequestReview(handle, ctx, event, policy);
    case ParsedWebhookEventKinds.INSTALLATION:
      return handleInstallation(handle, ctx, event);
    case ParsedWebhookEventKinds.INSTALLATION_REPOSITORIES:
      return handleInstallationRepositories(handle, ctx, event);
  }
}

async function readRawBodyWithinLimit(
  request: Request,
): Promise<RawBodyResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (
      Number.isFinite(parsedLength) &&
      parsedLength > MAX_WEBHOOK_BODY_BYTES
    ) {
      return { ok: false, error: "body-too-large" };
    }
  }

  if (request.body === null) {
    return { ok: true, value: "" };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      // Stream reads are inherently sequential — each chunk arrives only
      // after the previous read resolves — so there is nothing to parallelize.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        chunks.push(decoder.decode());
        return { ok: true, value: chunks.join("") };
      }
      bytesRead += value.byteLength;
      if (bytesRead > MAX_WEBHOOK_BODY_BYTES) {
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        return { ok: false, error: "body-too-large" };
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
}

/** Mountable webhook route; deps injected so tests pass a PGlite handle. */
export function webhookRoute(deps: WebhookRouteDeps): Hono<RequestLogEnv> {
  const app = new Hono<RequestLogEnv>();

  app.post("/github", async (c) => {
    // GitHub's delivery id rides every webhook event line as a child binding —
    // the operator's join key back to the delivery record. The header lands
    // PRE-verify on a public endpoint, so anything outside GitHub's GUID
    // charset/length is dropped rather than bound (log-injection /
    // volume-inflation control).
    const rawDeliveryId = c.req.header("x-github-delivery");
    const deliveryId =
      rawDeliveryId !== undefined && /^[\w-]{1,64}$/.test(rawDeliveryId)
        ? rawDeliveryId
        : undefined;
    const log =
      deliveryId === undefined
        ? c.get("logger")
        : c.get("logger").child({ deliveryId });

    // Verify the HMAC over the RAW body BEFORE any parsing — the exact bytes
    // GitHub signed, never a JSON re-encode.
    const rawBody = await readRawBodyWithinLimit(c.req.raw);
    if (!rawBody.ok) {
      throw new PayloadTooLarge(ApiErrorCodes.REQUEST_TOO_LARGE);
    }
    const raw = rawBody.value;
    const signature = c.req.header("x-hub-signature-256");
    const eventName = c.req.header("x-github-event") ?? "";

    const verified = await verifyWebhookSignature({
      secret: deps.webhookSecret,
      payload: raw,
      signature,
    });
    if (!verified.ok) {
      // Warn, not error — raw hits are scanner noise; a SUSTAINED rate
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
    // sanitized body — internals never reach the caller.
    try {
      await dispatch(
        deps.handle,
        parsed.value,
        deps.draftPolicy ?? DEFAULT_DRAFT_POLICY,
      );
    } catch (error) {
      log.error("webhook dispatch failed", {
        evt: "webhook.dispatch.fail",
        err: error,
      });
      throw new InternalError();
    }
    return c.json({ ok: true }, 200);
  });

  return app;
}
