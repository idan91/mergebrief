// GET /api/repos/:repoId/mention-suggestions and /mention-targets: what
// GitHub offers a viewer who types `@`, and which mentions on a page name
// someone GitHub shows them. Both read on the viewer's own token, so no push
// gate: anyone who can open the repository sees what GitHub would show them.
import { MentionQueryKeys, ProductQueryIds } from "contract";
import type { Context, Handler } from "hono";
import { HttpStatuses } from "types/http";
import type { AuthzEnv } from "../../../access/types";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { BadRequest } from "../../../shared-errors/api-error";
import { createTtlCache, type TtlCache } from "../../ttl-cache";
import { MENTIONS_CACHE_MAX_ENTRIES } from "./consts";
import { throwMentionsFailure } from "./logic/wire-failures";
import { resolveMentionTargets } from "./resolve-mention-targets";
import { mentionQuerySchema, mentionTargetsSchema } from "./schemas";
import { searchMentionSuggestions } from "./search-mention-suggestions";
import type { MentionsDeps } from "./types";

const SERIALIZED_JSON = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

const REPO_LEVEL_POLICY = {
  browserSessionOnly: false,
  requiresOperator: false,
  requiresPushAccess: false,
  requiresInstallation: false,
  requiresStoredPullRequest: false,
} as const;

function buildMentionsDeps(
  c: Context<AuthzEnv>,
  cache: TtlCache<string>,
): MentionsDeps {
  const log = c.get("logger");
  return { cache, log };
}

function createSearchSuggestionsHandler(
  cache: TtlCache<string>,
): Handler<AuthzEnv> {
  return async (c) => {
    const query = mentionQuerySchema.safeParse(
      c.req.query(MentionQueryKeys.QUERY),
    );
    if (!query.success) {
      throw new BadRequest();
    }

    const deps = buildMentionsDeps(c, cache);
    const searched = await searchMentionSuggestions(
      deps,
      c.get("repoAccess"),
      query.data,
    );
    if (!searched.ok) {
      throwMentionsFailure(searched.error);
    }
    return c.body(searched.value, HttpStatuses.OK, SERIALIZED_JSON);
  };
}

function createResolveTargetsHandler(
  cache: TtlCache<string>,
): Handler<AuthzEnv> {
  return async (c) => {
    const targets = mentionTargetsSchema.safeParse(
      c.req.query(MentionQueryKeys.TARGETS),
    );
    if (!targets.success) {
      throw new BadRequest();
    }

    const deps = buildMentionsDeps(c, cache);
    const resolved = await resolveMentionTargets(
      deps,
      c.get("repoAccess"),
      targets.data,
    );
    if (!resolved.ok) {
      throwMentionsFailure(resolved.error);
    }
    return c.body(resolved.value, HttpStatuses.OK, SERIALIZED_JSON);
  };
}

export function mentionSuggestionsRoute(): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const cache = createTtlCache<string>(MENTIONS_CACHE_MAX_ENTRIES);
  app.query(
    { id: ProductQueryIds.SEARCH_MENTION_SUGGESTIONS, ...REPO_LEVEL_POLICY },
    "/",
    createSearchSuggestionsHandler(cache),
  );
  return app;
}

export function mentionTargetsRoute(): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const cache = createTtlCache<string>(MENTIONS_CACHE_MAX_ENTRIES);
  app.query(
    { id: ProductQueryIds.RESOLVE_MENTION_TARGETS, ...REPO_LEVEL_POLICY },
    "/",
    createResolveTargetsHandler(cache),
  );
  return app;
}
