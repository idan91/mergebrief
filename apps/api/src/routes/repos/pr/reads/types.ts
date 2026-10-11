import type { RevisionComparisons, RevisionView } from "contract";
import type { GitHubApiError } from "github";
import type { Logger } from "logging";
import type { AppDatabase, ArtifactStore, TenantRepository } from "persistence";
import type { DraftPolicy, Result } from "types";
import type { FailureKinds } from "../../../../shared-errors/failures";
import type { LiveFactsReader } from "../../../live-read/types";
import type { PrView } from "../../../pr-view";

/** Narrow slices only, never full `AppDeps`. */
export interface ReadsControllerDeps {
  readonly tenant: TenantRepository;
  readonly artifacts: ArtifactStore;
}

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

/** Result-side failures of the live diff proxy; the handler owns posture. */
export type DiffFailure =
  | { readonly kind: typeof FailureKinds.TOKEN_UNREADABLE }
  | {
      readonly kind: typeof FailureKinds.GITHUB_DENIED;
      readonly error: GitHubApiError;
    };

/** Result-side failures of the live stack read; the same two the diff proxy has. */
export type StackFailure = DiffFailure;

/** Result-side failures of the file-range read; the handler owns posture. */
export type FileRangeFailure =
  | DiffFailure
  | { readonly kind: "file-absent" }
  | { readonly kind: "file-too-large" }
  | { readonly kind: "file-not-text" };
