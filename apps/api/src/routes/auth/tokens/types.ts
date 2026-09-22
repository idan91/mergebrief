import type { Logger } from "logging";
import type { ApiTokenMetadataRow, WriteClassification } from "persistence";
import type { AuthRouteDeps, ViewerPrincipal } from "../session/types";

export interface TokensControllerDeps {
  readonly deps: AuthRouteDeps;
  readonly session: ViewerPrincipal;
  readonly log: Logger;
}

/** The one failure the revoke path can produce. */
export interface RevokeFailure {
  readonly kind: "token-not-found";
}

export interface MintedToken {
  readonly token: string;
  readonly row: ApiTokenMetadataRow;
}

export interface MintInput {
  readonly name: string;
  readonly scope: WriteClassification;
  /** `null` = no expiry; `undefined` = the default window. */
  readonly expiresInDays: number | null | undefined;
  /** The opaque secret's scanner-friendly prefix (authz owns the constant). */
  readonly tokenPrefix: string;
}
