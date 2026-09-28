import type { GitHubApiError } from "github";
import type { InstallationId } from "persistence";
import type { InstallationGitHubPort } from "../../github-port";
import type { FailureKinds } from "../../../shared-errors/failures";

/** Narrow slice: the installation-token channel is the only dependency. */
export interface CollaboratorsControllerDeps {
  readonly github: InstallationGitHubPort;
}

/** Op-specific failure: the whole lower-layer error rides the Result. */
export interface CollaboratorsFailure {
  readonly kind: typeof FailureKinds.GITHUB_DENIED;
  readonly error: GitHubApiError;
}

export interface ListCollaboratorsInput {
  readonly installationId: InstallationId;
  readonly owner: string;
  readonly repo: string;
}
