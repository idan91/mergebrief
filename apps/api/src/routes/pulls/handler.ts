import type { Context } from "hono";
import {
  createArtifactStore,
  createGenerationProjection,
  createTenantRepository,
} from "persistence";
import {
  BadGateway,
  BadRequest,
  Unauthorized,
} from "../../shared-errors/api-error";
import type { AppDatabase } from "persistence";
import type { InstallationResolver } from "../installation-resolver";
import type { AuthzEnv } from "../authz";
import pullsController from "./controller";
import { runInBatches } from "../batches";
import { LIST_INSTALLATION_CONCURRENCY } from "./consts";
import {
  groupAllowedByInstallation,
  mergePullPages,
} from "./logic/merge-installations";
import { listQuerySchema } from "./schemas";
import { ApiErrorCodes } from "contract";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Parse, resolve the allowed set (judging its posture), one op per installation. */
export default function createHandlers(
  handle: AppDatabase,
  installations: InstallationResolver,
) {
  return {
    listPulls: async (c: Context<AuthzEnv>) => {
      const query = listQuerySchema.safeParse({
        limit: c.req.query("limit") ?? undefined,
      });
      if (!query.success) {
        throw new BadRequest();
      }
      const resolved = await installations.listAllowedRepos(
        c.get("session"),
        c.get("logger"),
      );
      if (!resolved.ok) {
        if (resolved.error.status === 401) {
          throw new Unauthorized();
        }
        throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
      }

      const viewerLogin = c.get("session").reviewerLogin;
      const groups = groupAllowedByInstallation(resolved.value.allowed);
      const pages = await runInBatches(
        [...groups],
        LIST_INSTALLATION_CONCURRENCY,
        async ([installationId, allowed]) => {
          const ctx = { installationId };
          const page = await pullsController.listPulls(
            {
              tenant: createTenantRepository(handle, ctx),
              artifacts: createArtifactStore(handle, ctx),
              generations: createGenerationProjection(handle, ctx),
            },
            { allowed, viewerLogin, limit: query.data.limit },
          );
          return page.pulls;
        },
      );
      const pulls = mergePullPages(pages, query.data.limit);
      return c.json({ pulls }, 200, NO_STORE);
    },
  };
}
