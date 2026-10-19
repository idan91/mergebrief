// POST /api/generate, turn an arbitrary PR URL into an owner-scoped
// (url-box) brief. Session-gated only (`sessionLayer`, no per-repo gate): the
// target repo comes from the pasted URL, not from an installation, the
// viewer-token GitHub resolve inside the operation IS the access check. Its
// denial posture is a uniform 404: FORBIDDEN and NOT_FOUND are
// indistinguishable to the caller (no existence leak), mirroring the
// cold-denial posture of the gated routes. Generation itself runs in the
// worker, so the answer is a 202 carrying the PR coordinates the web polls.
import { parsePrUrl, type PrLocator } from "brief-core/pr-url";
import {
  ApiErrorCodes,
  ProductActionIds,
  type GenerateBriefResponse,
} from "contract";
import type { Handler } from "hono";
import { HttpStatuses } from "types/http";
import { bindOperatorReader } from "../../access/operator-token";
import { bindRequestGitHub } from "../../access/reviewer-binding";
import { accessStampLayer, sessionLayer } from "../../access/session-layer";
import type { AuthzEnv } from "../../access/types";
import { stampAuditTarget } from "../../product-operations/audit";
import {
  productRouter,
  type ProductRouter,
} from "../../product-operations/product-router";
import { BadRequest } from "../../shared-errors/api-error";
import type { AuthRouteDeps } from "../auth/session/types";
import { generateBrief } from "./generate-brief";
import { throwGenerateFailure } from "./logic/wire-failures";
import { bodySchema } from "./schemas";

const NO_STORE = { "cache-control": "no-store" } as const;

function parseLocator(url: string): PrLocator {
  try {
    return parsePrUrl(url);
  } catch {
    throw new BadRequest(ApiErrorCodes.NOT_A_PR_URL);
  }
}

function createGenerateBriefHandler(deps: AuthRouteDeps): Handler<AuthzEnv> {
  return async (c) => {
    const body = bodySchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!body.success) {
      throw new BadRequest();
    }
    const locator = parseLocator(body.data.url);

    const log = c.get("logger");
    const session = c.get("session");
    const request = bindRequestGitHub(deps, session, log);
    const operator = bindOperatorReader(deps, session.reviewerId);
    const generated = await generateBrief(
      { handle: deps.handle, operator, log },
      request,
      locator,
    );
    if (!generated.ok) {
      throwGenerateFailure(generated.error);
    }

    stampAuditTarget(c, "pull_request", generated.value.pullRequestId);
    const { repoId, prNumber } = generated.value;
    const accepted: GenerateBriefResponse = { repoId, prNumber };
    return c.json(accepted, HttpStatuses.ACCEPTED, NO_STORE);
  };
}

export function generateRoute(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  app.use("/", sessionLayer(deps), accessStampLayer());
  app.action(
    {
      id: ProductActionIds.GENERATE_BRIEF,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: false,
    },
    "/",
    createGenerateBriefHandler(deps),
  );
  return app;
}
