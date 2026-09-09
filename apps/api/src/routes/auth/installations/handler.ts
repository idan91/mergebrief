import type { Context } from "hono";
import { createSessionAuth, createUserSettingsStore } from "persistence";
import {
  BadGateway,
  BadRequest,
  Forbidden,
  Unauthorized,
} from "../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../product-operations/audit";
import type { AuthzEnv } from "../../authz";
import type { AuthRouteDeps } from "../session";
import installationsController from "./controller";
import { switchBodySchema } from "./schemas";
import type { InstallationsFailure } from "./types";
import { toInstallationId } from "./utils";
import { ApiErrorCodes } from "contract";

const NO_STORE = { "cache-control": "no-store" } as const;

function throwInstallationsFailure(failure: InstallationsFailure): never {
  if (failure.kind === "upstream-failed") {
    throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
  }
  if (failure.kind === "target-not-accessible") {
    // 403 + the denial audit; the choke point writes the row.
    throw new Forbidden();
  }
  // auth-dead / session-vanished → re-login.
  throw new Unauthorized();
}

export default function createHandlers(deps: AuthRouteDeps) {
  const listInstallations = async (c: Context<AuthzEnv>) => {
    const result = await installationsController.listInstallations({
      deps,
      session: c.get("session"),
      log: c.get("logger"),
      sessions: createSessionAuth(deps.handle),
      settings: createUserSettingsStore(deps.handle),
    });
    if (!result.ok) {
      throwInstallationsFailure(result.error);
    }
    return c.json(result.value, 200, NO_STORE);
  };

  const selectInstallation = async (c: Context<AuthzEnv>) => {
    const raw: unknown = await c.req.json().catch(() => undefined);
    const parsed = switchBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequest();
    }
    const target = toInstallationId(parsed.data.installationId);
    if (target === undefined) {
      throw new BadRequest();
    }
    // The audit row is written at the choke point under the credential's
    // tenant, the one that authorized the switch, not the one it lands on.
    stampAuditTarget(c, "installation", target);

    const result = await installationsController.selectInstallation(
      {
        deps,
        session: c.get("session"),
        log: c.get("logger"),
        sessions: createSessionAuth(deps.handle),
        settings: createUserSettingsStore(deps.handle),
      },
      { target, setDefault: parsed.data.setDefault === true },
    );
    if (!result.ok) {
      throwInstallationsFailure(result.error);
    }
    return c.json(result.value, 200, NO_STORE);
  };

  return { listInstallations, selectInstallation };
}
