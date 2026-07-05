// Package entry point — the whole public surface (BRIEF-2 stage 1). Mirrors
// `packages/persistence/src/lib.ts`'s documented-export style: named exports
// only, grouped by concern.

// Local `Result`/`ValueOf` — this package does not import them from
// `persistence` at runtime (type-only imports of branded ids are the sole
// exception; see `app-auth.ts`).
export type { Result, ValueOf } from "./types";

// GitHub client env config (Zod-parsed; injectable env — never reads
// `process.env`).
export { loadConfig, ConfigErrorCode } from "./config";
export type { GitHubConfig, ConfigError } from "./config";

// GitHub App authentication: App-JWT client + installation-scoped Octokit
// minting. JWT signing and installation-token minting/caching are owned by
// octokit's `App` class, not hand-rolled here.
export { createAppClient, getInstallationClient } from "./app-auth";
export type { AppClient } from "./app-auth";

// Webhook HMAC verification (constant-time, via `@octokit/webhooks-methods` —
// not hand-rolled). Verifies the RAW body against `x-hub-signature-256`.
export { verifyWebhookSignature, WebhookVerifyErrorCode } from "./webhook";
export type {
  VerifyWebhookSignatureInput,
  WebhookVerifyError,
} from "./webhook";

// Webhook event parsing: Zod-validated, branded, discriminated `ParsedWebhookEvent`.
export {
  parseWebhookEvent,
  ParsedWebhookEventKind,
  PullRequestAction,
  InstallationAction,
  InstallationRepositoriesAction,
  EventParseErrorCode,
} from "./events";
export type {
  ParseWebhookEventInput,
  ParsedWebhookEvent,
  ParsedPullRequestEvent,
  ParsedPullRequestReviewEvent,
  ParsedInstallationEvent,
  ParsedInstallationRepositoriesEvent,
  IgnoredWebhookEvent,
  EventParseError,
} from "./events";

// GitHub REST primitives: Entry-comment ops, repo lookup, PR + diff fetch.
export { postEntryComment, deleteComment } from "./comments";
export type { PostEntryCommentInput, DeleteCommentInput } from "./comments";
export { fetchRepositoryById } from "./repo";
export type { RepositoryInfo } from "./repo";
export { fetchPullRequest, fetchDiff } from "./pull-request";
export type { PullRequestRef, PullRequestInfo } from "./pull-request";

// Shared sanitized API-error shape (single sanitization chokepoint).
export { GitHubApiErrorCode } from "./errors";
export type { GitHubApiError } from "./errors";
