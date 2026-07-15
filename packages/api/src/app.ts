// The Hono app factory (BRIEF-2 stage 4 + stage 6). Dependencies are INJECTED:
// tests pass a PGlite `AppDatabase` + secrets/stubs; the composition root (the
// `apps/web` catch-all mount) passes `createDb(DATABASE_URL)` + the Zod-parsed
// GitHub config + the crypto key provider. This module never reads
// `process.env` and never constructs a DB — same injection discipline as
// `loadConfig`.
//
// Routes here: the webhook trust boundary (stage 4), the reviewer OAuth routes
// (stage 6), and the authz-gated read API (stage 7).
import { Hono } from "hono";
import type { AppDatabase } from "persistence";
import { authRoute, type AuthDeps } from "./routes/auth";
import { conversationRoutes, type ConversationGitHubPort } from "./routes/conversation";
import { installationsRoute } from "./routes/installations";
import { createAllowedRepoResolver } from "./routes/allowed-repos";
import { pullsRoute } from "./routes/pulls";
import { reposRoute } from "./routes/repos";
import { readsRoute } from "./routes/reads";
import { tokensRoute } from "./routes/tokens";
import { versionRoute } from "./routes/version";
import { reviewSubmitRoute } from "./routes/review-submit";
import { markReadyRoute } from "./routes/mark-ready";
import { inlineCommentRoute } from "./routes/inline-comment";
import { webhookRoute } from "./routes/webhook";

export type { AuthDeps } from "./routes/auth";

export interface AppDeps {
  readonly handle: AppDatabase;
  readonly webhookSecret: string;
  /** Reviewer-auth bundle (OAuth creds, crypto seam, cookie/redirect policy). */
  readonly auth: AuthDeps;
  /** Installation-octokit seam for the conversation read (BRIEF-25). */
  readonly github: ConversationGitHubPort;
  /** Exposed by GET /api/version (ADR 0029 #8 — skew visibility). */
  readonly serverVersion?: string;
}

/** Build the API app over injected deps. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.route("/", webhookRoute(deps));
  app.route("/", authRoute(deps));
  app.route("/", installationsRoute(deps));
  app.route("/", tokensRoute(deps));
  // ONE resolver instance: /api/pulls and /api/repos share the allowed-set
  // cache (BRIEF-17 PR 3 — one GitHub fetch serves both inside the TTL).
  const allowedRepos = createAllowedRepoResolver(deps);
  app.route("/", versionRoute(deps, deps.serverVersion ?? "dev"));
  app.route("/", pullsRoute(deps, allowedRepos));
  // Mounted BEFORE readsRoute (single-gate rule); exact path, no :repoId.
  app.route("/", reposRoute(deps, allowedRepos));
  // Mounted BEFORE readsRoute: readsRoute guards `/api/repos/:repoId/*` with
  // its own gate instance, method-agnostic — mounted first, the submit POST
  // would traverse BOTH gates (two GitHub access checks cold; a transient
  // failure on the second 404s a just-verified request). Registration order
  // ensures a submit POST hits exactly one per-repo gate: its own.
  // Conversation surface (BRIEF-25): built first so the submit route can
  // evict the PR's conversation cache on its own success path (a submitted
  // review IS a conversation write). Mounted before readsRoute for the same
  // single-gate reason as the submit route.
  const conversation = conversationRoutes(deps);
  app.route("/", reviewSubmitRoute(deps, (installationId, repoId, prNumber) =>
    conversation.evictConversation(installationId, repoId, prNumber),
  ));
  // Mark-ready (BRIEF-43): its own per-repo gate instance, mounted BEFORE
  // readsRoute for the same single-gate reason as the submit route.
  app.route("/", markReadyRoute(deps));
  // Inline post-now (BRIEF-43 PR 4): a posted inline comment is a conversation
  // write, so its success evicts the PR's conversation cache. Own per-repo
  // gate, mounted BEFORE readsRoute for the same single-gate reason.
  app.route("/", inlineCommentRoute(deps, (installationId, repoId, prNumber) =>
    conversation.evictConversation(installationId, repoId, prNumber),
  ));
  app.route("/", conversation.app);
  app.route("/", readsRoute(deps));
  return app;
}
