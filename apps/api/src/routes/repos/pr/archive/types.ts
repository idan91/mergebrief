import type {
  AppDatabase,
  RepoId,
  ReviewerId,
  ScopeContext,
} from "persistence";

/** Narrow slice: the archive only touches the database. */
export interface ArchiveControllerDeps {
  readonly handle: AppDatabase;
}

export interface ArchivePullInput {
  /** The world the row lives in, as the per-PR scope resolved it. */
  readonly ctx: ScopeContext;
  readonly repoId: RepoId;
  readonly prNumber: number;
  readonly reviewerId: ReviewerId;
}

export interface ArchivePullFailure {
  readonly kind: "not-found";
}
