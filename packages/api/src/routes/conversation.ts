// The PR-conversation surface (BRIEF-25, ADR 0027): a gated live-fetch GET and
// a gated reply POST.
//
// READ — GET /api/repos/:repoId/pulls/:prNumber/conversation: fetched live
// from GitHub over the package's GraphQL primitive with the INSTALLATION
// token (the gate already proved the viewer's repo access; a shared token
// means one rate budget and ONE cache entry per PR — viewer tokens would
// fragment both). 60s positive TTL, response `no-store`, nothing persisted.
// No REST fallback tier: a fetch failure is the section's error state.
//
// WRITE — POST .../comments/:commentId/replies: the VIEWER's token (ADR 0016
// #4 — authorship stays the reviewer's), lazy-decrypt + refresh-once, fresh
// repo re-resolve before the mutating call (gated-route rule), and the PR's
// conversation cache key is evicted on success so the next read reflects it.
//
// The installation octokit enters through `ConversationGitHubPort` — injected
// by the composition root (`appConversationPort` over the App-JWT client),
// substituted in tests. This package never constructs App auth itself.
import { Hono, type Context } from "hono";
import {
  createReviewCommentReply,
  createUserOctokit,
  fetchRepositoryById,
  fetchPullRequestConversation,
  getInstallationClient,
  GitHubApiErrorCode,
  type AppClient,
  type FetchPullRequestConversationInput,
  type GitHubApiError,
  type PrConversation,
} from "github";
import {
  audit,
  AuditAction,
  AuditActorType,
  decryptToken,
  forTenant,
  type InstallationId,
  type RepoId,
} from "persistence";
import type { Result } from "types";
import { z } from "zod";
import { refreshSessionToken, type AuthRouteDeps } from "./auth";
import { createAuthzMiddleware, type AuthzEnv } from "./authz";
import { createTtlCache } from "./ttl-cache";

// ---------------------------------------------------------------------------
// The installation-octokit seam.
// ---------------------------------------------------------------------------

/** The one installation-token read this surface performs (test seam). */
export interface ConversationGitHubPort {
  fetchPullRequestConversation(
    installationId: InstallationId,
    input: FetchPullRequestConversationInput,
  ): Promise<Result<PrConversation, GitHubApiError>>;
}

/** The production port over `github`'s App-JWT client. */
export function appConversationPort(app: AppClient): ConversationGitHubPort {
  return {
    async fetchPullRequestConversation(installationId, input) {
      // Minting the installation token talks to GitHub and can reject — that
      // rejection must become a sanitized Result (the route's 502), never an
      // unhandled 500 outside the no-store policy (codex round 1). The static
      // message carries nothing from the thrown error.
      let octokit: Awaited<ReturnType<typeof getInstallationClient>>;
      try {
        octokit = await getInstallationClient(app, installationId);
      } catch {
        return {
          ok: false,
          error: {
            code: GitHubApiErrorCode.REQUEST_FAILED,
            message:
              "failed to fetch pull request conversation: installation client unavailable",
          },
        };
      }
      return fetchPullRequestConversation(octokit, input);
    },
  };
}

// ---------------------------------------------------------------------------
// Boundary schemas + constants.
// ---------------------------------------------------------------------------

const prNumberSchema = z.coerce.number().int().positive();
/** A reply target id is a REST comment id — bounded by JS integer precision. */
const commentIdSchema = z.coerce
  .number()
  .int()
  .positive()
  .refine((value) => Number.isSafeInteger(value));

/** Same cap GitHub enforces on comment bodies (and the submit route mirrors). */
const MAX_REPLY_BODY_LENGTH = 65_536;
const replyBodySchema = z.object({
  body: z.string().min(1).max(MAX_REPLY_BODY_LENGTH),
});

/** Positive TTL — same 60s staleness family as the other gated reads. */
const CONVERSATION_CACHE_TTL_MS = 60 * 1000;
/**
 * Cap on cached conversations (keyed installation×repo×PR — reused across
 * viewers, unlike the never-reused session-keyed caches, but new PRs keep
 * arriving so the map still needs a bound).
 */
const CONVERSATION_CACHE_MAX_ENTRIES = 2_000;

function cacheKey(installationId: InstallationId, repoId: RepoId, prNumber: number): string {
  return `${String(installationId)}:${String(repoId)}:${prNumber}`;
}

/** Sanitized error response with the gated-route `no-store` posture. */
function errorJson(
  c: Context<AuthzEnv>,
  message: string,
  status: 400 | 401 | 404 | 502,
): Response {
  return c.json({ error: message }, status, { "cache-control": "no-store" });
}

/** Split the gate's verified `owner/name`; `undefined` on a non-slug shape. */
function splitRepoSlug(fullName: string): { owner: string; repo: string } | undefined {
  const parts = fullName.split("/");
  const [owner, repo] = parts;
  if (parts.length !== 2 || owner === undefined || owner === "" || repo === undefined || repo === "") {
    return undefined;
  }
  return { owner, repo };
}

/** Decrypt a session's stored access token; `undefined` if it is unreadable. */
async function resolveSessionToken(
  deps: AuthRouteDeps,
  session: { keyRef: string; ghTokenCiphertext: string },
): Promise<string | undefined> {
  const decrypted = await decryptToken(
    deps.auth.keyProvider,
    session.keyRef,
    session.ghTokenCiphertext,
  );
  return decrypted.ok ? decrypted.value : undefined;
}

// ---------------------------------------------------------------------------
// Route factory.
// ---------------------------------------------------------------------------

export interface ConversationRouteDeps extends AuthRouteDeps {
  readonly github: ConversationGitHubPort;
}

export interface ConversationRoutes {
  readonly app: Hono<AuthzEnv>;
  /**
   * Drop the PR's cached conversation. EVERY conversation write calls this —
   * the reply POST below, and the review-submit route's success path — so a
   * post-write refetch reflects the write inside the 60s TTL.
   */
  evictConversation(installationId: InstallationId, repoId: RepoId, prNumber: number): void;
}

/** Mount the conversation surface behind its own per-repo gate instance. */
export function conversationRoutes(deps: ConversationRouteDeps): ConversationRoutes {
  const app = new Hono<AuthzEnv>();
  const authz = createAuthzMiddleware(deps);
  // Serialized response bodies, keyed installation:repo:pr (one entry per PR
  // shared across every viewer — the point of the installation-token read).
  const cache = createTtlCache<string>(CONVERSATION_CACHE_MAX_ENTRIES);

  app.use("/api/repos/:repoId/pulls/:prNumber/conversation", authz);
  app.use("/api/repos/:repoId/pulls/:prNumber/comments/:commentId/replies", authz);

  app.get("/api/repos/:repoId/pulls/:prNumber/conversation", async (c) => {
    const ctx = c.get("ctx");
    const repoId = c.get("repoId");
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedPr.success) {
      return errorJson(c, "invalid request", 400);
    }
    const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(repoId, parsedPr.data);
    if (pr === undefined) {
      return errorJson(c, "not found", 404);
    }

    const key = cacheKey(ctx.installationId, repoId, pr.prNumber);
    const now = Date.now();
    const cached = cache.get(key, now);
    if (cached !== undefined) {
      return conversationJson(c, cached);
    }

    // Fetch by the AUTHZ-VERIFIED full name (read posture — ≤60s staleness is
    // the same budget as the gate's own positive cache).
    const target = splitRepoSlug(c.get("repoFullName"));
    if (target === undefined) {
      return errorJson(c, "not found", 404);
    }
    const fetched = await deps.github.fetchPullRequestConversation(ctx.installationId, {
      owner: target.owner,
      repo: target.repo,
      prNumber: pr.prNumber,
    });
    if (!fetched.ok) {
      // 404-collapse posture identical to the other reads; everything else is
      // an honest upstream error (no REST fallback tier — ADR 0027).
      if (fetched.error.code === GitHubApiErrorCode.NOT_FOUND) {
        return errorJson(c, "not found", 404);
      }
      return errorJson(c, "upstream error", 502);
    }
    const body = JSON.stringify(withoutEntryComment(fetched.value, pr.entryCommentId));
    cache.set(key, body, now + CONVERSATION_CACHE_TTL_MS, now);
    return conversationJson(c, body);
  });

  app.post("/api/repos/:repoId/pulls/:prNumber/comments/:commentId/replies", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return errorJson(c, "invalid request", 400);
    }
    const parsedBody = replyBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return errorJson(c, "invalid request", 400);
    }
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    const parsedComment = commentIdSchema.safeParse(c.req.param("commentId"));
    if (!parsedPr.success || !parsedComment.success) {
      return errorJson(c, "invalid request", 400);
    }

    const ctx = c.get("ctx");
    const repoId = c.get("repoId");
    const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(repoId, parsedPr.data);
    if (pr === undefined) {
      return errorJson(c, "not found", 404);
    }

    // Viewer token: set by the gate on the verified path; on a positive-cache
    // hit decrypt lazily (same pattern as the diff proxy / submit route).
    let currentSession = c.get("session");
    const resolvedToken =
      c.get("accessToken") ?? (await resolveSessionToken(deps, currentSession));
    if (resolvedToken === undefined) {
      return errorJson(c, "unauthorized", 401);
    }
    let accessToken: string = resolvedToken;

    // One refresh budget per REQUEST, shared across both GitHub calls.
    let refreshSpent = false;
    const spendRefresh = async (): Promise<boolean> => {
      if (refreshSpent) {
        return false;
      }
      refreshSpent = true;
      const refreshed = await refreshSessionToken(deps, currentSession, c.get("logger"));
      if (!refreshed.ok) {
        return false;
      }
      currentSession = refreshed.value.session;
      accessToken = refreshed.value.accessToken;
      return true;
    };

    // Mutations re-resolve the repo FRESH by numeric id (gated-route rule):
    // the gate's cached full name is ≤60s stale, and a rename + name-reuse
    // inside that window would point the reply at the wrong repository.
    let repoInfo = await fetchRepositoryById(createUserOctokit(accessToken), repoId);
    if (
      !repoInfo.ok &&
      repoInfo.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
      (await spendRefresh())
    ) {
      repoInfo = await fetchRepositoryById(createUserOctokit(accessToken), repoId);
    }
    if (!repoInfo.ok) {
      if (repoInfo.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
        return errorJson(c, "unauthorized", 401);
      }
      // 403/404 collapse to the gate's 404 posture — no existence leak.
      if (
        repoInfo.error.code === GitHubApiErrorCode.NOT_FOUND ||
        repoInfo.error.code === GitHubApiErrorCode.FORBIDDEN
      ) {
        return errorJson(c, "not found", 404);
      }
      return errorJson(c, "upstream error", 502);
    }
    const target = splitRepoSlug(repoInfo.value.fullName);
    if (target === undefined) {
      return errorJson(c, "not found", 404);
    }

    const replyInput = {
      owner: target.owner,
      repo: target.repo,
      prNumber: pr.prNumber,
      commentId: parsedComment.data,
      body: parsedBody.data.body,
    };
    let created = await createReviewCommentReply(createUserOctokit(accessToken), replyInput);
    if (
      !created.ok &&
      created.error.code === GitHubApiErrorCode.UNAUTHORIZED &&
      (await spendRefresh())
    ) {
      created = await createReviewCommentReply(createUserOctokit(accessToken), replyInput);
    }
    if (!created.ok) {
      if (created.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
        return errorJson(c, "unauthorized", 401);
      }
      // Gated-route rule: ANY in-route GitHub denial (403/404) collapses to
      // the gate's 404 posture — a root comment gone and a permission denial
      // must be indistinguishable from a cold denial (codex round 1).
      if (
        created.error.code === GitHubApiErrorCode.NOT_FOUND ||
        created.error.code === GitHubApiErrorCode.FORBIDDEN
      ) {
        return errorJson(c, "not found", 404);
      }
      return errorJson(c, "upstream error", 502);
    }

    // The write happened: the cached conversation is stale — drop it so the
    // FE's post-reply refetch reflects the reply inside the TTL.
    cache.delete(cacheKey(ctx.installationId, repoId, pr.prNumber));

    // Audit posture consistent with submit (D9: numeric-only) — but the
    // GitHub write above is the COMMIT POINT: a local audit failure must
    // never turn a posted reply into an error response (the composer's
    // upstream copy invites a retry, which would double-post). Best-effort:
    // log and keep the 201 (codex on the reply-UI PR).
    try {
      await audit(deps.handle, {
        installationId: ctx.installationId,
        actorType: AuditActorType.REVIEWER,
        actorId: currentSession.reviewerId,
        action: AuditAction.SUBMIT,
        targetType: "review_comment",
        targetId: BigInt(created.value.commentId),
      });
    } catch (auditError) {
      // Posted to GitHub, our audit write failed — a data-integrity signal
      // the operator alerts on (ADR 0034 taxonomy).
      c.get("logger").error("reply audit failed after posted reply", {
        evt: "audit.fail",
        commentId: String(created.value.commentId),
        err: auditError,
      });
    }

    return c.json({ commentId: created.value.commentId }, 201, {
      "cache-control": "no-store",
    });
  });

  return {
    app,
    evictConversation(installationId, repoId, prNumber) {
      cache.delete(cacheKey(installationId, repoId, prNumber));
    },
  };
}

/**
 * Drop OUR Entry comment from the PR-level comments (BRIEF-57): it is the
 * product's front door on GitHub, not conversation — inside the app it would
 * render as a bot comment linking to the page the viewer is already on.
 * Filtered by the EXACT stored id (`pull_request.entry_comment_id`, rotated
 * on every delete+repost) — never by author or body shape, so no other
 * bot's comment and no human comment quoting ours can be swallowed. A
 * mid-repost race (fetch between the new post and the row update) can show
 * the comment for at most one cache TTL — accepted.
 */
function withoutEntryComment(
  conversation: PrConversation,
  entryCommentId: bigint | null,
): PrConversation {
  if (entryCommentId === null) return conversation;
  return {
    ...conversation,
    prComments: conversation.prComments.filter(
      (comment) => BigInt(comment.commentId) !== entryCommentId,
    ),
  };
}

/** A cached/serialized conversation body, per-viewer gated — `no-store`. */
function conversationJson(c: Context<AuthzEnv>, body: string): Response {
  return c.body(body, 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}
