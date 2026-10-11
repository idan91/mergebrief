import type { OpenPullRequest } from "brief-core/pr-stack";
import type { UserInstallation } from "github";
import type { Logger } from "logging";
import type {
  AppDatabase,
  InboxFilters,
  InboxRow,
  RepoId,
  ReviewerId,
} from "persistence";
import { type InboxSort, type InboxLayout } from "types/inbox";
import type {
  AccessibleInstallationsResolver,
  AccessibleSetFailure,
} from "../auth/accessible-installations";
import type {
  InstallationResolver,
  ResolverFailure,
} from "../installation-resolver";
import type { LiveFactsReader } from "../live-read/types";
import type { TtlCache } from "../ttl-cache";
import type { LiveStacks } from "./logic/live-stacks";

/** Narrow slices only, never `AppDeps`. */
export interface ListInboxDeps {
  readonly handle: AppDatabase;
  readonly installations: AccessibleInstallationsResolver;
  readonly repos: InstallationResolver;
  /** The Inbox's own open lists, viewer token only, apart from the stack read's. */
  readonly openPullsCache: TtlCache<readonly OpenPullRequest[]>;
  /** The operator's reader for the viewer's own url rows; absent when unlisted. */
  readonly operator: LiveFactsReader | undefined;
  /** The App's URL name; absent composes no Install link. */
  readonly githubAppSlug: string | undefined;
  readonly log: Logger;
}

/** The resolvers and the open-list cache the app builds once and shares. */
export type InboxShared = Pick<
  ListInboxDeps,
  "installations" | "repos" | "openPullsCache"
>;

/** The reachable set or the readable repositories could not be read. */
export type ListInboxFailure = AccessibleSetFailure | ResolverFailure;

export interface InboxPageDeps {
  readonly handle: AppDatabase;
  /** The page rows' stacks as GitHub lists them now. */
  readonly readLiveStacks: (rows: readonly InboxRow[]) => Promise<LiveStacks>;
}

export interface InboxPageInput {
  /** The installations the viewer reaches, as GitHub answered. */
  readonly installations: readonly UserInstallation[];
  /** The repositories the viewer may read across them, as GitHub answered. */
  readonly allowedRepoIds: readonly RepoId[];
  /** The subset of `allowedRepoIds` the viewer administers on GitHub. */
  readonly adminRepoIds: ReadonlySet<RepoId>;
  readonly reviewerId: ReviewerId;
  readonly reviewerLogin: string | null;
  readonly filters: InboxFilters;
  readonly sort: InboxSort;
  readonly layout: InboxLayout;
  /** One-based. */
  readonly page: number;
  /** The App's URL name; absent composes no Install link. */
  readonly githubAppSlug: string | undefined;
}
