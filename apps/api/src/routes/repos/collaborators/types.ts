import type { GitHubCallFailure } from "github";
import type { InstallationBindingDeps } from "../../../access/types";
import type { FailureKinds } from "../../../shared-errors/failures";
import type { TtlCache } from "../../ttl-cache";

export interface CollaboratorsDeps extends InstallationBindingDeps {
  /** Serialized rosters keyed by Installation and repo, shared across viewers. */
  readonly cache: TtlCache<string>;
}

export interface CollaboratorsDeniedFailure {
  readonly kind: typeof FailureKinds.GITHUB_DENIED;
  readonly error: GitHubCallFailure;
}

/** The gate's verified slug would not split into owner and name. */
export interface CollaboratorsNotFoundFailure {
  readonly kind: "not-found";
}

export type ListCollaboratorsFailure =
  | CollaboratorsDeniedFailure
  | CollaboratorsNotFoundFailure;
