import type { Context } from "hono";
import type { GitHubApiError } from "github";
import type { InstallationId } from "persistence";
import type { GitHubDeniedFailure } from "../../../shared-errors/failures";
import type { AuthRouteDeps } from "../../auth/session/types";
import type { AuthzEnv } from "../../authz";
import type { InstallationGitHubPort } from "../../github-port";

/** The fresh admin read needs the viewer's token; the delete needs the App's. */
export interface PurgeAttachmentsRouteDeps extends AuthRouteDeps {
  readonly github: InstallationGitHubPort;
}

export interface PurgeAttachmentsControllerDeps {
  readonly port: InstallationGitHubPort;
}

export interface PurgeAttachmentsInput {
  readonly installationId: InstallationId;
  readonly owner: string;
  readonly repo: string;
}

export interface PurgedAttachments {
  /** False when the repository had no attachments branch to delete. */
  readonly existed: boolean;
}

/** The App's delete, refused or failed, wrapped whole. */
export type PurgeAttachmentsFailure = GitHubDeniedFailure<GitHubApiError>;

export interface PurgeAttachmentsHandlers {
  readonly purgeAttachments: (c: Context<AuthzEnv>) => Promise<Response>;
}
