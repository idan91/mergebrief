// The descriptor's policy, enforced at the router seam so a route added later
// is enforced whether or not its author thought about it. Generic over the
// Hono Env, so the variable bag arrives as `unknown` and is narrowed here;
// routes keep their own typed view of the same variables.
import { ApiErrorCodes } from "contract";
import type { Context, Env, MiddlewareHandler } from "hono";
import { WriteClassifications, type WriteClassification } from "persistence";
import { AuthChannels } from "../routes/auth/session/types";
import { Forbidden, NotFound, Unauthorized } from "../shared-errors/api-error";
import {
  isWriteClassification,
  scopeReaches,
  type OperationPolicy,
} from "./types";

declare module "hono" {
  interface ContextVariableMap {
    /**
     * Set by the subtree that owns a row-required operation's row; the gate
     * runs it after every other check and before the handler.
     */
    loadOperationRow?: () => Promise<void>;
  }
}

/** What the gate reads off the principal and the repo gate's access value. */
interface PolicyFacts {
  readonly scope: WriteClassification | undefined;
  readonly channel: unknown;
  readonly viewerCanPush: boolean;
  readonly inInstallation: boolean;
}

function hasKey<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

function readScope(session: unknown): WriteClassification | undefined {
  if (!hasKey(session, "scope")) {
    return undefined;
  }
  const scope: unknown = session.scope;
  return isWriteClassification(scope) ? scope : undefined;
}

function readPolicyFacts(variables: unknown): PolicyFacts {
  const session = hasKey(variables, "session") ? variables.session : undefined;
  const access = hasKey(variables, "repoAccess")
    ? variables.repoAccess
    : undefined;
  const installation = hasKey(access, "installation")
    ? access.installation
    : undefined;
  return {
    scope: readScope(session),
    channel: hasKey(session, "channel") ? session.channel : undefined,
    viewerCanPush:
      hasKey(access, "viewerCanPush") && access.viewerCanPush === true,
    inInstallation:
      hasKey(installation, "kind") && installation.kind === "installation",
  };
}

/**
 * The repo-bound checks. No access value means a route mounted without the
 * repo gate, so both fail closed as the absence they would have found.
 */
function assertRepoPolicy(policy: OperationPolicy, facts: PolicyFacts): void {
  if (policy.pushRequired && !facts.viewerCanPush) {
    throw new NotFound();
  }
  if (policy.installationOnly && !facts.inInstallation) {
    throw new NotFound();
  }
}

async function loadRow(c: Context): Promise<void> {
  const load = c.get("loadOperationRow");
  if (load === undefined) {
    throw new Error("a row-required operation is mounted without a row loader");
  }
  await load();
}

/**
 * Scope, human-only, push-required, installation-only, then the row: the
 * first failure answers. Only actions need the scope check, since `read` is
 * the bottom rung. No principal where one is needed means a route mounted
 * without its gate, so it fails closed with 401.
 */
export function createPolicyGate<E extends Env>(
  policy: OperationPolicy,
  classification: WriteClassification,
): MiddlewareHandler<E> {
  const needsPrincipal =
    policy.humanOnly || classification !== WriteClassifications.READ;
  return async (c, next) => {
    const facts = readPolicyFacts(c.var);
    if (needsPrincipal && facts.scope === undefined) {
      throw new Unauthorized();
    }
    if (
      facts.scope !== undefined &&
      !scopeReaches(facts.scope, classification)
    ) {
      throw new Forbidden(ApiErrorCodes.SCOPE_EXCEEDED);
    }
    if (policy.humanOnly && facts.channel !== AuthChannels.COOKIE) {
      throw new Forbidden(ApiErrorCodes.HUMAN_ONLY);
    }
    assertRepoPolicy(policy, facts);
    if (policy.rowRequired) {
      await loadRow(c);
    }
    await next();
    return undefined;
  };
}
