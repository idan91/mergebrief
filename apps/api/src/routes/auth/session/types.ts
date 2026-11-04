import type {
  bindOperatorGitHub,
  bindReviewerGitHub,
  OwnedOperatorToken,
} from "github";
import type { LoadedInstancePolicy } from "generators/instance-policy";
import type { AppDatabase, AuthSessionRow, KeyProvider } from "persistence";
import type { DraftPolicy, ValueOf, AccessLevel } from "types";

/** The auth bundle injected into `createApp`; nothing here reads `process.env`. */
export interface AuthDeps {
  readonly oauthClientId: string;
  readonly oauthClientSecret: string;
  readonly keyProvider: KeyProvider;
  /** The env var NAME the session tokens seal under (e.g. `"SESSION_KEY_V1"`). */
  readonly sessionKeyRef: string;
  readonly publicBaseUrl: string;
  /** Binds the reviewer's GitHub: the repo gate's, every route's and every resolver's. */
  readonly bindReviewerGitHub: typeof bindReviewerGitHub;
  /** Binds the operator's read-only GitHub. */
  readonly bindOperatorGitHub: typeof bindOperatorGitHub;
  /** Overrides the OAuth request bound, so a test can abort in milliseconds. */
  readonly oauthRequestTimeoutMs?: number;
}

/** The slice of app deps the auth surface needs. `AppDeps` satisfies it. */
export interface AuthRouteDeps {
  readonly handle: AppDatabase;
  readonly auth: AuthDeps;
  readonly draftPolicy?: DraftPolicy;
  /**
   * Operator PAT backstop (`MERGEBRIEF_URL_FALLBACK_TOKEN`), serving only its
   * owner. Read only through `resolveOperatorTokenFor`. Absent disables the
   * fallback everywhere.
   */
  readonly operatorToken?: OwnedOperatorToken | undefined;
  /** The App's URL name (`GITHUB_APP_SLUG`); the Inbox builds its Install link from it. */
  readonly githubAppSlug?: string | undefined;
  /** GitHub user ids of the Instance's Operators; omitted = nobody. */
  readonly operatorIds?: LoadedInstancePolicy["operatorIds"];
  /** Who besides Operators may use the instance; omitted = nobody. */
  readonly allowedAccess?: LoadedInstancePolicy["allowedAccess"];
}

// A cookie session and a Bearer token resolve into the SAME principal shape,
// so every gated route works on either; `channel` is the only behavioural fork.
export const AuthChannels = {
  COOKIE: "cookie",
  BEARER: "bearer",
} as const;
export type AuthChannel = ValueOf<typeof AuthChannels>;

/**
 * For `bearer`, `sessionTokenHash` carries the API token's hash and the
 * reviewer fields the minting user's, so cache keys and audit rows stay
 * channel-agnostic. `ghTokenCiphertext` comes from the GRANT row and doubles
 * as the refresh compare-and-swap seed.
 */
export type ViewerPrincipal = AuthSessionRow & {
  readonly channel: AuthChannel;
  readonly ghTokenCiphertext: string;
  readonly keyRef: string;
  readonly scope: AccessLevel;
};

export const RefreshErrorCodes = {
  NOT_FOUND: "not-found",
  /** The API token died while the grant rotated; the row is its owner's. */
  REFRESH_FAILED: "refresh-failed",
  /** GitHub refused the rotation: every sign-in on the grant was ended. */
  GRANT_DEAD: "grant-dead",
  /** GitHub did not answer the rotation; nothing was touched. */
  UNAVAILABLE: "unavailable",
  /** The session key could not open or seal the grant's tokens; nothing was touched. */
  CRYPTO_FAILED: "crypto-failed",
  /** GitHub refused the App's own credentials or settings; nothing was touched. */
  CLIENT_MISCONFIGURED: "client-misconfigured",
} as const;
export type RefreshErrorCode = ValueOf<typeof RefreshErrorCodes>;

export interface RefreshError {
  readonly code: RefreshErrorCode;
  readonly message: string;
}

/** Why a refresh wrote nothing to the grant. */
export const RotationFailures = {
  GITHUB_REJECTED: "github-rejected",
  GITHUB_UNAVAILABLE: "github-unavailable",
  /** The session key could not open a stored token; GitHub was not called. */
  DECRYPT_FAILED: "decrypt-failed",
  /** GitHub rotated, but the session key could not seal the new pair. */
  SEAL_FAILED: "seal-failed",
  /** Another refresh held the grant past the lock bound; GitHub was not called. */
  GRANT_BUSY: "grant-busy",
  /** GitHub refused the App's credentials or settings, not the reviewer's grant. */
  CLIENT_MISCONFIGURED: "client-misconfigured",
} as const;
export type RotationFailure = ValueOf<typeof RotationFailures>;

export interface RotationRejection {
  readonly reason: RotationFailure;
  /** On `CLIENT_MISCONFIGURED`: GitHub's OAuth error token, or `expiration-not-enabled`. */
  readonly clientError?: string;
}

export interface RefreshedSession {
  readonly session: ViewerPrincipal;
  readonly accessToken: string;
}
