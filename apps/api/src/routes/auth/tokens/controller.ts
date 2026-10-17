// Hono-free. The minted token binds no installation and LINKS the session's
// grant, never copies credential material. The handler owns wire posture and
// audit stamps.
import { randomBytes } from "node:crypto";
import {
  createTokenAuth,
  type ApiTokenMetadataRow,
  type ApiTokenRowId,
  type TokenMintInput,
} from "persistence";
import type { Mutable, Result } from "types/utils";
import { sha256Hex } from "../session/utils";
import { DEFAULT_EXPIRY_DAYS, MS_PER_DAY, TOKEN_BYTES } from "./consts";
import type {
  MintInput,
  MintedToken,
  RevokeFailure,
  TokensControllerDeps,
} from "./types";

type RevokeResult = Result<ApiTokenMetadataRow, RevokeFailure>;

export const tokensController = {
  async mintToken(
    { deps, session }: TokensControllerDeps,
    input: MintInput,
  ): Promise<MintedToken> {
    const expiresAt =
      input.expiresInDays === null
        ? null
        : new Date(
            Date.now() +
              (input.expiresInDays ?? DEFAULT_EXPIRY_DAYS) * MS_PER_DAY,
          );

    // The opaque secret: prefix + 32 random bytes; stored only as SHA-256.
    const token = `${input.tokenPrefix}${randomBytes(TOKEN_BYTES).toString("base64url")}`;

    // LINK the session's grant, both channels share one physical pair,
    // rotated through the grant's serialized CAS. The mint audit is emitted
    // by persistence INSIDE this same transaction.
    const mint: Mutable<TokenMintInput> = {
      userId: session.reviewerId,
      name: input.name,
      scope: input.scope,
      tokenHash: sha256Hex(token),
      grantId: session.grantId,
      expiresAt,
    };

    if (session.reviewerLogin !== null) {
      mint.userLogin = session.reviewerLogin;
    }

    const row = await createTokenAuth(deps.handle).mintToken(mint);
    return { token, row };
  },

  async listTokens({ deps, session }: TokensControllerDeps) {
    return createTokenAuth(deps.handle).listForUser(session.reviewerId);
  },

  /** Owner-scoped soft revoke; repeat revocation is idempotent. */
  async revokeToken(
    { deps, session }: TokensControllerDeps,
    tokenId: ApiTokenRowId,
  ) {
    const revoked = await createTokenAuth(deps.handle).revokeToken(
      session.reviewerId,
      tokenId,
      new Date(),
    );
    if (revoked === undefined) {
      return {
        ok: false,
        error: { kind: "token-not-found" },
      } satisfies RevokeResult;
    }
    return { ok: true, value: revoked } satisfies RevokeResult;
  },
};
