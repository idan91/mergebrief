// The `/api` router — composition only, no handlers. Every path inside a
// route file is its LOCAL segment; `/api` itself exists in exactly one line
// of app.ts.
import type { Logger } from "logging";
import type { AppDatabase } from "persistence";
import type { DraftPolicy } from "types";
import type { RequestLogEnv } from "../request-logging";
import type { AuditEmitConfig } from "../product-operations/audit";
import {
  productRouter,
  type ProductRouter,
} from "../product-operations/product-router";
import { createAllowedRepoResolver } from "./allowed-repos";
import { authRoutes } from "./auth";
import type { AuthDeps } from "./auth/session";
import { generateRoute } from "./generate";
import { urlBriefRoutes } from "./briefs";
import type { InstallationGitHubPort } from "./github-port";
import { capabilitiesRoute } from "./capabilities";
import { pullsRoute } from "./pulls";
import { reposRoutes } from "./repos";
import { versionRoute } from "./version";
import { webhookRoute } from "./webhook";

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
  /** Audit knobs from persistence config; omitted = private writes on,
   * caller ip off. */
  readonly audit?: AuditEmitConfig;
  /**
   * Operator PAT backstop (`MERGEBRIEF_URL_BOX_TOKEN`) for the url-box door's
   * viewer-token resolve, the per-repo gate's second rung, and — in the
   * worker — the generation reads. Absent disables the fallback.
   */
  readonly urlBoxFallbackToken?: string | undefined;
}

/** Compose the `/api` router over injected deps. */
export function apiRoutes(deps: AppDeps): ProductRouter<RequestLogEnv> {
  const app = productRouter<RequestLogEnv>();
  app.route("/webhooks", webhookRoute(deps));
  app.route("/auth", authRoutes(deps));
  // ONE resolver instance: /pulls and /repos share the allowed-set cache, so
  // one GitHub fetch serves both inside the TTL.
  const allowedRepos = createAllowedRepoResolver(deps);
  app.route("/version", versionRoute(deps, deps.serverVersion ?? "dev"));
  app.route("/capabilities", capabilitiesRoute(deps));
  app.route("/pulls", pullsRoute(deps, allowedRepos));
  app.route("/repos", reposRoutes(deps, allowedRepos));
  // Session-gated only: the pasted URL's repo is outside the installation
  // model, so the engine's viewer-token fetch is the access check.
  app.route("/generate", generateRoute(deps, deps.urlBoxFallbackToken));
  app.route("/briefs", urlBriefRoutes(deps));
  return app;
}
