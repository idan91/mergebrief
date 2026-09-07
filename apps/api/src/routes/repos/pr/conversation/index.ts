// The PR-conversation read: GET /conversation, fetched live from GitHub with
// the INSTALLATION token (the gate already proved the viewer's repo access; a
// shared token means one rate budget and ONE cache entry per PR — viewer
// tokens would fragment both). 60s positive TTL, `no-store`, nothing
// persisted. No REST fallback tier: a fetch failure is the section's error
// state.
//
// This module OWNS the conversation cache: the returned `evictConversation`
// hook is how every conversation write (review submit, the comments routes)
// drops the PR's entry on its success path.
import type { RepoId, ScopeContext } from "persistence";
import { ProductQueryIds } from "../../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WriteClassifications } from "../../../../product-operations/types";
import type { AuthRouteDeps } from "../../../auth/session";
import type { AuthzEnv } from "../../../authz";
import type { InstallationGitHubPort } from "../../../github-port";
import { createTtlCache } from "../../../ttl-cache";
import { CONVERSATION_CACHE_MAX_ENTRIES } from "./consts";
import createConversationHandlers from "./handler";
import { buildConversationCacheKey } from "./utils";

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
  evictConversation(ctx: ScopeContext, repoId: RepoId, prNumber: number): void;
}

/** Mount the conversation read behind the pr subtree's shared gate. */
export function conversationRoute(
  deps: ConversationRouteDeps,
): ConversationRoutes {
  const app = productRouter<AuthzEnv>();
  // Serialized response bodies, keyed installation:repo:pr (one entry per PR
  // shared across every viewer — the point of the installation-token read).
  const cache = createTtlCache<string>(CONVERSATION_CACHE_MAX_ENTRIES);

  const handlers = createConversationHandlers(deps, deps.github, cache);
  app.query(
    {
      id: ProductQueryIds.READ_CONVERSATION,
      classification: WriteClassifications.READ,
    },
    "/",
    handlers.readConversation,
  );

  return {
    router: app,
    evictConversation(ctx, repoId, prNumber) {
      cache.delete(buildConversationCacheKey(ctx, repoId, prNumber));
    },
  };
}
