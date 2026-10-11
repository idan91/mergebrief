import type { GitHubApiError } from "github";
import type { RepoId, ScopeContext } from "persistence";
import type { ValueOf } from "types/utils";
import type { RequestLogVariables } from "../request-logging";
import type { ViewerPrincipal } from "../routes/auth/session/types";
import type { RepoWorld } from "../routes/installation-resolver";
import type { PrNumberParamResult } from "../routes/wire-bounds";

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
  readonly viewerCanPush: boolean;
  /** The Installation holding the repo among those the reviewer reaches, else the owner world. */
  readonly installation: RepoWorld;
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

/** The positive cache holds access without the principal each request brings. */
export type CachedRepoAccess =
  | Omit<ReviewerRepoAccess, "session">
  | Omit<OperatorRepoAccess, "session">;

export interface AuthzVariables extends RequestLogVariables {
  /** Session-only: the owner world. Behind the repo gate: the repo's world. */
  readonly ctx: ScopeContext;
  /** Passed on the operator PAT: per-PR routes read the reader's own rows. */
  readonly urlBoxOnly?: boolean;
  readonly session: ViewerPrincipal;
  /** The repo gate's resolved value; the vars beside it mirror its fields. */
  readonly repoAccess: RepoAccess;
  readonly repoId: RepoId;
  readonly repoFullName: string;
  /**
   * It gates the collaborators read, which has no GitHub-side backstop, so a
   * probe shape without `permissions` must keep parsing as `false`.
   */
  readonly viewerCanPush: boolean;
}

export interface AuthzEnv {
  readonly Variables: AuthzVariables;
}

export type ListedOperatorToken = string | undefined;

/** The repo a gated request names, and its PR when the path names one. */
export interface GateRequest {
  readonly repoId: RepoId;
  readonly requestedPr: PrNumberParamResult;
}

/** A request whose repo the reviewer's own token was refused. */
export interface OperatorRungRequest extends GateRequest {
  readonly error: GitHubApiError;
}
