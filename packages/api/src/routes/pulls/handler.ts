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
import type { AllowedRepoResolver } from "../allowed-repos";
import type { AuthzEnv } from "../authz";
import pullsController from "./controller";
import { listQuerySchema } from "./schemas";
import { ApiErrorCodes } from "../../error-response";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Parse, resolve the allowed set (judging its posture), call the op. */
export default function createHandlers(
  handle: AppDatabase,
  allowedRepos: AllowedRepoResolver,
) {
  return {
    listPulls: async (c: Context<AuthzEnv>) => {
      const query = listQuerySchema.safeParse({
        limit: c.req.query("limit") ?? undefined,
      });
      if (!query.success) {
        throw new BadRequest();
      }
      const ctx = c.get("ctx");

      const resolved = await allowedRepos.resolve(
        c.get("session"),
        c.get("logger"),
      );
      if (!resolved.ok) {
        if (resolved.error.status === 401) {
          throw new Unauthorized();
        }
        throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
      }

      const body = await pullsController.listPulls(
        {
          tenant: createTenantRepository(handle, ctx),
          artifacts: createArtifactStore(handle, ctx),
          generations: createGenerationProjection(handle, ctx),
        },
        {
          allowed: resolved.value.allowed,
          viewerLogin: c.get("session").reviewerLogin,
          limit: query.data.limit,
        },
      );
      return c.json(body, 200, NO_STORE);
    },
  };
}
