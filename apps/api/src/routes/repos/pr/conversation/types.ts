import type { GitHubApiError } from "github";
import type { InstallationId } from "persistence";
import type { Result } from "types/utils";
import type { InstallationGitHubPort } from "../../../github-port";
import type { FailureKinds } from "../../../../shared-errors/failures";

/** Narrow slice: the installation-token channel is the only dependency. */
export interface ConversationControllerDeps {
  readonly github: InstallationGitHubPort;
}

/** Op-specific failure; the whole lower-layer error rides the Result. */
export type ConversationFailure =
  | {
      readonly kind: typeof FailureKinds.GITHUB_DENIED;
      readonly error: GitHubApiError;
    }
  | { readonly kind: typeof FailureKinds.TOKEN_UNREADABLE };

export interface ReadConversationInput {
  readonly installationId: InstallationId;
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly entryCommentId: bigint | null;
}

/** Both credential worlds answer with the same serialized conversation. */
export type ReadConversationResult = Result<string, ConversationFailure>;
