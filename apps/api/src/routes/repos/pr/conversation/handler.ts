import type { Context } from "hono";
import {
  createTenantRepository,
  isOwnerContext,
  type AppDatabase,
} from "persistence";
import { BadRequest, NotFound } from "../../../../shared-errors/api-error";
import {
  resolveGitHubDenialError,
  unwrapGitHubFailure,
} from "../../../../shared-errors/github-denial";
import { DenialPostures } from "../../../../shared-errors/github-denial/types";
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
        const posture = ownerWorld
          ? DenialPostures.COLLAPSE
          : DenialPostures.APP_READ;
        throw resolveGitHubDenialError(
          unwrapGitHubFailure(fetched.error),
          posture,
        );
      }
      cache.set(key, fetched.value, now + CONVERSATION_CACHE_TTL_MS, now);
      return conversationJson(c, fetched.value);
    },
  };
}
