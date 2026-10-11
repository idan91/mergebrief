// ENTRY POINT: the package's ONLY export (`package.json` `exports["."]`).
// Everything importable from `"github"` is re-exported here, grouped by folder.

// --- root: cross-cutting plumbing ------------------------------------------

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
  UserOctokitFactory,
  UserOctokitOptions,
} from "./auth/oauth";

// --- client/: GitHub bound to one credential ---------------------------------

// Retry, token renewal and the operator read fallback live inside a binding.
// One binding per request or job.
export { bindReviewerGitHub } from "./client/reviewer";
export { bindInstallationGitHub } from "./client/installation";
export { bindOperatorGitHub, isOperatorToken } from "./client/operator";
export { resolveOperatorTokenOwner } from "./client/operator-owner";
export { CredentialFailureCodes } from "./client/types";
export type {
  CredentialFailure,
  CredentialFailureCode,
  GitHubCall,
  GitHubCallFailure,
  GitHubReader,
  InstallationGitHub,
  InstallationRepoClient,
  OperatorBindingOptions,
  OperatorReads,
  OperatorToken,
  OwnedOperatorToken,
  RepoReader,
  RepoScoped,
  ReviewerBindingOptions,
  ReviewerCredential,
  ReviewerGitHub,
  ReviewerRepoClient,
} from "./client/types";

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
export type { InstallationRepository, RepositoryInfo } from "./operations/repo";
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
  listOpenPullRequests,
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
  RepositoryRef,
  CompareDiffRef,
  CommitRef,
} from "./operations/pull-request";
export {
  getLiveReadKey,
  LIVE_READ_PAGE_SIZE,
  readPullRequestFacts,
} from "./operations/live-read";
export type { LiveReadPage, PullRequestFacts } from "./operations/live-read";
export { fetchIssue } from "./operations/issue";
export type { IssueInfo, IssueRef } from "./operations/issue";

// Review-submit primitives, three GitHub objects: the pending review (REST,
// pinned to the reviewed commit; a 422 carries a best-effort code), the
// review thread (GraphQL; a rejected anchor is a Result, not a throw) and the
// submit event (GraphQL).
export { createPullRequestReview } from "./operations/review";
export type {
  CreatePullRequestReviewInput,
  PendingReview,
} from "./operations/review";
export {
  addPullRequestReviewThread,
  ReviewCommentSides,
  ReviewSubjectTypes,
} from "./operations/review-thread";
export type {
  AddReviewThreadInput,
  LineReviewThreadInput,
  FileReviewThreadInput,
  ReviewThread,
  ReviewCommentSide,
  ReviewSubjectType,
} from "./operations/review-thread";
export {
  countPendingReviewComments,
  hasPullRequestReviewPublished,
  findPendingPullRequestReview,
  deletePendingPullRequestReview,
  listReviewsByAuthor,
  PullRequestReviewStates,
} from "./operations/review-pending";
export type {
  PullRequestReviewRef,
  DeletePendingPullRequestReviewInput,
  ListReviewsByAuthorInput,
  AuthoredReview,
  PullRequestReviewState,
} from "./operations/review-pending";
export { listReviewCommentsSince } from "./operations/review-comment-list";
export type {
  ListedReviewComment,
  ListReviewCommentsSinceInput,
  ReviewCommentListing,
} from "./operations/review-comment-list";
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
// the wrapping review id (the own-comment join key); a 422 answers
// `anchor-rejected`.
export { createInlineReviewComment } from "./operations/inline-comment";
export type {
  CreateInlineReviewCommentInput,
  CreateLineInlineReviewCommentInput,
  InlineReviewCommentResult,
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

// The rendered image sources of a PR's bodies: a private attachment is
// reachable only through the signed URL GitHub renders into `bodyHTML`.
export {
  extractImageSources,
  fetchRenderedImageSources,
  type FetchRenderedImageSourcesInput,
} from "./operations/attachments";

// The attachments-branch write, the one push the App makes to a customer
// repository: an orphan branch of image files, one commit per upload.
export {
  commitAttachment,
  deleteAttachmentBranch,
} from "./operations/attachment-branch";
export type {
  AttachmentBranchDeletion,
  AttachmentCommit,
  CommitAttachmentInput,
  DeleteAttachmentBranchInput,
} from "./operations/attachment-branch";

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
  ReviewCommentReplyResult,
  PrConversation,
  ConversationThread,
  ConversationComment,
  ConversationReview,
  ConversationAuthor,
  PrComment,
  ThreadSubjectType,
  ReviewVerdictState,
} from "./operations/conversation";
