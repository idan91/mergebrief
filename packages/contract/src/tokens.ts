// The API-token management surface: the metadata a token shows, what a mint
// sends, and what each operation answers. Token material rides the mint
// receipt alone.
import type { AccessLevel } from "types/access-levels";

/** One token, metadata only: the id stringified, timestamps ISO, `null` where unset. */
export interface ApiTokenView {
  readonly id: string;
  readonly name: string;
  readonly userLogin: string | null;
  readonly scope: AccessLevel;
  /** `null` on a no-expiry token. */
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

/** What `list-tokens` answers: the viewer's tokens, newest first. */
export interface ListTokensResponse {
  readonly tokens: readonly ApiTokenView[];
}

/** `mint-token`. `expiresInDays` `null` is no expiry; absent is the server's default. */
export interface MintTokenBody {
  readonly name: string;
  readonly scope: AccessLevel;
  readonly expiresInDays?: number | null;
}

/** What `mint-token` answers, with 201: the one body that carries the token. */
export interface MintTokenResponse {
  readonly token: string;
  readonly apiToken: ApiTokenView;
}

/** What `revoke-token` answers: the token as it now stands. */
export interface RevokeTokenResponse {
  readonly apiToken: ApiTokenView;
}

/** What `revoke-sessions` answers: how many sessions went, the caller's own included. */
export interface RevokeSessionsResponse {
  readonly revoked: number;
}
