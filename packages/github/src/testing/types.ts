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
import type {
  MentionableTeam,
  MentionableUser,
} from "../operations/mentions/types";
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
  /** A 422 on a review pinned to a commit the pull request no longer holds. */
  UNKNOWN_COMMIT: "unknown-commit",
  /** A 422 on a push a repository rule refuses. */
  RULE_REFUSED: "rule-refused",
  /** A 406: GitHub will not render a diff past its size limits. */
  NOT_ACCEPTABLE: "not-acceptable",
  /** A file read whose path holds a directory, symlink or submodule. */
  NOT_A_BLOB: "not-a-blob",
  /** A file read whose blob does not decode as UTF-8 text. */
  NOT_TEXT: "not-text",
} as const;
export type FakeFailure = ValueOf<typeof FakeFailures>;

/** How the live read keeps a pull request from one credential. */
export const FakeFactsHidings = {
  /** GitHub shows no such pull request: its alias answers null. */
  NOT_SHOWN: "not-shown",
  /** GitHub refused the alias, as for SAML: the page holds no entry. */
  WITHHELD: "withheld",
} as const;
export type FakeFactsHiding = ValueOf<typeof FakeFactsHidings>;

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
  /** Paths GitHub refuses a comment anchor on, as for a file outside the diff. */
  readonly rejectedAnchorPaths?: readonly string[];
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
  /** Who GitHub says can be mentioned in the repo, in its answer order. */
  addMentionableUsers(
    repo: RepositoryRef,
    users: readonly MentionableUser[],
  ): void;
  /** The teams an org shows the viewer. */
  addTeams(org: string, teams: readonly MentionableTeam[]): void;
  addComment(repo: RepositoryRef, commentId: bigint, body: string): void;
  /** The comment is gone, as when someone deletes it on GitHub. */
  removeComment(repo: RepositoryRef, commentId: bigint): void;
  addBranch(repo: RepositoryRef, branch: string): void;
  /** The live read on `credential` hides `ref`; every other read still sees it. */
  hideFacts(
    ref: PullRequestRef,
    credential: CredentialKind,
    hiding: FakeFactsHiding,
  ): void;
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
