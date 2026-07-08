// The PR-conversation read surface (BRIEF-25, ADR 0027).
//
// GET /api/repos/:repoId/pulls/:prNumber/conversation: fetched live from
// GitHub over the package's GraphQL primitive with the INSTALLATION token
// (the gate already proved the viewer's repo access; a shared token means
// one rate budget and ONE cache entry per PR — viewer tokens would fragment
// both). 60s positive TTL, response `no-store`, nothing persisted. No REST
// fallback tier: a fetch failure is the section's error state.
//
// The reply POST (viewer token) and write-path cache eviction land in the
// next PR of the stack; the installation octokit enters through
// `ConversationGitHubPort` — injected by the composition root
// (`appConversationPort` over the App-JWT client), substituted in tests.
// This package never constructs App auth itself.
import { Hono, type Context } from "hono";
import {
  fetchPullRequestConversation,
  getInstallationClient,
  GitHubApiErrorCode,
  type AppClient,
  type FetchPullRequestConversationInput,
  type GitHubApiError,
  type PrConversation,
} from "github";
import { forTenant, type InstallationId, type RepoId } from "persistence";
import type { Result } from "types";
import { z } from "zod";
import type { AuthRouteDeps } from "./auth";
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
  status: 400 | 404 | 502,
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


// ---------------------------------------------------------------------------
// Route factory.
// ---------------------------------------------------------------------------

export interface ConversationRouteDeps extends AuthRouteDeps {
  readonly github: ConversationGitHubPort;
}

/** Mount the conversation read behind its own per-repo gate instance. */
export function conversationRoute(deps: ConversationRouteDeps): Hono<AuthzEnv> {
  const app = new Hono<AuthzEnv>();
  const authz = createAuthzMiddleware(deps);
  // Serialized response bodies, keyed installation:repo:pr (one entry per PR
  // shared across every viewer — the point of the installation-token read).
  const cache = createTtlCache<string>(CONVERSATION_CACHE_MAX_ENTRIES);

  app.use("/api/repos/:repoId/pulls/:prNumber/conversation", authz);

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
    const body = JSON.stringify(fetched.value);
    cache.set(key, body, now + CONVERSATION_CACHE_TTL_MS, now);
    return conversationJson(c, body);
  });

  return app;
}


/** A cached/serialized conversation body, per-viewer gated — `no-store`. */
function conversationJson(c: Context<AuthzEnv>, body: string): Response {
  return c.body(body, 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}
