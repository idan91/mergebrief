import type { CompareFiles } from "brief-core";
import type { InstallationId, RepoId } from "persistence";
import type { ValueOf } from "types/utils";
import type { UserInstallation } from "../auth/oauth";
import type {
  GitHubReader,
  InstallationGitHub,
  InstallationRepoClient,
  OperatorBindingOptions,
  OperatorToken,
  RepoScoped,
  ReviewerBindingOptions,
  ReviewerCredential,
  ReviewerGitHub,
  ReviewerRepoClient,
} from "../client/types";
import type { RepoCollaborators } from "../operations/collaborators";
import type { PrConversation } from "../operations/conversation";
import type { IssueInfo, IssueRef } from "../operations/issue";
import type {
  CompareDiffRef,
  PullRequestFile,
  PullRequestInfo,
  PullRequestRef,
  RepositoryRef,
} from "../operations/pull-request/types";
import type {
  InstallationRepository,
  RepositoryInfo,
} from "../operations/repo";
import type { RepoFileResult } from "../operations/repo-file";
import type { ReviewCommentListing } from "../operations/review-comment-list";
import type { PullRequestReviewState } from "../operations/review-pending";

/** Every method a binding exposes, named as the interfaces name it. */
export type GitHubOperation = Exclude<
  | keyof ReviewerRepoClient
  | keyof InstallationRepoClient
  | keyof ReviewerGitHub,
  "forRepo"
>;

export const CredentialKinds = {
  REVIEWER: "reviewer",
  INSTALLATION: "installation",
  OPERATOR: "operator",
} as const;
export type CredentialKind = ValueOf<typeof CredentialKinds>;

/** Who a call reached GitHub as. */
export type FakeCredential =
  | {
      readonly kind:
        | typeof CredentialKinds.REVIEWER
        | typeof CredentialKinds.OPERATOR;
      readonly token: string;
    }
  | {
      readonly kind: typeof CredentialKinds.INSTALLATION;
      readonly installationId: InstallationId;
    };

/** One request that reached the fake, in the order it arrived. */
export interface FakeGitHubCall {
  readonly operation: GitHubOperation;
  readonly credential: FakeCredential;
  readonly input: unknown;
}

/** How GitHub refuses an arranged call. */
export const FakeFailures = {
  NOT_FOUND: "not-found",
  FORBIDDEN: "forbidden",
  UNAUTHORIZED: "unauthorized",
  RATE_LIMITED: "rate-limited",
  SERVER_ERROR: "server-error",
  /** A 422 on a comment whose anchor the pinned commit's diff no longer holds. */
  ANCHOR_REJECTED: "anchor-rejected",
} as const;
export type FakeFailure = ValueOf<typeof FakeFailures>;

export interface FakeReview {
  readonly reviewId: bigint;
  readonly reviewNodeId: string;
  readonly state: PullRequestReviewState;
  readonly body: string;
  readonly authorId?: bigint;
  readonly submittedAt?: Date;
  /** Threads attached while pending. */
  readonly commentCount?: number;
}

/** A pull request as a test arranges it; absent parts read as empty. */
export interface FakePullRequest {
  readonly info: PullRequestInfo;
  readonly files?: readonly PullRequestFile[];
  readonly diff?: string;
  readonly conversation?: PrConversation;
  readonly imageSources?: readonly string[];
  readonly reviews?: readonly FakeReview[];
  readonly reviewComments?: ReviewCommentListing;
}

export interface FakeCompare {
  readonly diff?: string;
  readonly files?: CompareFiles;
}

/** A path at a ref; an absent ref is the default branch. */
export interface FakeFileRef {
  readonly path: string;
  readonly ref?: string;
}

/** What a test arranges before a call reaches the fake. */
export interface FakeGitHubArrange {
  addRepository(info: RepositoryInfo): void;
  addPullRequest(ref: PullRequestRef, pull: FakePullRequest): void;
  /** Change an arranged pull request's facts, as a push or a draft toggle does. */
  updatePullRequest(ref: PullRequestRef, info: Partial<PullRequestInfo>): void;
  addCompare(
    repo: RepositoryRef,
    span: RepoScoped<CompareDiffRef>,
    compare: FakeCompare,
  ): void;
  addRepoFile(
    repo: RepositoryRef,
    file: FakeFileRef,
    result: RepoFileResult,
  ): void;
  addIssue(ref: IssueRef, issue: IssueInfo): void;
  addInstallation(
    installation: UserInstallation,
    repositories: ReadonlyMap<RepoId, InstallationRepository>,
  ): void;
  addCollaborators(repo: RepositoryRef, listing: RepoCollaborators): void;
  addComment(repo: RepositoryRef, commentId: bigint, body: string): void;
  /** The comment is gone, as when someone deletes it on GitHub. */
  removeComment(repo: RepositoryRef, commentId: bigint): void;
  addBranch(repo: RepositoryRef, branch: string): void;
  /** Every later read of the file fails; a not-found folds to absent. */
  failRepoFile(
    repo: RepositoryRef,
    file: FakeFileRef,
    failure: FakeFailure,
  ): void;
  /** Every later `operation` on `credential` (every credential when absent) fails. */
  failOn(
    operation: GitHubOperation,
    failure: FakeFailure,
    credential?: CredentialKind,
  ): void;
  /** GitHub answers 401 to every call carrying `token`. */
  rejectToken(token: string): void;
}

/**
 * An in-memory GitHub behind the production binding signatures. The binders
 * keep the bindings' rules: one write surface per credential, the operator
 * fallback inside `operatorReads` only, a create never replayed.
 */
export interface FakeGitHub extends FakeGitHubArrange {
  bindReviewerGitHub(
    credential: ReviewerCredential,
    options: ReviewerBindingOptions,
  ): ReviewerGitHub;
  bindInstallationGitHub(installationId: InstallationId): InstallationGitHub;
  bindOperatorGitHub(
    token: OperatorToken,
    options?: OperatorBindingOptions,
  ): GitHubReader;
  readonly calls: readonly FakeGitHubCall[];
  listCalls(operation: GitHubOperation): FakeGitHubCall[];
  /** The repository's live comments by id, in posting order. */
  readComments(repo: RepositoryRef): ReadonlyMap<bigint, string>;
}
