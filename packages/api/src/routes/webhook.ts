// POST /api/webhooks/github — the TRUST BOUNDARY (BRIEF-2 stage 4, plan
// decision #1 + ADR 0020). Everything that arrives here is untrusted until
// the HMAC over the RAW body verifies against the configured secret; only
// then is the payload parsed (github's Zod boundary) and mapped to
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
import type { Result } from "types";
import {
  InstallationAction,
  InstallationRepositoriesAction,
  ParsedWebhookEventKind,
  PullRequestAction,
  parseWebhookEvent,
  verifyWebhookSignature,
  type ParsedInstallationEvent,
  type ParsedInstallationRepositoriesEvent,
  type ParsedPullRequestEvent,
  type ParsedPullRequestReviewEvent,
  type ParsedWebhookEvent,
} from "github";
import {
  PrState,
  forTenant,
  ingestRoutines,
  parseTenantContext,
  purgeRoutines,
  type AppDatabase,
  type TenantContext,
} from "persistence";

export interface WebhookRouteDeps {
  readonly handle: AppDatabase;
  /** `GITHUB_WEBHOOK_SECRET` — injected by the composition root (stage 5). */
  readonly webhookSecret: string;
}

/** Hard cap for public webhook bodies: enough for GitHub JSON, bounded for DoS. */
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

/** Raw-body read outcome; the only expected failure is the size cap. */
type RawBodyResult = Result<string, "body-too-large">;

/**
 * The `pull_request` actions that (re)queue a generation (plan decision #1).
 * `closed` is handled separately (state write, NO enqueue); anything else the
 * parser normalizes is a no-op here.
 */
const GENERATION_TRIGGER_ACTIONS: ReadonlySet<PullRequestAction> = new Set([
  PullRequestAction.OPENED,
  PullRequestAction.SYNCHRONIZE,
  PullRequestAction.REOPENED,
  PullRequestAction.READY_FOR_REVIEW,
  PullRequestAction.REVIEW_REQUESTED,
]);

async function handlePullRequest(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedPullRequestEvent,
): Promise<void> {
  if (event.action === PullRequestAction.CLOSED) {
    // Terminal state write, NO enqueue. `purgeAfter: null` = "never sweep":
    // the retention window is unconfigured in M1, so closing arms nothing.
    // Wiring a grace (`purgeRoutines.setRetention` + a `retention-grace-days`
    // knob) is deferred — documented-not-built.
    await forTenant(handle, ctx).pullRequests.upsert({
      repoId: event.repoId,
      prNumber: event.prNumber,
      repoSlug: event.repoFullName,
      title: event.title,
      baseSha: event.baseSha,
      draft: event.draft,
      ...(event.authorLogin === undefined ? {} : { authorLogin: event.authorLogin }),
      state: event.merged === true ? PrState.MERGED : PrState.CLOSED,
      closedAt: new Date(),
      purgeAfter: null,
    });
    return;
  }
  if (event.action === PullRequestAction.CONVERTED_TO_DRAFT) {
    // ready→draft re-entry (BRIEF-43): state-only. Persist draft=true (and the
    // refreshed labels) through the terminal-preserving ingest upsert, but do
    // NOT touch the generation projection or enqueue — entering draft has no
    // regen rationale, and re-triggering the worker's skip-path is not a no-op
    // (Entry-comment repost ping, compare-diff spend, phantom `queued` status,
    // and a full LLM re-run if the head's last generation failed).
    await ingestRoutines(handle, ctx).recordState({
      repoId: event.repoId,
      prNumber: event.prNumber,
      repoSlug: event.repoFullName,
      title: event.title,
      baseSha: event.baseSha,
      draft: event.draft,
      ...(event.authorLogin === undefined ? {} : { authorLogin: event.authorLogin }),
      state: PrState.OPEN,
    });
    return;
  }
  if (GENERATION_TRIGGER_ACTIONS.has(event.action)) {
    await triggerGeneration(handle, ctx, event);
  }
}

async function handlePullRequestReview(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedPullRequestReviewEvent,
): Promise<void> {
  // Generation gap-filler (plan decision #1): a submitted review re-queues
  // the brief for the current head — but only for a PR we have already
  // ingested. A review on an UNKNOWN PR would take the INSERT path and mint a
  // phantom `open` row (the PR may well be closed; reviews can be submitted on
  // closed PRs), so it is skipped: if we missed the PR's own events, the next
  // `pull_request` delivery ingests it properly. On a KNOWN terminal PR the
  // ingest guard preserves the lifecycle and skips the enqueue.
  const tenant = forTenant(handle, ctx);
  const known = await tenant.pullRequests.getByNumber(event.repoId, event.prNumber);
  if (known === undefined) {
    return;
  }
  // Checkpoint (BRIEF-23, grill-locked): the WEBHOOK is the only checkpoint
  // writer — including the echo of our own submit route — so one code path
  // covers in-app and native github.com reviews. Pinned to `review.commit_id`
  // (the head the reviewer actually saw), never head-at-delivery. Bot-authored
  // reviews are skipped: a bot checkpoint would pre-warm delta baselines no
  // human ever opens (LLM spend). Ordered BEFORE the enqueue so the worker's
  // state derivation sees the new baseline. Redeliveries are safe (idempotent,
  // monotonic newest-submission-wins upsert).
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
  await triggerGeneration(handle, ctx, event);
}

async function triggerGeneration(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedPullRequestEvent | ParsedPullRequestReviewEvent,
): Promise<void> {
  // Only a `reopened` pull_request event may transition a terminal PR back to
  // open; a review or any other trigger merely implies the PR is open and must
  // not resurrect a since-closed PR (a review CAN be submitted on a closed one).
  const reopen = "action" in event && event.action === PullRequestAction.REOPENED;
  const result = await ingestRoutines(handle, ctx).triggerGeneration({
    pullRequest: {
      repoId: event.repoId,
      prNumber: event.prNumber,
      repoSlug: event.repoFullName,
      title: event.title,
      // Review events carry no base SHA; omission preserves the stored one.
      ...("baseSha" in event ? { baseSha: event.baseSha } : {}),
      // Draft + author ride pull_request events only; a review omits both, so
      // omission preserves the stored values (same as base_sha).
      ...("draft" in event ? { draft: event.draft } : {}),
      ...("authorLogin" in event && event.authorLogin !== undefined
        ? { authorLogin: event.authorLogin }
        : {}),
      state: PrState.OPEN,
    },
    headSha: event.headSha,
    reopen,
  });
  if (!result.ok) {
    // No debounce override is passed above, so an error here is a programmer
    // error — surface it as the route's 500, never swallow it.
    throw new Error(`ingest trigger failed: ${result.error.code}`);
  }
}

async function handleInstallation(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedInstallationEvent,
): Promise<void> {
  if (event.action === InstallationAction.DELETED) {
    // App uninstalled → the tenant offboards: purgeRoutines deletes all PR
    // aggregates (children cascade) + sessions and emits its own `delete`
    // audit entry, in one transaction.
    await purgeRoutines(handle, ctx).purgeInstallation();
  }
  // `created` is a no-op: rows appear lazily when the first PR event lands.
}

async function handleInstallationRepositories(
  handle: AppDatabase,
  ctx: TenantContext,
  event: ParsedInstallationRepositoriesEvent,
): Promise<void> {
  if (event.action !== InstallationRepositoriesAction.REMOVED) {
    return; // `added` is a no-op, same lazy-row reasoning as install-created.
  }
  // ONE set-based transaction (not a per-repo Promise.all, which would open N
  // concurrent pool connections and could starve the webhook's fast 200 on a
  // large deselection). Per-repo audit granularity is preserved inside it.
  await purgeRoutines(handle, ctx).purgeRepos(event.repoIdsRemoved);
}

async function dispatch(handle: AppDatabase, event: ParsedWebhookEvent): Promise<void> {
  if (event.kind === ParsedWebhookEventKind.IGNORED) {
    return;
  }
  // The tenant boundary: the branded installation id from the SIGNED payload,
  // revalidated through persistence's context schema.
  const ctx = parseTenantContext({ installationId: event.installationId });
  switch (event.kind) {
    case ParsedWebhookEventKind.PULL_REQUEST:
      return handlePullRequest(handle, ctx, event);
    case ParsedWebhookEventKind.PULL_REQUEST_REVIEW:
      return handlePullRequestReview(handle, ctx, event);
    case ParsedWebhookEventKind.INSTALLATION:
      return handleInstallation(handle, ctx, event);
    case ParsedWebhookEventKind.INSTALLATION_REPOSITORIES:
      return handleInstallationRepositories(handle, ctx, event);
  }
}

async function readRawBodyWithinLimit(request: Request): Promise<RawBodyResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_WEBHOOK_BODY_BYTES) {
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
export function webhookRoute(deps: WebhookRouteDeps): Hono {
  const app = new Hono();

  app.post("/api/webhooks/github", async (c) => {
    // 1–3. Verify the HMAC over the RAW body BEFORE any parsing — the exact
    // bytes GitHub signed, never a JSON re-encode.
    const rawBody = await readRawBodyWithinLimit(c.req.raw);
    if (!rawBody.ok) {
      return c.json({ error: "request body too large" }, 413);
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
      return c.json({ error: "invalid signature" }, 401);
    }

    // 4. Signed, so now worth parsing. Bad JSON from a signer is still a 400.
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "request body is not valid JSON" }, 400);
    }

    // 5. Zod boundary: malformed-but-signed handled payload → 400.
    const parsed = parseWebhookEvent({ eventName, payload });
    if (!parsed.ok) {
      return c.json({ error: "malformed webhook payload" }, 400);
    }

    // 6–8. Map the event to tenant-scoped writes. Unexpected throw → 500
    // with a sanitized body — internals never reach the caller.
    try {
      await dispatch(deps.handle, parsed.value);
    } catch (error) {
      console.error("webhook dispatch failed", error);
      return c.json({ error: "internal error" }, 500);
    }
    return c.json({ ok: true }, 200);
  });

  return app;
}
