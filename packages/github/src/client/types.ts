import type { CompareFiles } from "brief-core";
import type { OpenPullRequest } from "brief-core/pr-stack";
import type { Logger } from "logging";
import type { Octokit } from "octokit";
import type { InstallationId, RepoId, ReviewerId } from "persistence";
import type { Brand, Result, ValueOf } from "types/utils";
import type { UserInstallation, UserOctokitFactory } from "../auth/oauth";
import type { GitHubApiError } from "../errors";
import type { RenderedMediaSources } from "../operations/attachments";
import type {
  AttachmentBranchDeletion,
  AttachmentCommit,
  CommitAttachmentInput,
} from "../operations/attachment-branch";
import type { CollaboratorPermission } from "../operations/collaborator-permission/types";
import type { RepoCollaborators } from "../operations/collaborators";
import type {
  FetchedComment,
  IssueComment,
  PostEntryCommentInput,
  PostedComment,
} from "../operations/comments";
import type {
  CreateReviewCommentReplyInput,
  PrConversation,
  ReviewCommentReplyResult,
} from "../operations/conversation";
import type {
  CreateInlineReviewCommentInput,
  InlineReviewCommentResult,
} from "../operations/inline-comment";
import type { IssueInfo, IssueRef } from "../operations/issue";
import type { LiveReadPage } from "../operations/live-read";
import type { MarkReadyResult } from "../operations/mark-ready";
import type {
  MentionTarget,
  MentionableTeam,
  MentionableUser,
  ResolvedMentionTargets,
} from "../operations/mentions/types";
import type {
  CheckedCompareDiffRef,
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
import type { GetRepoFileInput, RepoFileResult } from "../operations/repo-file";
import type {
  SetReviewThreadResolutionInput,
  SetReviewThreadResolutionResult,
} from "../operations/resolve-thread";
import type {
  CreatePullRequestReviewInput,
  PendingReview,
} from "../operations/review";
import type {
  ListReviewCommentsSinceInput,
  ReviewCommentListing,
} from "../operations/review-comment-list";
import type {
  AuthoredReview,
  DeletePendingPullRequestReviewInput,
  ListReviewsByAuthorInput,
} from "../operations/review-pending";
import type { SubmitPullRequestReviewInput } from "../operations/review-submit";
import type {
  AddReviewThreadInput,
  ReviewThread,
} from "../operations/review-thread";

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

export const RenewalFailureCodes = {
  /** No rotation is possible, or GitHub refused it: the 401 stands. */
  REFUSED: "renewal-refused",
  /** GitHub did not answer the rotation; the credential may still be good. */
  UNAVAILABLE: "renewal-unavailable",
} as const;
export type RenewalFailureCode = ValueOf<typeof RenewalFailureCodes>;

export interface RenewalFailure {
  readonly code: RenewalFailureCode;
}

export type GitHubCall<Value> = Promise<Result<Value, GitHubCallFailure>>;

/**
 * The reviewer's token as its owner stores it. One instance per request or
 * job: the binding spends at most one renewal over its lifetime.
 */
export interface ReviewerCredential {
  readToken(): Promise<Result<string, CredentialFailure>>;
  /** Rotate past `rejected`, or say why no rotated token came back. */
  renewToken(rejected: string): Promise<Result<string, RenewalFailure>>;
}

export type OperatorToken = Brand<string, "OperatorToken">;

/** The operator token and the one GitHub account it serves. */
export interface OwnedOperatorToken {
  readonly token: OperatorToken;
  /** False for everyone until the owner lookup resolves, and after a refusal. */
  isOwnedBy(reviewerId: ReviewerId): boolean;
  /** True while the owner lookup has neither resolved nor been refused. */
  isLookupPending(): boolean;
}

/** Runs `retry` once, `delayMs` from now. */
export type RetryScheduler = (
  retry: () => Promise<void>,
  delayMs: number,
) => void;

export interface OperatorOwnerDeps {
  readonly log: Logger;
  readonly octokitFactory?: UserOctokitFactory;
  readonly scheduleRetry?: RetryScheduler;
}

/**
 * The one pull request a gate passed on the operator token, and the commits
 * recorded for it. A read reaches the operator token only inside this scope.
 */
export interface OperatorReads {
  readonly token: OperatorToken;
  readonly repo: RepositoryRef;
  readonly prNumber: number;
  /**
   * Full commit SHAs; a branch name or a short SHA never matches. Asked only
   * when a denied read at caller-chosen commits would fall back.
   */
  loadKnownCommits(): Promise<ReadonlySet<string>>;
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

/** A read of one pull request. */
export interface PullRequestReach {
  readonly prNumber: number;
}

/** A read at caller-chosen commits; an absent one reads the default branch. */
export interface CommitReach {
  readonly commits: readonly (string | undefined)[];
}

/** What a repository read touches, checked before any operator fallback. */
export type ReadReach = PullRequestReach | CommitReach;

/** `CallRunner` for a repository read; a runner may ignore the reach. */
export type RepoReadRunner = <Value>(
  call: OctokitCall<Value>,
  context: string,
  reach: ReadReach,
) => GitHubCall<Value>;

/** The three runners a reviewer repository client calls through. */
export interface ReviewerRunners {
  /** The reviewer's token, then the operator token on a denied read in reach. */
  readonly read: RepoReadRunner;
  /** The reviewer's token only. */
  readonly own: CallRunner;
  /** The reviewer's token on a retry-off client. */
  readonly create: CallRunner;
}

/**
 * The reads every credential shares, bound to one repository. On a reviewer
 * binding with `operatorReads`, a denied read retries on the operator token
 * only under the rule on its method.
 */
export interface RepoReader {
  /** Operator fallback: only for `operatorReads.prNumber`. */
  fetchPullRequest(prNumber: number): GitHubCall<PullRequestInfo>;
  /** Operator fallback: only for `operatorReads.prNumber`. */
  fetchPullRequestFiles(prNumber: number): GitHubCall<PullRequestFile[]>;
  /** Operator fallback: only for `operatorReads.prNumber`. */
  fetchDiff(prNumber: number): GitHubCall<string>;
  /** Operator fallback: only when base and head are both known commits. */
  fetchCompareDiff(span: RepoScoped<CompareDiffRef>): GitHubCall<string>;
  /** Operator fallback: only when base and head are both known commits. */
  fetchCheckedCompareDiff(
    span: RepoScoped<CheckedCompareDiffRef>,
  ): GitHubCall<string>;
  /** Operator fallback: only when base and head are both known commits. */
  fetchCompareFiles(span: RepoScoped<CompareDiffRef>): GitHubCall<CompareFiles>;
  /** Operator fallback: only when base and head are both known commits. */
  fetchMergeBase(span: RepoScoped<CompareDiffRef>): GitHubCall<string>;
  /** Operator fallback: only at a known commit `ref`; never without one. */
  fetchRepoFile(
    input: RepoScoped<GetRepoFileInput>,
  ): GitHubCall<RepoFileResult>;
  /** Operator fallback: only for `operatorReads.prNumber`. */
  fetchPullRequestConversation(prNumber: number): GitHubCall<PrConversation>;
  /** Operator fallback: only for `operatorReads.prNumber`. */
  fetchRenderedMediaSources(prNumber: number): GitHubCall<RenderedMediaSources>;
}

/**
 * Pending-review reads stay off `RepoReader`: GitHub shows a pending review
 * only to its author, so no other credential may answer for one.
 */
export interface ReviewerRepoClient extends RepoReader {
  /**
   * The list names every pull request in the repository, so it never reads
   * on the operator token.
   */
  listOpenPullRequests(): GitHubCall<OpenPullRequest[]>;
  findPendingPullRequestReview(
    prNumber: number,
  ): GitHubCall<PendingReview | undefined>;
  countPendingReviewComments(reviewNodeId: string): GitHubCall<number>;
  hasPullRequestReviewPublished(
    review: RepoScoped<DeletePendingPullRequestReviewInput>,
  ): GitHubCall<boolean>;
  listReviewsByAuthor(
    input: RepoScoped<ListReviewsByAuthorInput>,
  ): GitHubCall<readonly AuthoredReview[]>;
  listReviewCommentsSince(
    input: RepoScoped<ListReviewCommentsSinceInput>,
  ): GitHubCall<ReviewCommentListing>;
  createPullRequestReview(
    input: RepoScoped<CreatePullRequestReviewInput>,
  ): GitHubCall<PendingReview>;
  addPullRequestReviewThread(
    input: AddReviewThreadInput,
  ): GitHubCall<ReviewThread>;
  submitPullRequestReview(
    input: SubmitPullRequestReviewInput,
  ): GitHubCall<void>;
  createInlineReviewComment(
    input: RepoScoped<CreateInlineReviewCommentInput>,
  ): GitHubCall<InlineReviewCommentResult>;
  createReviewCommentReply(
    input: RepoScoped<CreateReviewCommentReplyInput>,
  ): GitHubCall<ReviewCommentReplyResult>;
  markPullRequestReadyForReview(prNumber: number): GitHubCall<MarkReadyResult>;
  setReviewThreadResolution(
    input: RepoScoped<SetReviewThreadResolutionInput>,
  ): GitHubCall<SetReviewThreadResolutionResult>;
  deletePendingPullRequestReview(
    review: RepoScoped<DeletePendingPullRequestReviewInput>,
  ): GitHubCall<void>;
  /** Users GitHub says can be mentioned here that match the typed text. */
  searchMentionableUsers(query: string): GitHubCall<readonly MentionableUser[]>;
  /** The owner org's teams the viewer sees; none when a person owns the repo. */
  searchMentionableTeams(query: string): GitHubCall<readonly MentionableTeam[]>;
  resolveMentionTargets(
    targets: readonly MentionTarget[],
  ): GitHubCall<ResolvedMentionTargets>;
}

export interface InstallationRepoClient extends RepoReader {
  listRepoCollaborators(): GitHubCall<RepoCollaborators>;
  /** Asks GitHub once, under the webhook confirmation deadline. */
  readCollaboratorPermission(login: string): GitHubCall<CollaboratorPermission>;
  listOpenPullRequests(): GitHubCall<OpenPullRequest[]>;
  /** `undefined` when the comment is gone. */
  fetchComment(commentId: bigint): GitHubCall<FetchedComment | undefined>;
  /** Every comment on the PR's conversation, oldest first. */
  listIssueComments(prNumber: number): GitHubCall<IssueComment[]>;
  postEntryComment(
    input: RepoScoped<PostEntryCommentInput>,
  ): GitHubCall<PostedComment>;
  /** A comment already gone is a success. */
  deleteComment(commentId: bigint): GitHubCall<void>;
  /** Replaces the body in place, with no notification; `false` when the comment is gone. */
  editComment(commentId: bigint, body: string): GitHubCall<boolean>;
  commitAttachment(
    input: RepoScoped<CommitAttachmentInput>,
  ): GitHubCall<AttachmentCommit>;
  deleteAttachmentBranch(branch: string): GitHubCall<AttachmentBranchDeletion>;
}

/** The account-level reads every credential shares. */
export interface AccountReader {
  fetchRepositoryById(repoId: RepoId): GitHubCall<RepositoryInfo>;
  /** Throws past `LIVE_READ_PAGE_SIZE` refs. */
  readPullRequestFacts(
    refs: readonly PullRequestRef[],
  ): GitHubCall<LiveReadPage>;
  /** In any repository the credential sees, not only a bound one. */
  fetchIssue(ref: IssueRef): GitHubCall<IssueInfo>;
}

export interface GitHubReader extends AccountReader {
  forRepo(repo: RepositoryRef): RepoReader;
}

export interface ReviewerGitHub extends GitHubReader {
  forRepo(repo: RepositoryRef): ReviewerRepoClient;
  listUserInstallations(): GitHubCall<UserInstallation[]>;
  /** The installation's repositories this reviewer can also reach. */
  listInstallationRepositories(
    installationId: InstallationId,
  ): GitHubCall<ReadonlyMap<RepoId, InstallationRepository>>;
}

export interface InstallationGitHub extends GitHubReader {
  forRepo(repo: RepositoryRef): InstallationRepoClient;
  /** Every repository the installation holds, not one reviewer's share. */
  listInstallationRepoIds(): GitHubCall<ReadonlySet<RepoId>>;
}
