import type { Context } from "hono";
import type { InstallationId, RepoId } from "persistence";
import { NotFound } from "../../../shared-errors/api-error";
import { resolveGitHubDenialError } from "../../../shared-errors/github-denial";
import { DenialPostures } from "../../../shared-errors/github-denial/types";
import { readInstallationId } from "../../../access/installation-scope";
import type { AuthzEnv } from "../../../access/types";
import type { InstallationGitHubPort } from "../../github-port";
import type { TtlCache } from "../../ttl-cache";
import { collaboratorsController } from "./controller";
import { COLLABORATORS_CACHE_TTL_MS } from "./consts";
import { parseOwnerAndName } from "../utils";
import { HttpStatuses } from "types/http";

function cacheKey(installationId: InstallationId, repoId: RepoId): string {
  return `${String(installationId)}:${String(repoId)}`;
}

/** A cached/serialized roster body, per-viewer gated, `no-store`. */
function rosterJson(c: Context<AuthzEnv>, body: string): Response {
  return c.body(body, HttpStatuses.OK, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

/** The gated live-fetch, installation token, serialized bodies cached. */
export function createCollaboratorsHandlers(
  github: InstallationGitHubPort,
  cache: TtlCache<string>,
) {
  return {
    listCollaborators: async (c: Context<AuthzEnv>) => {
      // Push-required on the descriptor, so the router refuses a read-only
      // viewer before this repo-shared cache is reached.
      const installationId = readInstallationId(c.get("repoAccess"));
      const repoId = c.get("repoId");
      const key = cacheKey(installationId, repoId);
      const now = Date.now();
      const cached = cache.get(key, now);
      if (cached !== undefined) {
        return rosterJson(c, cached);
      }

      // Fetch by the AUTHZ-VERIFIED full name (read posture, ≤60s staleness is
      // the same budget as the gate's own positive cache).
      const target = parseOwnerAndName(c.get("repoFullName"));
      if (target === undefined) {
        throw new NotFound();
      }
      const fetched = await collaboratorsController.listCollaborators(
        { github },
        {
          installationId,
          owner: target.owner,
          repo: target.repo,
        },
      );
      if (!fetched.ok) {
        throw resolveGitHubDenialError(
          fetched.error.error,
          DenialPostures.APP_READ,
        );
      }
      const body = JSON.stringify(fetched.value);
      cache.set(key, body, now + COLLABORATORS_CACHE_TTL_MS, now);
      return rosterJson(c, body);
    },
  };
}
