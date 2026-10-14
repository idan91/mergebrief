// Shapes for the /api/auth/tokens endpoints.
import type { ValueOf } from "types/utils";

/**
 * The reach a token carries, one rung of the api's access ladder. Three
 * rungs, widening: read only, this instance's own state, and writes that leave
 * the instance for GitHub. Immutable for the token's life.
 */
export const TokenScopes = {
  READ: "read",
  PRIVATE_WRITE: "private-write",
  EXTERNAL_WRITE: "external-write",
} as const;
export type TokenScope = ValueOf<typeof TokenScopes>;

/** One token as the settings list shows it; metadata only, never material. */
export interface ApiTokenView {
  readonly id: string;
  readonly name: string;
  readonly scope: TokenScope;
  readonly userLogin?: string;
  /** ISO timestamp; absent on a no-expiry token. */
  readonly expiresAt?: string;
  readonly lastUsedAt?: string;
  readonly revokedAt?: string;
  readonly createdAt: string;
}

export interface TokensView {
  readonly tokens: ApiTokenView[];
}

/** The mint response; the ONE body that ever carries token material. */
export interface MintedToken {
  readonly token: string;
  readonly apiToken: ApiTokenView;
}
