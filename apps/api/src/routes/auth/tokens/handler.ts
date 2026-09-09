import type { Context } from "hono";
import {
  BadGateway,
  BadRequest,
  Forbidden,
  NotFound,
  Unauthorized,
} from "../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../product-operations/audit";
import { API_TOKEN_PREFIX, type AuthzEnv } from "../../authz";
import type { AuthRouteDeps } from "../session";
import tokensController from "./controller";
import { mintBodySchema } from "./schemas";
import { buildTokenView, parseTokenId } from "./utils";
import { ApiErrorCodes } from "contract";

// Every response is per-viewer state → `no-store`, error paths included.
const NO_STORE = { "cache-control": "no-store" } as const;

export default function createHandlers(deps: AuthRouteDeps) {
  const mintToken = async (c: Context<AuthzEnv>) => {
    const raw: unknown = await c.req.json().catch(() => undefined);
    const parsed = mintBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequest();
    }
    const result = await tokensController.mintToken(
      { deps, session: c.get("session"), log: c.get("logger") },
      {
        name: parsed.data.name,
        scope: parsed.data.scope,
        installationId: parsed.data.installationId,
        expiresInDays: parsed.data.expiresInDays,
        tokenPrefix: API_TOKEN_PREFIX,
      },
    );
    if (!result.ok) {
      if (result.error.kind === "auth-dead") {
        throw new Unauthorized();
      }
      if (result.error.kind === "upstream-failed") {
        throw new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE);
      }
      // target-not-accessible → 403 with the denial audit named.
      stampAuditTarget(c, "api_token");
      throw new Forbidden();
    }
    return c.json(
      { token: result.value.token, apiToken: buildTokenView(result.value.row) },
      201,
      NO_STORE,
    );
  };

  const listTokens = async (c: Context<AuthzEnv>) => {
    const rows = await tokensController.listTokens({
      deps,
      session: c.get("session"),
      log: c.get("logger"),
    });
    return c.json({ tokens: rows.map(buildTokenView) }, 200, NO_STORE);
  };

  const revokeToken = async (c: Context<AuthzEnv>) => {
    const tokenId = parseTokenId(c.req.param("id"));
    if (tokenId === undefined) {
      // A foreign or unknown id is an indistinguishable 404.
      throw new NotFound();
    }
    const result = await tokensController.revokeToken(
      { deps, session: c.get("session"), log: c.get("logger") },
      tokenId,
    );
    if (!result.ok) {
      throw new NotFound();
    }
    stampAuditTarget(c, "api_token", tokenId);
    return c.json(
      { ok: true, apiToken: buildTokenView(result.value) },
      200,
      NO_STORE,
    );
  };

  return { mintToken, listTokens, revokeToken };
}
