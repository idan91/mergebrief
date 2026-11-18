import type { GitHubCallFailure } from "github";
import type { GitHubDeniedFailure } from "../../../../shared-errors/failures";

/** `resolve` is the fresh repo read, `mutation` the ready write itself. */
export type MarkReadyFailure = GitHubDeniedFailure<GitHubCallFailure>;
