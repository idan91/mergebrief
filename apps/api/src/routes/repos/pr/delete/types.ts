import type { AppDatabase, RepoId, ReviewerId } from "persistence";
import type { RowPurgeFailure } from "../../../purge-row";

/** Narrow slice: the delete only touches the database. */
export interface DeleteControllerDeps {
  readonly handle: AppDatabase;
}

export interface DeletePullInput {
  readonly repoId: RepoId;
  readonly prNumber: number;
  /** The viewer, named on the purge's audit row. */
  readonly reviewerId: ReviewerId;
}

export type DeletePullFailure = RowPurgeFailure;
