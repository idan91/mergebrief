import type { Logger } from "logging";
import type { WriteClassification } from "persistence";
import type { AccessibleSetFailure } from "../accessible-installations";
import type { AuthRouteDeps, ViewerPrincipal } from "../session";

export interface TokensControllerDeps {
  readonly deps: AuthRouteDeps;
  readonly session: ViewerPrincipal;
  readonly log: Logger;
}

export type TokensFailure =
  | AccessibleSetFailure
  | { readonly kind: "target-not-accessible" }
  | { readonly kind: "token-not-found" };

/** The one failure the revoke path can produce. */
export type RevokeFailure = Extract<TokensFailure, { kind: "token-not-found" }>;

export interface MintInput {
  readonly name: string;
  readonly scope: WriteClassification;
  readonly installationId: string | number;
  /** `null` = no expiry; `undefined` = the default window. */
  readonly expiresInDays: number | null | undefined;
  /** The opaque secret's scanner-friendly prefix (authz owns the constant). */
  readonly tokenPrefix: string;
}
