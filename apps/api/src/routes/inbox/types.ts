import type { UserInstallation } from "github";
import type {
  AppDatabase,
  InboxFilters,
  RepoId,
  ReviewerId,
} from "persistence";
import type { InboxSort } from "types/inbox";

/** Narrow slices only, never `AppDeps`. */
export interface InboxControllerDeps {
  readonly handle: AppDatabase;
}

export interface ListInboxInput {
  /** The installations the viewer reaches, as GitHub answered. */
  readonly installations: readonly UserInstallation[];
  /** The repositories the viewer may read across them, as GitHub answered. */
  readonly allowedRepoIds: readonly RepoId[];
  readonly reviewerId: ReviewerId;
  readonly reviewerLogin: string | null;
  readonly filters: InboxFilters;
  readonly sort: InboxSort;
  /** One-based. */
  readonly page: number;
  /** The App's URL name; absent composes no Install link. */
  readonly githubAppSlug: string | undefined;
}
