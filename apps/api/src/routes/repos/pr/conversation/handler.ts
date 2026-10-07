import type { Context } from "hono";
import { GitHubApiErrorCodes } from "github";
import {
  createTenantRepository,
  isOwnerContext,
  type AppDatabase,
} from "persistence";
import {
  BadGateway,
  BadRequest,
  NotFound,
  Unauthorized,
} from "../../../../shared-errors/api-error";
import { isTokenUnreadableFailure } from "../../../../shared-errors/failures";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { readFallbackTokenFor, type AuthzEnv } from "../../../authz";
import type { InstallationGitHubPort } from "../../../github-port";
import type { TtlCache } from "../../../ttl-cache";
import { parseOwnerAndName } from "../../utils";
import { prNumberSchema } from "../../../wire-bounds";
import { conversationController } from "./controller";
import type { ReadConversationResult } from "./types";
import { CONVERSATION_CACHE_TTL_MS } from "./consts";
import { buildConversationCacheKey } from "./utils";
import { ApiErrorCodes } from "contract";
import { resolvePrScopeFrom } from "../scope";
import { HttpStatuses } from "types/http";

/** A cached/serialized conversation body, per-viewer gated, `no-store`. */
function conversationJson(c: Context<AuthzEnv>, body: string): Response {
  return c.body(body, HttpStatuses.OK, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

export function createConversationHandlers(
  deps: AuthRouteDeps,
  github: InstallationGitHubPort,
  cache: TtlCache<string>,
) {
  const handle: AppDatabase = deps.handle;
  return {
    readConversation: async (c: Context<AuthzEnv>) => {
      const repoId = c.get("repoId");
      const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
      if (!parsedPr.success) {
        throw new BadRequest();
      }
      const ctx = await resolvePrScopeFrom(c, handle, parsedPr.data);
      const pr = await createTenantRepository(
        handle,
        ctx,
      ).pullRequests.getByNumber(repoId, parsedPr.data);
      if (pr === undefined) {
        throw new NotFound();
      }

      const key = buildConversationCacheKey(ctx, repoId, pr.prNumber);
      const now = Date.now();
      const cached = cache.get(key, now);
      if (cached !== undefined) {
        return conversationJson(c, cached);
      }

      // Fetch by the AUTHZ-VERIFIED full name (read posture, ≤60s staleness is
      // the same budget as the gate's own positive cache).
      const target = parseOwnerAndName(c.get("repoFullName"));
      if (target === undefined) {
        throw new NotFound();
      }
      // Installation rows fetch as the App (one rate budget, one cache
      // entry per PR); owner-world rows have no installation, so the
      // conversation reads with the VIEWER's own token instead.
      const ownerWorld = isOwnerContext(ctx);
      const conversation = {
        owner: target.owner,
        repo: target.repo,
        prNumber: pr.prNumber,
        entryCommentId: pr.entryCommentId,
      };

      let fetched: ReadConversationResult;
      if (ownerWorld) {
        const viewer = createReviewerGitHubClient(
          deps,
          c.get("session"),
          c.get("logger"),
          readFallbackTokenFor(c, deps),
        );
        fetched = await conversationController.readConversationAsViewer(
          { github: viewer },
          conversation,
        );
      } else {
        fetched = await conversationController.readConversation(
          { github },
          { installationId: ctx.installationId, ...conversation },
        );
      }

      if (!fetched.ok) {
        // Re-auth territory, same as every sibling viewer-token read: an
        // unreadable stored token or an upstream 401 prompts sign-in, never
        // a retry-looking 502 or a phantom 404. VIEWER path only, on the
        // App branch a 401 means the App's own credential failed, which
        // re-auth cannot fix, so it stays an honest upstream error.
        if (isTokenUnreadableFailure(fetched.error)) {
          throw new Unauthorized();
        }
        if (
          ownerWorld &&
          fetched.error.error.code === GitHubApiErrorCodes.UNAUTHORIZED
        ) {
          throw new Unauthorized();
        }
        // 404-collapse posture identical to the other reads; everything else is
        // an honest upstream error (no REST fallback tier).
        if (fetched.error.error.code === GitHubApiErrorCodes.NOT_FOUND) {
          throw new NotFound();
        }
        throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
      }
      cache.set(key, fetched.value, now + CONVERSATION_CACHE_TTL_MS, now);
      return conversationJson(c, fetched.value);
    },
  };
}
