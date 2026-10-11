import type { OpenPullRequest } from "brief-core/pr-stack";
import type { RevisionComparisons, RevisionView } from "contract";
import type { GitHubCallFailure } from "github";
import type { Logger } from "logging";
import type { AppDatabase } from "persistence";
import type { DraftPolicy, Result } from "types";
import type { FailureKinds } from "../../../../shared-errors/failures";
import type { LiveFactsReader } from "../../../live-read/types";
import type { PrView } from "../../../pr-view";
import type { TtlCache } from "../../../ttl-cache";

/** The span names no artifact stored on the access step's row. */
export interface ArtifactNotFoundFailure {
  readonly kind: "not-found";
}

/** A stored body, verbatim: it is already JSON. */
export type ReadArtifactResult = Result<string, ArtifactNotFoundFailure>;

export interface ReadPullDeps {
  readonly handle: AppDatabase;
  readonly draftPolicy: DraftPolicy;
  /** Present only behind an operator pass, for what the viewer could not see. */
  readonly operator?: LiveFactsReader | undefined;
  readonly log: Logger;
}

/** The PR view with its comparisons, revisions and instance facts. */
export interface PullMeta extends PrView {
  readonly comparisons: RevisionComparisons;
  /** The PR sits in an installation's world; the App can act on its repo. */
  readonly appInstalled: boolean;
  /** The configured window the FE shows, never a hardcoded duration. */
  readonly draftPolicy: DraftPolicy;
  readonly revisions?: RevisionView[];
}

export interface ReadDiffDeps {
  /** Diff bodies keyed per session, repo, PR and span. */
  readonly diffCache: TtlCache<string>;
}

export interface ReadFileRangeDeps {
  /** Split blobs keyed per session, repo, ref and path. */
  readonly fileCache: TtlCache<readonly string[]>;
}

export interface ReadStackDeps {
  readonly handle: AppDatabase;
  /** The repo's open PRs keyed per session and repo: one list per stack walk. */
  readonly openPullsCache: TtlCache<readonly OpenPullRequest[]>;
  readonly log: Logger;
}

/** The gate's verified slug would not split into owner and name. */
export interface RepoNameFailure {
  readonly kind: "not-found";
}

/** GitHub's refusal on the viewer's binding, riding whole. */
export interface GitHubReadFailure {
  readonly kind: typeof FailureKinds.GITHUB_DENIED;
  readonly error: GitHubCallFailure;
}

/** Result-side failures of the live diff proxy; the adapter owns posture. */
export type DiffFailure = RepoNameFailure | GitHubReadFailure;

/** Result-side failures of the live stack read; the same two the diff proxy has. */
export type StackFailure = DiffFailure;

/** Result-side failures of the file-range read; the adapter owns posture. */
export type FileRangeFailure =
  | DiffFailure
  | { readonly kind: "file-absent" }
  | { readonly kind: "file-too-large" }
  | { readonly kind: "file-not-text" };
