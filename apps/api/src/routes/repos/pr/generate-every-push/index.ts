// POST /api/repos/:repoId/pulls/:prNumber/generate-every-push/on and /off:
// the per-PR switch that skips trigger conditions for every push. A person's
// choice from a signed-in browser, for a viewer who can push to an
// installation's repository.
import { ProductActionIds } from "contract";
import type { Handler } from "hono";
import { HttpStatuses } from "types/http";
import {
  throwInstanceAccessFailure,
  type InstanceAccessCheck,
} from "../../../../access/instance-access";
import type { PullRequestEnv } from "../../../../access/types";
import { stampAuditTarget } from "../../../../product-operations/audit";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { NotFound } from "../../../../shared-errors/api-error";
import type { AuthRouteDeps } from "../../../auth/session/types";
import {
  turnOffGenerateEveryPush,
  turnOnGenerateEveryPush,
} from "./generate-every-push";
import { throwTurnOnEveryPushFailure } from "./logic/wire-failures";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Turning it on may release a held head into a paid run, so the instance's access rules apply. */
function createTurnOnHandler(
  deps: AuthRouteDeps,
  instanceAccess: InstanceAccessCheck,
): Handler<PullRequestEnv> {
  return async (c) => {
    const access = c.get("pullRequestAccess");
    const allowed = await instanceAccess.check(access);
    if (!allowed.ok) {
      throwInstanceAccessFailure(allowed.error);
    }

    const turnedOn = await turnOnGenerateEveryPush(deps.handle, access);
    if (!turnedOn.ok) {
      throwTurnOnEveryPushFailure(turnedOn.error, access.footing);
    }

    stampAuditTarget(c, "pull_request", turnedOn.value);
    return c.body(null, HttpStatuses.NO_CONTENT, NO_STORE);
  };
}

function createTurnOffHandler(deps: AuthRouteDeps): Handler<PullRequestEnv> {
  return async (c) => {
    const turnedOff = await turnOffGenerateEveryPush(
      deps.handle,
      c.get("pullRequestAccess"),
    );
    if (!turnedOff.ok) {
      throw new NotFound();
    }

    stampAuditTarget(c, "pull_request", turnedOff.value);
    return c.body(null, HttpStatuses.NO_CONTENT, NO_STORE);
  };
}

export function generateEveryPushRoutes(
  deps: AuthRouteDeps,
  instanceAccess: InstanceAccessCheck,
): ProductRouter<PullRequestEnv> {
  const app = productRouter<PullRequestEnv>();
  app.action(
    {
      id: ProductActionIds.TURN_ON_GENERATE_EVERY_PUSH,
      browserSessionOnly: true,
      requiresOperator: false,
      requiresPushAccess: true,
      requiresInstallation: true,
      requiresStoredPullRequest: true,
    },
    "/on",
    createTurnOnHandler(deps, instanceAccess),
  );
  app.action(
    {
      id: ProductActionIds.TURN_OFF_GENERATE_EVERY_PUSH,
      browserSessionOnly: true,
      requiresOperator: false,
      requiresPushAccess: true,
      requiresInstallation: true,
      requiresStoredPullRequest: true,
    },
    "/off",
    createTurnOffHandler(deps),
  );
  return app;
}
