// Hono-free. Mint validates its installation against the LIVE accessible set
// (shared resolver, never the caller's word); the minted token LINKS the
// session's grant, never copies credential material. The handler owns wire
// posture and audit stamps.
import { randomBytes } from "node:crypto";
import {
  createTokenAuth,
  TokenAuthErrorCodes,
  type ApiTokenMetadataRow,
  type ApiTokenRowId,
  type TokenMintInput,
} from "persistence";
import type { Mutable, Result } from "types/utils";
import { resolveAccessibleInstallations } from "../accessible-installations";
import { sha256Hex } from "../session/utils";
import { DEFAULT_EXPIRY_DAYS, MS_PER_DAY, TOKEN_BYTES } from "./consts";
import type {
  MintInput,
  RevokeFailure,
  TokensControllerDeps,
  TokensFailure,
} from "./types";

type MintResult = Result<
  { readonly token: string; readonly row: ApiTokenMetadataRow },
  TokensFailure
>;
type RevokeResult = Result<ApiTokenMetadataRow, RevokeFailure>;

export default {
  async mintToken(
    { deps, session, log }: TokensControllerDeps,
    input: MintInput,
  ) {
    // Validate the requested installation against the LIVE accessible set,
    // never the caller's word, never the session's current binding alone.
    const resolved = await resolveAccessibleInstallations(deps, session, log);
    if (!resolved.ok) {
      return resolved;
    }
    const { installations, session: currentSession } = resolved.value;
    const target = installations.find(
      (installation) =>
        String(installation.installationId) === String(input.installationId),
    );
    if (target === undefined) {
      return {
        ok: false,
        error: { kind: "target-not-accessible" },
      } satisfies MintResult;
    }

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
      installationId: target.installationId,
      userId: currentSession.reviewerId,
      name: input.name,
      scope: input.scope,
      tokenHash: sha256Hex(token),
      grantId: currentSession.grantId,
      expiresAt,
    };

    if (currentSession.reviewerLogin !== null) {
      mint.userLogin = currentSession.reviewerLogin;
    }

    const row = await createTokenAuth(deps.handle).mintToken(mint);
    return { ok: true, value: { token, row } } satisfies MintResult;
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
    if (!revoked.ok) {
      // NOT_FOUND is the only expected arm on this path.
      if (revoked.error.code !== TokenAuthErrorCodes.NOT_FOUND) {
        throw new Error(`unexpected revoke failure: ${revoked.error.code}`);
      }
      return {
        ok: false,
        error: { kind: "token-not-found" },
      } satisfies RevokeResult;
    }
    return { ok: true, value: revoked.value } satisfies RevokeResult;
  },
};
