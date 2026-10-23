import { encryptToken, type KeyProvider } from "../auth/crypto";
import { createGrantAuth, type GithubGrantRow } from "../auth/grant";
import type { AppDatabase } from "../db/handle";
import type { ReviewerId } from "../types";

const DEFAULT_REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface SeedGrantInput {
  readonly userId: ReviewerId;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly keyProvider: KeyProvider;
  readonly keyRef: string;
  /** Defaults to thirty days from now. */
  readonly refreshExpiresAt?: Date;
}

/** Seal the pair under `keyRef` and insert the grant, as a sign-in does. */
export async function seedGrant(
  handle: AppDatabase,
  input: SeedGrantInput,
): Promise<GithubGrantRow> {
  const sealedAccess = await encryptToken(
    input.keyProvider,
    input.keyRef,
    input.accessToken,
  );
  const sealedRefresh = await encryptToken(
    input.keyProvider,
    input.keyRef,
    input.refreshToken,
  );
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    throw new Error("seed grant could not seal the token pair");
  }

  return createGrantAuth(handle).createGrant({
    userId: input.userId,
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: input.keyRef,
    refreshExpiresAt:
      input.refreshExpiresAt ??
      new Date(Date.now() + DEFAULT_REFRESH_LIFETIME_MS),
  });
}
