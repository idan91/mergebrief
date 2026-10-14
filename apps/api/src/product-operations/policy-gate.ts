// The descriptor's policy, enforced at the router seam so a route added later
// is enforced whether or not its author thought about it. Generic over the
// Hono Env, so the variable bag arrives as `unknown` and is narrowed here;
// routes keep their own typed view of the same variables.
import { ApiErrorCodes } from "contract";
import type { Context, Env, MiddlewareHandler } from "hono";
import { AccessLevels, type AccessLevel } from "types/access-levels";
import { AuthChannels } from "../routes/auth/session/types";
import { Forbidden, NotFound, Unauthorized } from "../shared-errors/api-error";
import { isAccessLevel, scopeReaches, type OperationPolicy } from "./types";

declare module "hono" {
  interface ContextVariableMap {
    /**
     * Set by the subtree that loads a stored pull request; the gate
     * runs it after every other check and before the handler.
     */
    loadOperationRow?: () => Promise<void>;
  }
}

/** What the gate reads off the principal and the repo gate's access value. */
interface PolicyFacts {
  readonly scope: AccessLevel | undefined;
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

function readScope(session: unknown): AccessLevel | undefined {
  if (!hasKey(session, "scope")) {
    return undefined;
  }
  const scope: unknown = session.scope;
  if (!isAccessLevel(scope)) {
    return undefined;
  }
  return scope;
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
  if (policy.requiresPushAccess && !facts.viewerCanPush) {
    throw new NotFound();
  }
  if (policy.requiresInstallation && !facts.inInstallation) {
    throw new NotFound();
  }
}

async function loadRow(c: Context): Promise<void> {
  const load = c.get("loadOperationRow");
  if (load === undefined) {
    throw new Error(
      "an operation requiring a stored pull request is mounted without a row loader",
    );
  }
  await load();
}

/**
 * Scope, browser session, push access, Installation, then the stored pull
 * request: the first failure answers. Only actions need the scope check, since `read` is
 * the bottom rung. No principal where one is needed means a route mounted
 * without its gate, so it fails closed with 401.
 */
export function createPolicyGate<E extends Env>(
  policy: OperationPolicy,
  classification: AccessLevel,
): MiddlewareHandler<E> {
  const needsPrincipal =
    policy.browserSessionOnly || classification !== AccessLevels.READ;
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
    if (policy.browserSessionOnly && facts.channel !== AuthChannels.COOKIE) {
      throw new Forbidden(ApiErrorCodes.HUMAN_ONLY);
    }
    assertRepoPolicy(policy, facts);
    if (policy.requiresStoredPullRequest) {
      await loadRow(c);
    }
    await next();
    return undefined;
  };
}
