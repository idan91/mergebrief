// The `/api` router; composition only, no handlers. Every path inside a
// route file is its LOCAL segment; `/api` itself exists in exactly one line
// of app.ts.
import type { Logger } from "logging";
import type { AppDatabase } from "persistence";
import type { DraftPolicy } from "types/drafts";
import type { RequestLogVariables } from "../request-logging";
import type { AuditEmitConfig } from "../product-operations/audit";
import {
  productRouter,
  type ProductRouter,
} from "../product-operations/product-router";
import { authRoutes } from "./auth";
import { createAccessibleInstallationsResolver } from "./auth/accessible-installations";
import type { AuthDeps } from "./auth/session/types";
import { generateRoute } from "./generate";
import { inboxRoutes } from "./inbox";
import type { OpenPullRequest } from "brief-core/pr-stack";
import type { OperatorTokenConfig } from "github";
import { INBOX_OPEN_PULLS_CACHE_MAX_ENTRIES } from "./inbox/consts";
import { createTtlCache } from "./ttl-cache";
import type { InstallationGitHubPort } from "./github-port";
import type { UpdateCheck, VersionSnapshot } from "../update-check";
import { capabilitiesRoute } from "./capabilities";
import { createInstallationResolver } from "./installation-resolver";
import { reposRoutes } from "./repos";
import type { UploadQuotaLimits } from "./repos/pr/attachments/types";
import { versionDismissRoutes, versionRoute } from "./version";
import {
  stampVersionHeader,
  type VersionHeaderVariables,
} from "./version-header";
import { webhookRoute } from "./webhook";

/** The /api root env: the request log plus the principal the header reads. */
export interface ApiRoutesEnv {
  readonly Variables: RequestLogVariables & VersionHeaderVariables;
}

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
  /** The release check `GET /api/version` reads; absent answers `{version}` only. */
  readonly updateCheck?: UpdateCheck;
  /** Instance draft-PR policy; omitted = zero-config default. */
  readonly draftPolicy?: DraftPolicy;
  /** Audit knobs from persistence config; omitted = private writes on,
   * caller ip off. */
  readonly audit?: AuditEmitConfig;
  /**
   * Operator PAT backstop (`MERGEBRIEF_URL_BOX_TOKEN`) and the reviewers it
   * may be used for. Absent disables the fallback.
   */
  readonly operatorToken?: OperatorTokenConfig | undefined;
  /** The App's URL name (`GITHUB_APP_SLUG`); the Inbox builds its Install link from it. */
  readonly githubAppSlug?: string | undefined;
  /** Per-reviewer attachment upload limits; omitted = the defaults. */
  readonly attachmentQuota?: UploadQuotaLimits;
}

/** Compose the `/api` router over injected deps. */
export function apiRoutes(deps: AppDeps): ProductRouter<ApiRoutesEnv> {
  const app = productRouter<ApiRoutesEnv>();
  const serverVersion = deps.serverVersion ?? "dev";
  app.use(stampVersionHeader<ApiRoutesEnv>(serverVersion));
  app.route("/webhooks", webhookRoute(deps));
  // ONE instance of each resolver: every route shares the reachable-set and
  // allowed-set caches, so one GitHub walk serves them all inside the TTL.
  const installations = createAccessibleInstallationsResolver(deps);
  const resolver = createInstallationResolver(deps, installations);
  // The Inbox's own open-PR lists, viewer token only: the Brief page's stack
  // read may fill its cache through the operator PAT, and a list the viewer
  // cannot see must never place their rows.
  const inboxOpenPullsCache = createTtlCache<readonly OpenPullRequest[]>(
    INBOX_OPEN_PULLS_CACHE_MAX_ENTRIES,
  );
  app.route("/auth", authRoutes(deps));
  const readSnapshot = (): VersionSnapshot =>
    deps.updateCheck === undefined
      ? { version: serverVersion }
      : deps.updateCheck.snapshot();
  const versionDeps = { ...deps, readSnapshot };
  app.route("/version", versionRoute(versionDeps));
  app.route("/version/dismiss", versionDismissRoutes(versionDeps));
  app.route("/capabilities", capabilitiesRoute(deps));
  app.route("/repos", reposRoutes(deps, resolver));
  // Session-gated only: the pasted URL's repo is outside the installation
  // model, so the engine's viewer-token fetch is the access check.
  app.route("/generate", generateRoute(deps));
  app.route(
    "/inbox",
    inboxRoutes(deps, installations, resolver, inboxOpenPullsCache),
  );
  return app;
}
