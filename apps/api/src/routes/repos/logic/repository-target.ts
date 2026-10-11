import type { MiddlewareHandler } from "hono";
import type { AuthzEnv } from "../../../access/types";
import { stampAuditTarget } from "../../../product-operations/audit";

/**
 * Names the repository on the audit row ahead of the router's policy
 * checks, so a refusal there carries it as a success does.
 */
export function createRepositoryTargetLayer(): MiddlewareHandler<AuthzEnv> {
  return async (c, next) => {
    stampAuditTarget(c, "repository", c.get("repoId"));
    await next();
  };
}
