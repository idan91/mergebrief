// ENTRY POINT — the package's ONLY export (`package.json` `exports["."]`).
// Everything importable from `"github"` is re-exported here, grouped by the
// folder it lives in. Map: `AGENTS.md`.

// --- root — cross-cutting plumbing ------------------------------------------

// Local `Result`/`ValueOf` — this package does not import them from
// `persistence` at runtime (type-only imports of branded ids are the sole
// exception; see `auth/app.ts`).
export type { Result, ValueOf } from "./types";

// GitHub client env config (Zod-parsed; injectable env — never reads
// `process.env`).
export { loadConfig, ConfigErrorCode } from "./config";
export type { GitHubConfig, ConfigError } from "./config";

// Shared sanitized API-error shape (single sanitization chokepoint; GraphQL
// failures map through the `mapGraphqlError` taxonomy sibling).
export { GitHubApiErrorCode } from "./errors";
export type { GitHubApiError } from "./errors";

// --- auth/ — how a client gets CONSTRUCTED + AUTHENTICATED ------------------

// GitHub App authentication: App-JWT client + installation-scoped Octokit
// minting. JWT signing and installation-token minting/caching are owned by
// octokit's `App` class, not hand-rolled here.
export { createAppClient, getInstallationClient } from "./auth/app";
export type { AppClient } from "./auth/app";

// Reviewer OAuth (user-to-server) helpers (BRIEF-2 stage 6, PR C): web-flow
// URL, code exchange, token refresh, and the two user-token REST reads the
// callback needs to resolve the tenant. Sanitized `Result`s throughout.
export {
  createOAuthApp,
  buildAuthorizationUrl,
  exchangeWebFlowCode,
  refreshUserToken,
  fetchAuthenticatedUser,
  listAppInstallationsForUser,
  listUserInstallations,
  createUserOctokit,
  OAuthErrorCode,
} from "./auth/oauth";
export type { GitHubOAuthApp, OAuthTokens, OAuthError, UserInstallation } from "./auth/oauth";

// --- webhook/ — what GitHub PUSHES at us -------------------------------------

// Webhook HMAC verification (constant-time, via `@octokit/webhooks-methods` —
// not hand-rolled). Verifies the RAW body against `x-hub-signature-256`.
export { verifyWebhookSignature, WebhookVerifyErrorCode } from "./webhook/verify";
export type {
  VerifyWebhookSignatureInput,
  WebhookVerifyError,
} from "./webhook/verify";

// Webhook event parsing: Zod-validated, branded, discriminated `ParsedWebhookEvent`.
export {
  parseWebhookEvent,
  ParsedWebhookEventKind,
  PullRequestAction,
  InstallationAction,
  InstallationRepositoriesAction,
  EventParseErrorCode,
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
} from "./webhook/events";

// --- operations/ — what we CALL on GitHub (REST + GraphQL) -------------------

// GitHub REST primitives: Entry-comment ops, repo lookup, PR + diff fetch.
export { postEntryComment, deleteComment, fetchComment } from "./operations/comments";
export type {
  PostEntryCommentInput,
  DeleteCommentInput,
  FetchCommentInput,
} from "./operations/comments";
export { fetchRepositoryById, listInstallationRepositoriesForUser } from "./operations/repo";
export type { RepositoryInfo } from "./operations/repo";
export { getRepoFile, RepoFileKind } from "./operations/repo-file";
export type {
  GetRepoFileInput,
  RepoFileAbsent,
  RepoFileContent,
  RepoFileResult,
  RepoFileTooLarge,
} from "./operations/repo-file";
export {
  fetchPullRequest,
  fetchPullRequestFiles,
  fetchDiff,
  fetchCompareDiff,
} from "./operations/pull-request";
export type {
  PullRequestRef,
  PullRequestInfo,
  PullRequestFile,
  CompareDiffRef,
} from "./operations/pull-request";

// Review-submit primitive (BRIEF-23): one grouped formal review, pinned to
// the reviewed commit; 422s carry a best-effort validation class.
export {
  createPullRequestReview,
  ReviewEvent,
  ReviewCommentSide,
  ReviewValidationClass,
} from "./operations/review";
export type {
  CreatePullRequestReviewInput,
  ReviewCommentInput,
  CreateReviewError,
} from "./operations/review";

// Inline review-comment write (BRIEF-43 PR 4): post one standalone comment on
// a PR's diff, pinned to the anchor's commit, with the viewer's token. Returns
// the comment id + the wrapping review id (the own-comment join key); a 422
// flags a stale anchor. REST — the anchor maps 1:1 to the wire shape.
export { createInlineReviewComment } from "./operations/inline-comment";
export type {
  CreateInlineReviewCommentInput,
  InlineReviewCommentResult,
  InlineReviewCommentError,
} from "./operations/inline-comment";

// Mark-ready mutation (BRIEF-43, ADR 0031): flip a draft PR to ready-for-review
// with the viewer's own token. GraphQL resolve-then-mutate; a PR already out of
// draft (read-time or racing the mutation) converges instead of failing.
export { markPullRequestReadyForReview } from "./operations/mark-ready";
export type {
  MarkPullRequestReadyInput,
  MarkReadyResult,
} from "./operations/mark-ready";

// PR-conversation primitive (BRIEF-25, ADR 0027): the package's first GraphQL
// surface — pre-threaded review threads with first-class resolution state,
// review verdicts, PR-level comments. Domain ids are REST `databaseId`
// numbers; GraphQL node ids never leave the module.
export {
  fetchPullRequestConversation,
  createReviewCommentReply,
  ThreadSubjectType,
  ReviewVerdictState,
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
} from "./operations/conversation";
