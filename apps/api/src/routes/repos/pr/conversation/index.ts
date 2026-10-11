// GET /api/repos/:repoId/pulls/:prNumber/conversation, fetched live from
// GitHub: 60s positive TTL, `no-store`, nothing persisted, no REST fallback
// tier. This module OWNS the conversation cache: the returned
// `evictConversation` hook is how every conversation write drops the PR's
// entry on success.
import { ProductQueryIds } from "contract";
import type { Handler } from "hono";
import {
  WriteClassifications,
  type RepoId,
  type ScopeContext,
} from "persistence";
import { HttpStatuses } from "types/http";
import type {
  InstallationBindingDeps,
  PullRequestEnv,
} from "../../../../access/types";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { createTtlCache } from "../../../ttl-cache";
import { CONVERSATION_CACHE_MAX_ENTRIES } from "./consts";
import { throwReadConversationFailure } from "./logic/wire-failures";
import { readConversation } from "./read-conversation";
import type { ConversationDeps } from "./types";
import { buildConversationCacheKey } from "./utils";

const SERIALIZED_JSON = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

export interface ConversationRoutes {
  readonly router: ProductRouter<PullRequestEnv>;
  /**
   * Drop the PR's cached conversation. EVERY conversation write calls this,
   * the comments routes and the review-submit route's success paths, so a
   * post-write refetch reflects the write inside the 60s TTL.
   */
  evictConversation(ctx: ScopeContext, repoId: RepoId, prNumber: number): void;
}

function createReadConversationHandler(
  deps: ConversationDeps,
): Handler<PullRequestEnv> {
  return async (c) => {
    const read = await readConversation(deps, c.get("pullRequestAccess"));
    if (!read.ok) {
      throwReadConversationFailure(read.error);
    }

    return c.body(read.value, HttpStatuses.OK, SERIALIZED_JSON);
  };
}

export function conversationRoute(
  deps: InstallationBindingDeps,
): ConversationRoutes {
  const app = productRouter<PullRequestEnv>();
  const cache = createTtlCache<string>(CONVERSATION_CACHE_MAX_ENTRIES);
  const bindInstallationGitHub = deps.bindInstallationGitHub;
  app.query(
    {
      id: ProductQueryIds.READ_CONVERSATION,
      classification: WriteClassifications.READ,
      humanOnly: false,
      pushRequired: false,
      installationOnly: false,
      rowRequired: true,
    },
    "/",
    createReadConversationHandler({ bindInstallationGitHub, cache }),
  );

  return {
    router: app,
    evictConversation(ctx, repoId, prNumber) {
      cache.delete(buildConversationCacheKey(ctx, repoId, prNumber));
    },
  };
}
