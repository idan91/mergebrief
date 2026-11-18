import type { KeyProvider } from "../auth/crypto";
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

/** Insert the grant with its pair sealed under `keyRef`, as a sign-in does. */
export async function seedGrant(
  handle: AppDatabase,
  input: SeedGrantInput,
): Promise<GithubGrantRow> {
  const created = await createGrantAuth(handle).createGrant({
    userId: input.userId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    keyProvider: input.keyProvider,
    keyRef: input.keyRef,
    refreshExpiresAt:
      input.refreshExpiresAt ??
      new Date(Date.now() + DEFAULT_REFRESH_LIFETIME_MS),
  });
  if (!created.ok) {
    throw new Error(
      `seed grant could not seal the token pair: ${created.error.code}`,
    );
  }
  return created.value;
}
