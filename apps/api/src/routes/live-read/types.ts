import type { GitHubReader } from "github";
import type { Logger } from "logging";
import type {
  AppDatabase,
  OwnerContext,
  PullRequestRow,
  ReviewerId,
} from "persistence";

/** The one GitHub read the live read makes, on whichever credential. */
export type LiveFactsReader = Pick<GitHubReader, "readPullRequestFacts">;

/** Narrow slices only, never `AppDeps`. */
export interface LiveReadDeps {
  readonly handle: AppDatabase;
  /** The reader's own GitHub. */
  readonly github: LiveFactsReader;
  /** Whose token reads: the cooldown and the in-flight join are keyed by it. */
  readonly readerId: ReviewerId;
  /** The operator's reader, asked once for rows the reader's token could not see. */
  readonly operator?: LiveFactsReader | undefined;
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

/** One url row, as the request loaded it, and where to ask GitHub about it. */
export interface UrlRowTarget {
  readonly scope: OwnerContext;
  readonly row: PullRequestRow;
  /** The name the gate verified for the row's repository id. */
  readonly repoFullName: string;
}

/** One row's read, and the row as the read left it. */
export interface UrlRowRead {
  readonly outcome: LiveReadOutcome;
  /** A write's return when this read wrote the row, else the row given. */
  readonly row: PullRequestRow;
}
