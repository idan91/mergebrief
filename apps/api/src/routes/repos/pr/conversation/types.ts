import type { GitHubApiError } from "github";
import type { InstallationId } from "persistence";
import type { Result } from "types";
import type { InstallationGitHubPort } from "../../../github-port";

/** Narrow slice: the installation-token channel is the only dependency. */
export interface ConversationControllerDeps {
  readonly github: InstallationGitHubPort;
}

/** Op-specific failure — the whole lower-layer error rides the Result. */
export type ConversationFailure =
  | { readonly kind: "github-denied"; readonly error: GitHubApiError }
  | { readonly kind: "token-unreadable" };

export interface ReadConversationInput {
  readonly installationId: InstallationId;
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly entryCommentId: bigint | null;
}

/** Both credential worlds answer with the same serialized conversation. */
export type ReadConversationResult = Result<string, ConversationFailure>;
