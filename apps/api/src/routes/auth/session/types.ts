import type {
  bindOperatorGitHub,
  bindReviewerGitHub,
  OwnedOperatorToken,
} from "github";
import type {
  AppDatabase,
  AuthSessionRow,
  KeyProvider,
  WriteClassification,
} from "persistence";
import type { DraftPolicy, ValueOf } from "types";

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
}

/** The slice of app deps the auth surface needs. `AppDeps` satisfies it. */
export interface AuthRouteDeps {
  readonly handle: AppDatabase;
  readonly auth: AuthDeps;
  readonly draftPolicy?: DraftPolicy;
  /**
   * Operator PAT backstop (`MERGEBRIEF_URL_BOX_TOKEN`), serving only its
   * owner. Read only through `resolveOperatorTokenFor`. Absent disables the
   * fallback everywhere.
   */
  readonly operatorToken?: OwnedOperatorToken | undefined;
  /** The App's URL name (`GITHUB_APP_SLUG`); the Inbox builds its Install link from it. */
  readonly githubAppSlug?: string | undefined;
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
  readonly scope: WriteClassification;
};

export const RefreshErrorCodes = {
  NOT_FOUND: "not-found",
  REFRESH_FAILED: "refresh-failed",
} as const;
export type RefreshErrorCode = ValueOf<typeof RefreshErrorCodes>;

export interface RefreshError {
  readonly code: RefreshErrorCode;
  readonly message: string;
}

export interface RefreshedSession {
  readonly session: ViewerPrincipal;
  readonly accessToken: string;
}
