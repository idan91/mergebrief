// The PR-conversation read: GET /conversation, fetched live from GitHub over
// the package's GraphQL primitive with the INSTALLATION token (the gate
// already proved the viewer's repo access; a shared token means one rate
// budget and ONE cache entry per PR — viewer tokens would fragment both).
// 60s positive TTL, response `no-store`, nothing persisted. No REST fallback
// tier: a fetch failure is the section's error state.
//
// This module OWNS the conversation cache: the returned `evictConversation`
// hook is how every conversation write (review submit, the comments routes)
// drops the PR's entry on its success path.
//
// The installation octokit enters through `InstallationGitHubPort`
// (injected by the startup wiring over the App-JWT client, substituted in
// tests). This package never constructs App auth itself.
import type { Context } from "hono";
import { GitHubApiErrorCode, type PrConversation } from "github";
import { forTenant, type InstallationId, type RepoId } from "persistence";
import { z } from "zod";
import type { AuthRouteDeps } from "../../auth/session";
import type { AuthzEnv } from "../../authz";
import type { InstallationGitHubPort } from "../../github-port";
import { createTtlCache } from "../../ttl-cache";
import { ApiErrorCode, errorJson } from "../../../error-response";
import { PRODUCT_QUERY_ID } from "../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../product-operations/types";

const prNumberSchema = z.coerce.number().int().positive();

/** Positive TTL — same 60s staleness family as the other gated reads. */
const CONVERSATION_CACHE_TTL_MS = 60 * 1000;
/**
 * Cap on cached conversations (keyed installation×repo×PR — reused across
 * viewers, unlike the never-reused session-keyed caches, but new PRs keep
 * arriving so the map still needs a bound).
 */
const CONVERSATION_CACHE_MAX_ENTRIES = 2_000;

function cacheKey(
  installationId: InstallationId,
  repoId: RepoId,
  prNumber: number,
): string {
  return `${String(installationId)}:${String(repoId)}:${prNumber}`;
}

/** Split the gate's verified `owner/name`; `undefined` on a non-slug shape. */
function splitRepoSlug(
  fullName: string,
): { owner: string; repo: string } | undefined {
  const parts = fullName.split("/");
  const [owner, repo] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    owner === "" ||
    repo === undefined ||
    repo === ""
  ) {
    return undefined;
  }
  return { owner, repo };
}

// ---------------------------------------------------------------------------
// Route factory.
// ---------------------------------------------------------------------------

export interface ConversationRouteDeps extends AuthRouteDeps {
  readonly github: InstallationGitHubPort;
}

export interface ConversationRoutes {
  readonly router: ProductRouter<AuthzEnv>;
  /**
   * Drop the PR's cached conversation. EVERY conversation write calls this —
   * the comments routes and the review-submit route's success paths — so a
   * post-write refetch reflects the write inside the 60s TTL.
   */
  evictConversation(
    installationId: InstallationId,
    repoId: RepoId,
    prNumber: number,
  ): void;
}

/** Mount the conversation read behind the pr subtree's shared gate. */
export function conversationRoutes(
  deps: ConversationRouteDeps,
): ConversationRoutes {
  const app = productRouter<AuthzEnv>();
  // Serialized response bodies, keyed installation:repo:pr (one entry per PR
  // shared across every viewer — the point of the installation-token read).
  const cache = createTtlCache<string>(CONVERSATION_CACHE_MAX_ENTRIES);

  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_CONVERSATION,
      classification: WRITE_CLASSIFICATION.READ,
      agentAvailable: true,
    },
    "/",
    async (c) => {
      const ctx = c.get("ctx");
      const repoId = c.get("repoId");
      const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
      if (!parsedPr.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(
        repoId,
        parsedPr.data,
      );
      if (pr === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
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
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      const fetched = await deps.github.fetchPullRequestConversation(
        ctx.installationId,
        {
          owner: target.owner,
          repo: target.repo,
          prNumber: pr.prNumber,
        },
      );
      if (!fetched.ok) {
        // 404-collapse posture identical to the other reads; everything else is
        // an honest upstream error (no REST fallback tier).
        if (fetched.error.code === GitHubApiErrorCode.NOT_FOUND) {
          return errorJson(c, ApiErrorCode.NOT_FOUND);
        }
        return errorJson(c, ApiErrorCode.GITHUB_UNAVAILABLE);
      }
      const body = JSON.stringify(
        withoutEntryComment(fetched.value, pr.entryCommentId),
      );
      cache.set(key, body, now + CONVERSATION_CACHE_TTL_MS, now);
      return conversationJson(c, body);
    },
  );

  return {
    router: app,
    evictConversation(installationId, repoId, prNumber) {
      cache.delete(cacheKey(installationId, repoId, prNumber));
    },
  };
}

/**
 * Drop OUR Entry comment from the PR-level comments: it is the product's front
 * door on GitHub, not conversation. Filtered by the EXACT stored id — never by
 * author or body shape, so no other bot's comment and no human comment quoting
 * ours can be swallowed. A mid-repost race can show the comment for at most
 * one cache TTL.
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
