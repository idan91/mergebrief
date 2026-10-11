import type { GitHubCallFailure } from "github";
import type { GitHubDeniedFailure } from "../../../shared-errors/failures";

export interface PurgedAttachments {
  /** False when the repository had no attachments branch to delete. */
  readonly existed: boolean;
}

/** The fresh read says the viewer is no repository admin. */
export interface AttachmentsAdminOnlyFailure {
  readonly kind: "not-repo-admin";
}

/** The fresh read's refusal or the App's delete's, wrapped whole, or no admin. */
export type PurgeAttachmentsFailure =
  | GitHubDeniedFailure<GitHubCallFailure>
  | AttachmentsAdminOnlyFailure;
