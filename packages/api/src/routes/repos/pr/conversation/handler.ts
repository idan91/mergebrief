import type { Context } from "hono";
import { GitHubApiErrorCode } from "github";
import { createTenantRepository, type AppDatabase } from "persistence";
import { ApiErrorCode } from "../../../../error-response";
import {
  BadGateway,
  BadRequest,
  NotFound,
} from "../../../../shared-errors/api-error";
import type { AuthzEnv } from "../../../authz";
import type { InstallationGitHubPort } from "../../../github-port";
import type { TtlCache } from "../../../ttl-cache";
import { parseOwnerAndName } from "../../utils";
import { prNumberSchema } from "../wire-bounds";
import conversationController from "./controller";
import { CONVERSATION_CACHE_TTL_MS } from "./consts";
import { buildConversationCacheKey } from "./utils";

/** A cached/serialized conversation body, per-viewer gated — `no-store`. */
function conversationJson(c: Context<AuthzEnv>, body: string): Response {
  return c.body(body, 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

export default function createHandlers(
  handle: AppDatabase,
  github: InstallationGitHubPort,
  cache: TtlCache<string>,
) {
  return {
    readConversation: async (c: Context<AuthzEnv>) => {
      const ctx = c.get("ctx");
      const repoId = c.get("repoId");
      const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
      if (!parsedPr.success) {
        throw new BadRequest(ApiErrorCode.INVALID_REQUEST);
      }
      const pr = await createTenantRepository(
        handle,
        ctx,
      ).pullRequests.getByNumber(repoId, parsedPr.data);
      if (pr === undefined) {
        throw new NotFound(ApiErrorCode.NOT_FOUND);
      }

      const key = buildConversationCacheKey(
        ctx.installationId,
        repoId,
        pr.prNumber,
      );
      const now = Date.now();
      const cached = cache.get(key, now);
      if (cached !== undefined) {
        return conversationJson(c, cached);
      }

      // Fetch by the AUTHZ-VERIFIED full name (read posture — ≤60s staleness is
      // the same budget as the gate's own positive cache).
      const target = parseOwnerAndName(c.get("repoFullName"));
      if (target === undefined) {
        throw new NotFound(ApiErrorCode.NOT_FOUND);
      }
      const fetched = await conversationController.readConversation(
        { github },
        {
          installationId: ctx.installationId,
          owner: target.owner,
          repo: target.repo,
          prNumber: pr.prNumber,
          entryCommentId: pr.entryCommentId,
        },
      );
      if (!fetched.ok) {
        // 404-collapse posture identical to the other reads; everything else is
        // an honest upstream error (no REST fallback tier).
        if (fetched.error.error.code === GitHubApiErrorCode.NOT_FOUND) {
          throw new NotFound(ApiErrorCode.NOT_FOUND);
        }
        throw new BadGateway(ApiErrorCode.GITHUB_UNAVAILABLE);
      }
      cache.set(key, fetched.value, now + CONVERSATION_CACHE_TTL_MS, now);
      return conversationJson(c, fetched.value);
    },
  };
}
