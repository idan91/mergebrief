// ENTRY POINT: the package's ONLY export (`package.json` `exports["."]`).
// Everything importable from `"github"` is re-exported here, grouped by folder.

// --- root: cross-cutting plumbing ------------------------------------------

// Zod-parsed env config; env is injected, never read from `process.env`.
export { loadConfig, ConfigErrorCodes } from "./config";
export type { GitHubConfig, ConfigError, ConfigErrorCode } from "./config";

// GitHub's account `type` and repository visibility vocabularies, read by
// webhook parsing and REST reads.
export { GitHubAccountTypes, RepositoryVisibilities } from "./types";
export type { GitHubAccountType, RepositoryVisibility } from "./types";

// Shared sanitized API-error shape: the single sanitization chokepoint.
export { GitHubApiErrorCodes, buildRenewalUnavailableError } from "./errors";
export type { GitHubApiError, GitHubApiErrorCode } from "./errors";

// How a caller ranks a failed call: too large, a render timeout, permanent.
export {
  isDiffTooLarge,
  isNotAcceptable,
  isPermanentGitHubError,
  isRenderTimedOut,
  isSpanUnrendered,
} from "./call-failures";

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
  deleteUserToken,
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
export { CredentialFailureCodes, RenewalFailureCodes } from "./client/types";
export type {
  CredentialFailure,
  CredentialFailureCode,
  RenewalFailure,
  RenewalFailureCode,
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
  ParsedGitHubAppAuthorizationEvent,
  ParsedCheckRunEvent,
  ParsedStatusEvent,
  ParsedCommitReport,
  IgnoredWebhookEvent,
  EventParseError,
  EventParseErrorCode,
  ParsedWebhookEventKind,
  PullRequestAction,
  InstallationAction,
  InstallationRepositoriesAction,
} from "./webhook/events";
export {
  AuthorAssociations,
  CheckRunActions,
  GitHubAppAuthorizationActions,
  TRUSTED_AUTHOR_ASSOCIATIONS,
  type AuthorAssociation,
  type CheckRunAction,
  type GitHubAppAuthorizationAction,
} from "./webhook/types";

// --- operations/: what we CALL on GitHub (REST + GraphQL) -------------------

// REST primitives: Entry-comment ops, repo lookup, PR + diff fetch.
export {
  postEntryComment,
  deleteComment,
  fetchComment,
  listIssueComments,
} from "./operations/comments";
export type {
  PostEntryCommentInput,
  DeleteCommentInput,
  FetchCommentInput,
  IssueComment,
  ListIssueCommentsInput,
} from "./operations/comments";
export {
  fetchRepositoryById,
  listInstallationRepositoriesForUser,
} from "./operations/repo";
export type { InstallationRepository, RepositoryInfo } from "./operations/repo";
// Installation presence, on the App's own JWT: 404 reads gone.
export {
  listHookDeliveries,
  redeliverHookDelivery,
} from "./operations/hook-deliveries";
export type {
  HookDelivery,
  HookDeliveryPage,
} from "./operations/hook-deliveries";
export { readInstallationPresence } from "./operations/installation";
export { InstallationPresences } from "./operations/installation/types";
export type { InstallationPresence } from "./operations/installation/types";
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
export { fetchRepositoryVisibility } from "./operations/repo-visibility";

// Review-submit primitives, three GitHub objects: the pending review (REST,
// pinned to the reviewed commit; a 422 carries a best-effort code), the
// review thread (GraphQL; a rejected anchor is a Result, not a throw) and the
// submit event (GraphQL).
export {
  createPullRequestReview,
  PullRequestReviewStates,
} from "./operations/review";
export type {
  CreatePullRequestReviewInput,
  PendingReview,
  PullRequestReviewState,
} from "./operations/review";
export {
  addPullRequestReviewThread,
  ReviewSubjectTypes,
} from "./operations/review-thread";
export type {
  AddReviewThreadInput,
  LineReviewThreadInput,
  FileReviewThreadInput,
  ReviewThread,
  ReviewSubjectType,
} from "./operations/review-thread";
export {
  countPendingReviewComments,
  hasPullRequestReviewPublished,
  findPendingPullRequestReview,
  deletePendingPullRequestReview,
  listReviewsByAuthor,
} from "./operations/review-pending";
export type {
  PullRequestReviewRef,
  DeletePendingPullRequestReviewInput,
  ListReviewsByAuthorInput,
  AuthoredReview,
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
// A user's effective permission on one repository, under the webhook
// confirmation deadline: it settles a review whose association hides access.
export {
  CollaboratorPermissions,
  TRUSTED_COLLABORATOR_PERMISSIONS,
} from "./operations/collaborator-permission/types";
export type { CollaboratorPermission } from "./operations/collaborator-permission/types";

// What reports on a commit, and which checks a branch requires: the
// trigger-condition check's bots and ci reads, on the installation binding.
export {
  CheckRunConclusions,
  CommitStatusStates,
} from "./operations/status-checks/types";
export type {
  CheckRun,
  CheckRunConclusion,
  CommitStatus,
  CommitStatusState,
} from "./operations/status-checks/types";
export type { SubmittedReview } from "./operations/review-list";
export type {
  ListRepoCollaboratorsInput,
  RepoCollaborator,
  RepoCollaborators,
} from "./operations/collaborators";

// What GitHub offers a reviewer who types `@`, on the reviewer's own token.
export { MAX_MENTION_TARGETS } from "./operations/mentions/consts";
export { MentionTargetKinds } from "./operations/mentions/types";
export type {
  MentionTarget,
  MentionTargetKind,
  MentionableTeam,
  MentionableUser,
  ResolvedMentionTargets,
  TeamMentionTarget,
  UserMentionTarget,
} from "./operations/mentions/types";

// The rendered image and video sources of a PR's bodies: a private
// attachment is reachable only through the signed URL GitHub renders into
// `bodyHTML`.
export {
  extractImageSources,
  extractVideoSources,
  fetchRenderedMediaSources,
  type FetchRenderedMediaSourcesInput,
  type RenderedMediaSources,
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
} from "./operations/conversation";
