import type { GitHubApiError } from "github";
import type { InstallationId } from "persistence";

/** Op-specific failure — the whole lower-layer error rides the Result. */
export interface CollaboratorsFailure {
  readonly kind: "github-denied";
  readonly error: GitHubApiError;
}

export interface ListCollaboratorsInput {
  readonly installationId: InstallationId;
  readonly owner: string;
  readonly repo: string;
}
