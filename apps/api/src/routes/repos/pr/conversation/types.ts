import type { GitHubCallFailure } from "github";
import type { ValueOf } from "types/utils";
import type { InstallationBindingDeps } from "../../../../access/types";
import type { FailureKinds } from "../../../../shared-errors/failures";
import type { TtlCache } from "../../../ttl-cache";

/** Whose GitHub read the conversation: it decides the denial's posture. */
export const ConversationCredentials = {
  APP: "app",
  VIEWER: "viewer",
} as const;
export type ConversationCredential = ValueOf<typeof ConversationCredentials>;

export interface ConversationDeps extends InstallationBindingDeps {
  /** Serialized bodies keyed by row scope, repo and PR, shared across viewers. */
  readonly cache: TtlCache<string>;
}

export interface ConversationDeniedFailure {
  readonly kind: typeof FailureKinds.GITHUB_DENIED;
  readonly credential: ConversationCredential;
  readonly error: GitHubCallFailure;
}

/** The gate's verified slug would not split into owner and name. */
export interface ConversationNotFoundFailure {
  readonly kind: "not-found";
}

export type ReadConversationFailure =
  | ConversationDeniedFailure
  | ConversationNotFoundFailure;
