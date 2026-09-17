import { parsePrUrl, type PrLocator } from "brief-core";
import type { Context } from "hono";
import { ApiErrorCodes } from "contract";
import {
  BadGateway,
  BadRequest,
  NotFound,
  Unauthorized,
} from "../../shared-errors/api-error";
import { stampAuditTarget } from "../../product-operations/audit";
import { createReviewerGitHubClient } from "../auth/reviewer-github-client";
import type { AuthRouteDeps } from "../auth/session/types";
import type { AuthzEnv } from "../authz";
import generateController from "./controller";
import { bodySchema } from "./schemas";
import type { GenerateFailure } from "./types";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Failure → posture. NOT_FOUND covers FORBIDDEN too (uniform 404). */
function throwGenerateFailure(failure: GenerateFailure): never {
  if (failure.kind === "token-unreadable" || failure.kind === "unauthorized") {
    throw new Unauthorized();
  }
  if (failure.kind === "not-found") {
    throw new NotFound();
  }
  throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
}

export default function createHandlers(
  deps: AuthRouteDeps,
  fallbackToken: string | undefined,
) {
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
      return c.json({ repoId, prNumber }, 200, NO_STORE);
    },
  };
}
