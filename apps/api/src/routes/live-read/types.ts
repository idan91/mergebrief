import type { GitHubReader } from "github";
import type { Logger } from "logging";
import type {
  AppDatabase,
  InstallationId,
  PullRequestRow,
  RepoId,
  ReviewerId,
  ScopeContext,
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
  /** The operator's reader, asked once for url rows the reader's token could not see. */
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

/**
 * Where one Inbox load reads: the reader's own url rows, and each
 * installation's rows in the repositories the reader's token can see.
 */
export interface InboxReadSources {
  readonly ownerUserId: ReviewerId;
  readonly reposByInstallation: ReadonlyMap<InstallationId, readonly RepoId[]>;
}

/** One row, as the request loaded it, and where to ask GitHub about it. */
export interface PullRequestReadTarget {
  readonly scope: ScopeContext;
  readonly row: PullRequestRow;
  /** The name the gate verified for the row's repository id. */
  readonly repoFullName: string;
}

/** One row's read, and the row as the read left it. */
export interface PullRequestRead {
  readonly outcome: LiveReadOutcome;
  /** A write's return when this read wrote the row, else the row given. */
  readonly row: PullRequestRow;
}
