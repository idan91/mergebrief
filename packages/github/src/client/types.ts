import type { Logger } from "logging";
import type { Octokit } from "octokit";
import type { RepoId } from "persistence";
import type { Brand, Result, ValueOf } from "types/utils";
import type { UserOctokitFactory } from "../auth/oauth";
import type { GitHubApiError } from "../errors";
import type {
  CreateInlineReviewCommentInput,
  InlineReviewCommentResult,
} from "../operations/inline-comment";
import type { RepoCollaborators } from "../operations/collaborators";
import type {
  PullRequestInfo,
  RepositoryRef,
} from "../operations/pull-request/types";
import type { RepositoryInfo } from "../operations/repo";

export const CredentialFailureCodes = {
  CREDENTIAL_UNREADABLE: "credential-unreadable",
} as const;
export type CredentialFailureCode = ValueOf<typeof CredentialFailureCodes>;

/** The binding's own failure: no token to call GitHub with. */
export interface CredentialFailure {
  readonly code: CredentialFailureCode;
  readonly message: string;
}

export type GitHubCallFailure = GitHubApiError | CredentialFailure;

export type GitHubCall<Value> = Promise<Result<Value, GitHubCallFailure>>;

/**
 * The reviewer's token as its owner stores it. One instance per request or
 * job: the binding spends at most one renewal over its lifetime.
 */
export interface ReviewerCredential {
  readToken(): Promise<Result<string, CredentialFailure>>;
  /** Rotate past `rejected`; `undefined` when no rotation is possible. */
  renewToken(rejected: string): Promise<string | undefined>;
}

export type OperatorToken = Brand<string, "OperatorToken">;

/** The repository a gate passed on the operator token, and that token. */
export interface OperatorReads {
  readonly token: OperatorToken;
  readonly repo: RepositoryRef;
}

export interface ReviewerBindingOptions {
  readonly log: Logger;
  /** Present only for a request the gate passed on the operator token. */
  readonly operatorReads?: OperatorReads;
  readonly octokitFactory?: UserOctokitFactory;
}

export interface OperatorBindingOptions {
  readonly octokitFactory?: UserOctokitFactory;
}

/** A call input with the bound repository's coordinates left out. */
export type RepoScoped<Input> = Input extends unknown
  ? Omit<Input, "owner" | "repo">
  : never;

export type OctokitCall<Value> = (
  octokit: Octokit,
) => Promise<Result<Value, GitHubApiError>>;

/** Runs one call under a binding's credential; `context` names it in a failure. */
export type CallRunner = <Value>(
  call: OctokitCall<Value>,
  context: string,
) => GitHubCall<Value>;

export interface RepoReader {
  fetchPullRequest(prNumber: number): GitHubCall<PullRequestInfo>;
}

export interface ReviewerRepoClient extends RepoReader {
  createInlineReviewComment(
    input: RepoScoped<CreateInlineReviewCommentInput>,
  ): GitHubCall<InlineReviewCommentResult>;
}

export interface InstallationRepoClient extends RepoReader {
  listRepoCollaborators(): GitHubCall<RepoCollaborators>;
}

export interface GitHubReader {
  forRepo(repo: RepositoryRef): RepoReader;
  fetchRepositoryById(repoId: RepoId): GitHubCall<RepositoryInfo>;
}

export interface ReviewerGitHub extends GitHubReader {
  forRepo(repo: RepositoryRef): ReviewerRepoClient;
}

export interface InstallationGitHub extends GitHubReader {
  forRepo(repo: RepositoryRef): InstallationRepoClient;
}
