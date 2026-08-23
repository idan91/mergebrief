import type { Context } from "hono";
import { GitHubApiErrorCode } from "github";
import type { InstallationId, RepoId } from "persistence";
import { ApiErrorCode } from "../../../error-response";
import { BadGateway, NotFound } from "../../../shared-errors/api-error";
import type { AuthzEnv } from "../../authz";
import type { InstallationGitHubPort } from "../../github-port";
import type { TtlCache } from "../../ttl-cache";
import collaboratorsController from "./controller";
import { COLLABORATORS_CACHE_TTL_MS } from "./consts";
import { parseOwnerAndName } from "../utils";

function cacheKey(installationId: InstallationId, repoId: RepoId): string {
  return `${String(installationId)}:${String(repoId)}`;
}

/** A cached/serialized roster body, per-viewer gated — `no-store`. */
function rosterJson(c: Context<AuthzEnv>, body: string): Response {
  return c.body(body, 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

/** The gated live-fetch — installation token, serialized bodies cached. */
export default function createHandlers(
  github: InstallationGitHubPort,
  cache: TtlCache<string>,
) {
  return {
    listCollaborators: async (c: Context<AuthzEnv>) => {
      // Push-gate BEFORE the cache: the cached roster is repo-shared, and a
      // read-only viewer must not be able to read it out of the cache either.
      if (!c.get("viewerCanPush")) {
        throw new NotFound(ApiErrorCode.NOT_FOUND);
      }

      const ctx = c.get("ctx");
      const repoId = c.get("repoId");
      const key = cacheKey(ctx.installationId, repoId);
      const now = Date.now();
      const cached = cache.get(key, now);
      if (cached !== undefined) {
        return rosterJson(c, cached);
      }

      // Fetch by the AUTHZ-VERIFIED full name (read posture — ≤60s staleness is
      // the same budget as the gate's own positive cache).
      const target = parseOwnerAndName(c.get("repoFullName"));
      if (target === undefined) {
        throw new NotFound(ApiErrorCode.NOT_FOUND);
      }
      const fetched = await collaboratorsController.listCollaborators(
        { github },
        {
          installationId: ctx.installationId,
          owner: target.owner,
          repo: target.repo,
        },
      );
      if (!fetched.ok) {
        // 404-collapse posture identical to the other reads; everything else is
        // an honest upstream error.
        if (fetched.error.error.code === GitHubApiErrorCode.NOT_FOUND) {
          throw new NotFound(ApiErrorCode.NOT_FOUND);
        }
        throw new BadGateway(ApiErrorCode.GITHUB_UNAVAILABLE);
      }
      const body = JSON.stringify(fetched.value);
      cache.set(key, body, now + COLLABORATORS_CACHE_TTL_MS, now);
      return rosterJson(c, body);
    },
  };
}
