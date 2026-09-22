import type { Logger } from "logging";
import type { AppDatabase } from "persistence";
import type { ReviewerGitHubClient } from "../auth/reviewer-github-client";

/** Narrow slices only, never `AppDeps`. */
export interface LiveReadDeps {
  readonly handle: AppDatabase;
  readonly github: ReviewerGitHubClient;
  /** Operator PAT, tried once for rows the viewer's token could not see. */
  readonly fallbackToken?: string | undefined;
  readonly log: Logger;
  readonly waitMs?: number;
  readonly now?: () => Date;
}

/** What one read did; the rows themselves are read from the store after. */
export interface LiveReadOutcome {
  readonly read: number;
  readonly unreachable: number;
  /** Due rows left for the next read past the chunk cap. */
  readonly deferred: boolean;
  /** The ceiling passed first; the read finishes in the background. */
  readonly timedOut: boolean;
  readonly failed: boolean;
}
