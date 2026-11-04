import {
  ApiErrorCodes,
  type ListTokensResponse,
  type MintTokenResponse,
  type RevokeTokenResponse,
} from "contract";
import type { Context } from "hono";
import {
  BadRequest,
  NotFound,
  Unauthorized,
} from "../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../product-operations/audit";
import { API_TOKEN_PREFIX } from "../../../access/consts";
import {
  throwInstanceAccessFailure,
  type InstanceAccessCheck,
} from "../../../access/instance-access";
import { bindRequestGitHub } from "../../../access/reviewer-binding";
import type { AuthzEnv } from "../../../access/types";
import type { AuthRouteDeps } from "../session/types";
import { tokensController } from "./controller";
import { mintBodySchema } from "./schemas";
import { buildTokenView, parseTokenId } from "./utils";
import { HttpStatuses } from "types/http";

// Every response is per-viewer state → `no-store`, error paths included.
const NO_STORE = { "cache-control": "no-store" } as const;

export function createTokensHandlers(
  deps: AuthRouteDeps,
  instanceAccess: InstanceAccessCheck,
) {
  const mintToken = async (c: Context<AuthzEnv>) => {
    const raw: unknown = await c.req.json().catch(() => undefined);
    const parsed = mintBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequest();
    }
    const session = c.get("session");
    const log = c.get("logger");
    const allowed = await instanceAccess.check(
      bindRequestGitHub(deps, session, log),
    );
    if (!allowed.ok) {
      throwInstanceAccessFailure(allowed.error);
    }

    const minted = await tokensController.mintToken(
      { deps, session, log },
      {
        name: parsed.data.name,
        scope: parsed.data.scope,
        expiresInDays: parsed.data.expiresInDays,
        tokenPrefix: API_TOKEN_PREFIX,
      },
    );
    if (!minted.ok) {
      throw new Unauthorized(ApiErrorCodes.SIGNED_OUT);
    }
    const body: MintTokenResponse = {
      token: minted.value.token,
      apiToken: buildTokenView(minted.value.row),
    };
    return c.json(body, HttpStatuses.CREATED, NO_STORE);
  };

  const listTokens = async (c: Context<AuthzEnv>) => {
    const rows = await tokensController.listTokens({
      deps,
      session: c.get("session"),
      log: c.get("logger"),
    });
    const body: ListTokensResponse = { tokens: rows.map(buildTokenView) };
    return c.json(body, HttpStatuses.OK, NO_STORE);
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
    const body: RevokeTokenResponse = {
      apiToken: buildTokenView(result.value),
    };
    return c.json(body, HttpStatuses.OK, NO_STORE);
  };

  return { mintToken, listTokens, revokeToken };
}
