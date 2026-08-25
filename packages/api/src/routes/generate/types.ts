// The url-box door's internal shapes. The old in-process UrlBriefEngine port
// is gone: this door only resolves the pasted PR with the viewer's token,
// upserts the owner-scoped row, and enqueues the worker job.
import type { Logger } from "logging";
import type { AppDatabase, PullRequestRowId } from "persistence";
import type { ReviewerGitHubClient } from "../auth/reviewer-github-client";

export interface GenerateControllerDeps {
  readonly handle: AppDatabase;
  /** The per-request reviewer channel — one refresh budget for the resolve. */
  readonly github: ReviewerGitHubClient;
  /**
   * Operator PAT backstop: a GitHub App user token is installation-scoped
   * and cannot read a private repo the App is not installed on, even for the
   * repo's owner. Tried once, only after a NOT_FOUND/FORBIDDEN denial. The
   * worker holds the same backstop for the generation reads.
   */
  readonly fallbackToken?: string;
  /** Operator-facing lines only — a rejected backstop credential. */
  readonly log: Logger;
}

/** Result-side failures of the generate op; the handler owns the posture. */
export type GenerateFailure =
  | { readonly kind: "token-unreadable" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "not-found" }
  | { readonly kind: "github-unavailable" };

/** What the door returns: where the brief will render, for polling. */
export interface GenerateAccepted {
  readonly repoId: string;
  readonly prNumber: number;
}

/** The controller's result: the wire shape plus the audit-stamp row id. */
export interface GenerateOutcome extends GenerateAccepted {
  readonly pullRequestId: PullRequestRowId;
}
