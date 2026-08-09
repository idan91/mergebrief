// Dependencies are INJECTED: this module never reads `process.env` and never
// constructs a DB.
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import type { Logger } from "logging";
import type { AppDatabase } from "persistence";
import type { DraftPolicy } from "types";
import { requestLogging, type RequestLogEnv } from "./request-logging";
import { authRoute, type AuthDeps } from "./routes/auth";
import { collaboratorsRoute } from "./routes/collaborators";
import { conversationRoutes } from "./routes/conversation";
import type { InstallationGitHubPort } from "./routes/github-port";
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
import { generateRoute, type UrlBriefEngine } from "./routes/generate";
import { resolveThreadRoute } from "./routes/resolve-thread";
import { webhookRoute } from "./routes/webhook";

export type { AuthDeps } from "./routes/auth";

export interface AppDeps {
  readonly handle: AppDatabase;
  readonly webhookSecret: string;
  /** Routes reach the per-request child via `c.get("logger")`, never a global. */
  readonly logger: Logger;
  /** Reviewer-auth bundle (OAuth creds, crypto boundary, cookie/redirect policy). */
  readonly auth: AuthDeps;
  /** Installation-octokit interface for the installation-token reads. */
  readonly github: InstallationGitHubPort;
  /** Exposed by GET /api/version for skew visibility. */
  readonly serverVersion?: string;
  /** Instance draft-PR policy; omitted = zero-config default. */
  readonly draftPolicy?: DraftPolicy;
  /** Omitted (worker-less / test deployments) ⇒ POST /api/generate answers a curated 503. */
  readonly urlBriefEngine?: UrlBriefEngine;
}

/** The built API app's concrete type (request-log env at the root). */
export type ApiApp = Hono<RequestLogEnv>;

/** Build the API app over injected deps. */
export function createApp(deps: AppDeps): ApiApp {
  const app = new Hono<RequestLogEnv>();
  // Request id + the one api.access line per request; every route below reads
  // its child logger from context.
  app.use(requestId());
  app.use(requestLogging(deps.logger));
  app.route("/", webhookRoute(deps));
  app.route("/", authRoute(deps));
  app.route("/", installationsRoute(deps));
  app.route("/", tokensRoute(deps));
  // ONE resolver instance: /api/pulls and /api/repos share the allowed-set
  // cache, so one GitHub fetch serves both inside the TTL.
  const allowedRepos = createAllowedRepoResolver(deps);
  app.route("/", versionRoute(deps, deps.serverVersion ?? "dev"));
  app.route("/", pullsRoute(deps, allowedRepos));
  // Mounted BEFORE readsRoute (single-gate rule); exact path, no :repoId.
  app.route("/", reposRoute(deps, allowedRepos));
  // Every `/api/repos/:repoId/*` module mounts BEFORE readsRoute: readsRoute's
  // gate is method-agnostic, so mounting after it stacks a second gate (two
  // cold access checks; a transient failure on the second 404s a just-verified
  // request).
  // Conversation built first so the write routes below can evict the PR's
  // conversation cache on their success paths.
  const conversation = conversationRoutes(deps);
  app.route(
    "/",
    reviewSubmitRoute(deps, (installationId, repoId, prNumber) =>
      conversation.evictConversation(installationId, repoId, prNumber),
    ),
  );
  app.route("/", markReadyRoute(deps));
  app.route(
    "/",
    inlineCommentRoute(deps, (installationId, repoId, prNumber) =>
      conversation.evictConversation(installationId, repoId, prNumber),
    ),
  );
  app.route(
    "/",
    resolveThreadRoute(deps, (installationId, repoId, prNumber) =>
      conversation.evictConversation(installationId, repoId, prNumber),
    ),
  );
  app.route("/", collaboratorsRoute(deps));
  // Session-gated only: the pasted URL's repo is outside the installation
  // model, so the engine's viewer-token fetch is the access check.
  app.route("/", generateRoute(deps, deps.urlBriefEngine));
  app.route("/", conversation.app);
  app.route("/", readsRoute(deps));
  return app;
}
