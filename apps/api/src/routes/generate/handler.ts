import { parsePrUrl, type PrLocator } from "brief-core/pr-url";
import type { Context } from "hono";
import { ApiErrorCodes } from "contract";
import { BadRequest } from "../../shared-errors/api-error";
import { stampAuditTarget } from "../../product-operations/audit";
import { createReviewerGitHubClient } from "../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../auth/session/types";
import { resolveOperatorTokenFor } from "../../access/operator-token";
import type { AuthzEnv } from "../../access/types";
import { generateController } from "./controller";
import { throwGenerateFailure } from "./logic/wire-failures";
import { bodySchema } from "./schemas";
import { HttpStatuses } from "types/http";

const NO_STORE = { "cache-control": "no-store" } as const;

export function createGenerateHandlers(deps: AuthRouteDeps) {
  return {
    generateBrief: async (c: Context<AuthzEnv>) => {
      const body = bodySchema.safeParse(
        await c.req.json().catch(() => undefined),
      );
      if (!body.success) {
        throw new BadRequest();
      }
      let locator: PrLocator;
      try {
        locator = parsePrUrl(body.data.url);
      } catch {
        throw new BadRequest(ApiErrorCodes.NOT_A_PR_URL);
      }

      const github = createReviewerGitHubClient(
        deps,
        c.get("session"),
        c.get("logger"),
      );
      const log = c.get("logger");
      const fallbackToken = resolveOperatorTokenFor(
        deps,
        c.get("session").reviewerId,
      );
      const controllerDeps =
        fallbackToken === undefined
          ? { handle: deps.handle, github, log }
          : { handle: deps.handle, github, fallbackToken, log };
      const result = await generateController.generateBrief(controllerDeps, {
        locator,
      });
      if (!result.ok) {
        throwGenerateFailure(result.error);
      }
      stampAuditTarget(c, "pull_request", result.value.pullRequestId);
      const { repoId, prNumber } = result.value;
      return c.json({ repoId, prNumber }, HttpStatuses.OK, NO_STORE);
    },
  };
}
