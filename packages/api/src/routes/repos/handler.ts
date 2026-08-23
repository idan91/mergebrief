import type { Context } from "hono";
import { BadGateway, Unauthorized } from "../../shared-errors/api-error";
import type { AllowedRepoResolver } from "../allowed-repos";
import type { AuthzEnv } from "../authz";
import reposController from "./controller";
import { ApiErrorCodes } from "../../error-response";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Resolve the allowed set (judging its posture) and render the flat list. */
export default function createHandlers(allowedRepos: AllowedRepoResolver) {
  return {
    listRepos: async (c: Context<AuthzEnv>) => {
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
      const body = reposController.listRepos(resolved.value.allowed);
      return c.json(body, 200, NO_STORE);
    },
  };
}
