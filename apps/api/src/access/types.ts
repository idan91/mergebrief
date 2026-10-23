import type {
  GitHubApiError,
  GitHubCallFailure,
  InstallationGitHub,
  InstallationPresence,
  ReviewerGitHub,
} from "github";
import type {
  InstallationId,
  PullRequestRow,
  RepoId,
  ScopeContext,
} from "persistence";
import type { Result, ValueOf } from "types/utils";
import type { RequestLogVariables } from "../request-logging";
import type { ViewerPrincipal } from "../routes/auth/session/types";
import type { RepoWorld } from "../routes/installation-resolver";
import type { PrNumberParamResult } from "../routes/wire-bounds";
import type { SessionCredential } from "./session-credential";

/** Whose GitHub token proved the repo readable. */
export const AccessFootings = {
  REVIEWER: "reviewer",
  OPERATOR: "operator",
} as const;
export type AccessFooting = ValueOf<typeof AccessFootings>;

interface RepoAccessFields {
  readonly footing: AccessFooting;
  readonly session: ViewerPrincipal;
  readonly repoId: RepoId;
  /** `owner/name` as GitHub verified it, ≤60s stale; a rename can repoint the row's slug. */
  readonly repoFullName: string;
  /**
   * It gates the collaborators read, which has no GitHub-side backstop, so a
   * probe shape without `permissions` must keep parsing as `false`.
   */
  readonly viewerCanPush: boolean;
  /** The Installation holding the repo among those the reviewer reaches, else the owner world. */
  readonly installation: RepoWorld;
  /** The request's credential; `session()` is the principal after a renewal. */
  readonly credential: SessionCredential;
  /** The viewer's GitHub for this request: no decrypt and no call until one runs. */
  readonly github: ReviewerGitHub;
}

export interface ReviewerRepoAccess extends RepoAccessFields {
  readonly footing: typeof AccessFootings.REVIEWER;
}

export interface OperatorRepoAccess extends RepoAccessFields {
  readonly footing: typeof AccessFootings.OPERATOR;
  /** The PR this pass was granted for; every other PR re-runs the gate. */
  readonly prNumber: number;
  readonly viewerCanPush: false;
}

export type RepoAccess = ReviewerRepoAccess | OperatorRepoAccess;

interface PullRequestFields {
  readonly prNumber: number;
  /** The scope the row lives in: the repo's Installation first, else a URL owner's. */
  readonly rowScope: ScopeContext;
  /** A request-start snapshot: a write answers from its own return, never this. */
  readonly row: PullRequestRow;
}

/** The repo gate's access plus the pull request row it names. */
export type PullRequestAccess = RepoAccess & PullRequestFields;

/** What each request binds afresh: the principal and its GitHub. */
type RequestBoundField = "session" | "credential" | "github";

export type CachedReviewerRepoAccess = Omit<
  ReviewerRepoAccess,
  RequestBoundField
>;
export type CachedOperatorRepoAccess = Omit<
  OperatorRepoAccess,
  RequestBoundField
>;

/** The positive cache holds access without what each request binds. */
export type CachedRepoAccess =
  | CachedReviewerRepoAccess
  | CachedOperatorRepoAccess;

export interface AuthzVariables extends RequestLogVariables {
  readonly session: ViewerPrincipal;
  /** The repo gate's resolved value. */
  readonly repoAccess: RepoAccess;
}

export interface AuthzEnv {
  readonly Variables: AuthzVariables;
}

export interface PullRequestVariables extends AuthzVariables {
  readonly pullRequestAccess: PullRequestAccess;
}

export interface PullRequestEnv {
  readonly Variables: PullRequestVariables;
}

/** The App's GitHub on one Installation; composition binds it over the App client. */
export type InstallationBinder = (
  installationId: InstallationId,
) => InstallationGitHub;

/** Whether GitHub still holds the Installation, read on the App's own JWT. */
export type InstallationPresenceReader = (
  installationId: InstallationId,
) => Promise<Result<InstallationPresence, GitHubApiError>>;

export interface InstallationBindingDeps {
  readonly bindInstallationGitHub: InstallationBinder;
}

/** The repo a gated request names, and its PR when the path names one. */
export interface GateRequest {
  readonly repoId: RepoId;
  readonly requestedPr: PrNumberParamResult;
}

/** A request whose repo the reviewer's own token was refused. */
export interface OperatorRungRequest extends GateRequest {
  readonly error: GitHubCallFailure;
}
