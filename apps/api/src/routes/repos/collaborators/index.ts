// GET /api/repos/:repoId/collaborators, the @mention autocomplete pool,
// fetched live from GitHub on the App's credential: one rate budget and one
// cache entry per repo. 60s positive TTL, `no-store`, nothing persisted.
//
// GUARD, push-required: GitHub denies the roster to viewers without push
// access, so serving it on the App's credential would leak logins and names
// to any read-access viewer. A non-push viewer gets the router's 404 first.
import { ProductQueryIds } from "contract";
import type { Handler } from "hono";
import { HttpStatuses } from "types/http";
import type { AuthzEnv, InstallationBindingDeps } from "../../../access/types";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { createTtlCache } from "../../ttl-cache";
import { COLLABORATORS_CACHE_MAX_ENTRIES } from "./consts";
import { listCollaborators } from "./list-collaborators";
import { throwListCollaboratorsFailure } from "./logic/wire-failures";
import type { CollaboratorsDeps } from "./types";

const SERIALIZED_JSON = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

function createListCollaboratorsHandler(
  deps: CollaboratorsDeps,
): Handler<AuthzEnv> {
  return async (c) => {
    const listed = await listCollaborators(deps, c.get("repoAccess"));
    if (!listed.ok) {
      throwListCollaboratorsFailure(listed.error);
    }

    return c.body(listed.value, HttpStatuses.OK, SERIALIZED_JSON);
  };
}

export function collaboratorsRoute(
  deps: InstallationBindingDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const cache = createTtlCache<string>(COLLABORATORS_CACHE_MAX_ENTRIES);
  const bindInstallationGitHub = deps.bindInstallationGitHub;
  app.query(
    {
      id: ProductQueryIds.LIST_COLLABORATORS,
      browserSessionOnly: false,
      requiresPushAccess: true,
      requiresInstallation: true,
      requiresStoredPullRequest: false,
    },
    "/",
    createListCollaboratorsHandler({ bindInstallationGitHub, cache }),
  );
  return app;
}
