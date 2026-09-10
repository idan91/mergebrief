// ENTRY POINT: the package's ONLY export (`package.json` `exports["."]`).
// Everything importable from `"github"` is re-exported here, grouped by folder.

// --- root: cross-cutting plumbing ------------------------------------------

// Local `Result`/`ValueOf`, never imported from `persistence` at runtime
// (type-only imports of branded ids are the sole exception).
export type { Result, ValueOf } from "./types";

// Zod-parsed env config; env is injected, never read from `process.env`.
export { loadConfig, ConfigErrorCodes } from "./config";
export type { GitHubConfig, ConfigError, ConfigErrorCode } from "./config";

// Shared sanitized API-error shape: the single sanitization chokepoint.
export { GitHubApiErrorCodes } from "./errors";
export type { GitHubApiError, GitHubApiErrorCode } from "./errors";

// --- auth/: how a client gets CONSTRUCTED + AUTHENTICATED ------------------

// GitHub App authentication. JWT signing and installation-token
// minting/caching are owned by octokit's `App` class, not hand-rolled here.
export { createAppClient, getInstallationClient } from "./auth/app";
export type { AppClient } from "./auth/app";

// Reviewer OAuth (user-to-server) helpers: web-flow URL, code exchange, token
// refresh, and the user-token REST reads the callback needs. Sanitized
// `Result`s throughout.
export {
  createOAuthApp,
  buildAuthorizationUrl,
  exchangeWebFlowCode,
  refreshUserToken,
  fetchAuthenticatedUser,
  listAppInstallationsForUser,
  listUserInstallations,
  createUserOctokit,
  OAuthErrorCodes,
} from "./auth/oauth";
export type {
  GitHubOAuthApp,
  OAuthTokens,
  OAuthError,
  OAuthErrorCode,
  UserInstallation,
  UserOctokitOptions,
} from "./auth/oauth";

// --- webhook/: what GitHub PUSHES at us -------------------------------------

// Webhook HMAC verification: constant-time, over the RAW body.
export {
  verifyWebhookSignature,
  WebhookVerifyErrorCodes,
} from "./webhook/verify";
export type {
  VerifyWebhookSignatureInput,
  WebhookVerifyError,
  WebhookVerifyErrorCode,
} from "./webhook/verify";

// Webhook event parsing: Zod-validated, branded, discriminated.
export {
  parseWebhookEvent,
  ParsedWebhookEventKinds,
  PullRequestActions,
  InstallationActions,
  InstallationRepositoriesActions,
  EventParseErrorCodes,
} from "./webhook/events";
export type {
  ParseWebhookEventInput,
  ParsedWebhookEvent,
  ParsedPullRequestEvent,
  ParsedPullRequestReviewEvent,
  ParsedInstallationEvent,
  ParsedInstallationRepositoriesEvent,
  IgnoredWebhookEvent,
  EventParseError,
  EventParseErrorCode,
  ParsedWebhookEventKind,
  PullRequestAction,
  InstallationAction,
  InstallationRepositoriesAction,
} from "./webhook/events";

// --- operations/: what we CALL on GitHub (REST + GraphQL) -------------------

// REST primitives: Entry-comment ops, repo lookup, PR + diff fetch.
export {
  postEntryComment,
  deleteComment,
  fetchComment,
} from "./operations/comments";
export type {
  PostEntryCommentInput,
  DeleteCommentInput,
  FetchCommentInput,
} from "./operations/comments";
export {
  fetchRepositoryById,
  listInstallationRepositoriesForUser,
} from "./operations/repo";
export type { RepositoryInfo } from "./operations/repo";
export { getRepoFile, RepoFileKinds } from "./operations/repo-file";
export type {
  GetRepoFileInput,
  RepoFileAbsent,
  RepoFileContent,
  RepoFileKind,
  RepoFileResult,
  RepoFileTooLarge,
} from "./operations/repo-file";
export {
  fetchPullRequest,
  fetchPullRequestFiles,
  fetchDiff,
  fetchCompareDiff,
  fetchCompareFiles,
  fetchCompareCommitCount,
  fetchReviewCommentsRaw,
  resolveCommitSha,
} from "./operations/pull-request";
export type {
  PullRequestRef,
  PullRequestInfo,
  PullRequestFile,
  CompareDiffRef,
  CommitRef,
} from "./operations/pull-request";
export { fetchIssue } from "./operations/issue";
export type { IssueInfo, IssueRef } from "./operations/issue";

// Review-submit primitives, three GitHub objects: the pending review (REST,
// pinned to the reviewed commit; 422s carry a best-effort validation class),
// the review thread (GraphQL; a rejected anchor is a Result, not a throw) and
// the submit event (GraphQL).
export {
  createPullRequestReview,
  ReviewValidationClasses,
} from "./operations/review";
export type {
  CreatePullRequestReviewInput,
  PendingReview,
  CreateReviewError,
  ReviewValidationClass,
} from "./operations/review";
export {
  addPullRequestReviewThread,
  ReviewCommentSides,
  ReviewSubjectTypes,
  ReviewThreadFailureKinds,
} from "./operations/review-thread";
export type {
  AddReviewThreadInput,
  LineReviewThreadInput,
  FileReviewThreadInput,
  ReviewThread,
  ReviewThreadFailure,
  ReviewThreadFailureKind,
  ReviewThreadAnchorRejected,
  ReviewThreadRequestFailed,
  ReviewCommentSide,
  ReviewSubjectType,
} from "./operations/review-thread";
export {
  countPendingReviewComments,
  hasPullRequestReviewPublished,
  findPendingPullRequestReview,
  deletePendingPullRequestReview,
} from "./operations/review-pending";
export type {
  PullRequestReviewRef,
  DeletePendingPullRequestReviewInput,
} from "./operations/review-pending";
export {
  submitPullRequestReview,
  ReviewEvents,
} from "./operations/review-submit";
export type {
  SubmitPullRequestReviewInput,
  ReviewEvent,
} from "./operations/review-submit";

// Inline review-comment write: one standalone comment on a PR's diff, pinned
// to the anchor's commit, with the viewer's token. Returns the comment id plus
// the wrapping review id (the own-comment join key); a 422 flags a stale
// anchor.
export { createInlineReviewComment } from "./operations/inline-comment";
export type {
  CreateInlineReviewCommentInput,
  CreateLineInlineReviewCommentInput,
  InlineReviewCommentResult,
  InlineReviewCommentError,
} from "./operations/inline-comment";

// Mark-ready mutation: flip a draft PR to ready-for-review with the viewer's
// own token. A PR already out of draft converges instead of failing.
export { markPullRequestReadyForReview } from "./operations/mark-ready";
export type {
  MarkPullRequestReadyInput,
  MarkReadyResult,
} from "./operations/mark-ready";

// Thread-resolution mutations, with the viewer's own token. GraphQL-only (REST
// has no thread-resolution surface); the thread's node id is resolved
// internally from its root comment id and never leaves the module. A thread
// already in the requested state converges instead of failing.
export { setReviewThreadResolution } from "./operations/resolve-thread";
export type {
  SetReviewThreadResolutionInput,
  SetReviewThreadResolutionResult,
} from "./operations/resolve-thread";

// Collaborators primitive: the @mention candidate pool (`affiliation: ALL`
// covers org/team-granted members). GraphQL because REST's list carries no
// display name.
export { listRepoCollaborators } from "./operations/collaborators";
export type {
  ListRepoCollaboratorsInput,
  RepoCollaborator,
  RepoCollaborators,
} from "./operations/collaborators";

// PR-conversation primitive: pre-threaded review threads with first-class
// resolution state, review verdicts, PR-level comments. Domain ids are REST
// `databaseId` numbers; GraphQL node ids never leave the module.
export {
  fetchPullRequestConversation,
  createReviewCommentReply,
  ThreadSubjectTypes,
  ReviewVerdictStates,
} from "./operations/conversation";
export type {
  FetchPullRequestConversationInput,
  CreateReviewCommentReplyInput,
  PrConversation,
  ConversationThread,
  ConversationComment,
  ConversationReview,
  ConversationAuthor,
  PrComment,
  ThreadSubjectType,
  ReviewVerdictState,
} from "./operations/conversation";
