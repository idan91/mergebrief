import {
  WriteClassifications,
  type SessionWithGrant,
  type TokenWithGrant,
} from "persistence";
import { AuthChannels, type ViewerPrincipal } from "../types";

/** Shape a resolved cookie session (+ its grant) into the principal. */
export function derivePrincipalFromSession(
  resolved: SessionWithGrant,
): ViewerPrincipal {
  return {
    ...resolved.session,
    ghTokenCiphertext: resolved.grant.ghTokenCiphertext,
    keyRef: resolved.grant.keyRef,
    // A cookie has no row to hold a limit and the person is at the keyboard:
    // the browser is unlimited by construction, not by a stored value.
    scope: WriteClassifications.EXTERNAL_WRITE,
    channel: AuthChannels.COOKIE,
  };
}

/**
 * Sentinel expiry for a no-expiry token's synthesized principal. The gate's
 * expiry decision already happened inside `createTokenAuth.resolveByHash`;
 * nothing downstream reads `expiresAt`, this only satisfies the row shape.
 */
const NO_EXPIRY_SENTINEL = new Date(8_640_000_000_000_000);

/** Shape a resolved `api_token` (+ its grant) into the channel-agnostic principal. */
export function derivePrincipalFromApiToken({
  token,
  grant,
}: TokenWithGrant): ViewerPrincipal {
  return {
    id: token.id,
    installationId: token.installationId,
    sessionTokenHash: token.tokenHash,
    reviewerId: token.userId,
    reviewerLogin: token.userLogin,
    grantId: token.grantId,
    ghTokenCiphertext: grant.ghTokenCiphertext,
    keyRef: grant.keyRef,
    expiresAt: token.expiresAt ?? NO_EXPIRY_SENTINEL,
    createdAt: token.createdAt,
    scope: token.scope,
    channel: AuthChannels.BEARER,
  };
}
