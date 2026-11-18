// The Inbox list: the ONE read that spans several scopes. A viewer reaches
// several installations, and the list is one query over every installation
// they reach plus their own url rows, with the viewer's review state, the
// fold and the sort derived in SQL so numbered pages hold across worlds.
// Every write in this package keeps one scope; nothing here writes.
import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { buildSearchTextPredicate } from "./inbox-search-text";
import { traceStore } from "./trace-store";
import {
  InboxArchivedFilters,
  InboxAuthorFilters,
  InboxFoldStates,
  InboxReviewStates,
  InboxSorts,
  InboxStatuses,
  type InboxArchivedFilter,
  type InboxAuthorFilter,
  type InboxReviewState,
  type InboxSort,
  type InboxStatus,
  InboxLayouts,
  type InboxLayout,
} from "types/inbox";
import { type AppDatabase, internal } from "../db/handle";
import { brief } from "../schema/brief";
import { checkpoint } from "../schema/checkpoint";
import { inboxArchive } from "../schema/inbox-archive";
import { pullRequest } from "../schema/pull-request";
import { reviewSession } from "../schema/review-session";
import { reviewSubmittedReview } from "../schema/review-submitted-review";
import type { PullRequestRow } from "./tenant";
import type { BriefRowId, InstallationId, RepoId, ReviewerId } from "../types";
import { PrStates, PullRequestSources } from "types/pull-requests";

/** The Repository filter's vocabulary stops here; the URL may carry no more values anyway. */
export const MAX_INBOX_REPOSITORIES = 100;

export interface InboxFilters {
  /** Empty means every status. */
  readonly statuses: readonly InboxStatus[];
  readonly repoIds?: readonly RepoId[];
  readonly reviewStates?: readonly InboxReviewState[];
  readonly author: InboxAuthorFilter;
  /** A subset of the reachable installations; absent means all of them. */
  readonly installationIds?: readonly InstallationId[];
  /** The viewer's archived rows: hidden, or the only rows listed. */
  readonly archived: InboxArchivedFilter;
  /** The words the reviewer typed; absent or blank narrows nothing. */
  readonly searchText?: string;
}

/** `page` and `pageSize` are whole numbers of at least 1; the route parses, the store asserts. */
export interface InboxListInput {
  /** The installations the viewer reaches; the installation branch. */
  readonly installationIds: readonly InstallationId[];
  /**
   * The repositories the viewer may read across those installations, as
   * GitHub answered: an installation row shows only inside this set, so a
   * private repository the viewer cannot read never lists.
   */
  readonly allowedRepoIds: readonly RepoId[];
  /** The viewer as url-row owner; the owner branch. */
  readonly ownerUserId: ReviewerId;
  /** The viewer as reviewer; the review state's key. */
  readonly reviewerId: ReviewerId;
  /** The viewer's login; `viewerIsAuthor` compares it to the row's author. */
  readonly reviewerLogin: string | null;
  readonly filters: InboxFilters;
  readonly sort: InboxSort;
  /** Folded leads with the rows that need the reviewer; mixed is the sort alone. */
  readonly layout: InboxLayout;
  /** One-based. */
  readonly page: number;
  readonly pageSize: number;
}

/** The latest Brief of a row, lean: never the body. */
export interface InboxBriefRef {
  readonly id: BriefRowId;
  readonly baseSha: string;
  readonly headSha: string;
  readonly createdAt: Date;
}

export interface InboxRow {
  readonly pullRequest: PullRequestRow;
  readonly latestBrief: InboxBriefRef | undefined;
  /** Null for the viewer's own pull requests. */
  readonly reviewState: InboxReviewState | null;
  readonly viewerIsAuthor: boolean;
  /** GitHub reports a head the latest Brief does not cover. */
  readonly behind: boolean;
}

export interface InboxCounts {
  readonly new: number;
  readonly inProgress: number;
  readonly reviewed: number;
  readonly updated: number;
}

/** One repository a viewable row names; the Repository filter's vocabulary. */
export interface InboxRepository {
  readonly repoId: RepoId;
  readonly repoSlug: string | null;
}

export interface InboxPage {
  readonly items: readonly InboxRow[];
  readonly page: number;
  readonly pageSize: number;
  /** Rows matching the filters, across every page. */
  readonly total: number;
  /** The viewer's archived rows among the viewable, whatever the filters or the view. */
  readonly archivedTotal: number;
  /** The viewable rows the search text matches, whatever the filters or the view; 0 without search text. */
  readonly searchMatchTotal: number;
  /** The rows of `searchMatchTotal` the viewer archived. */
  readonly archivedSearchMatchTotal: number;
  /** The four review-state totals over the open, non-draft, unarchived viewable rows, whatever the filters or the view. */
  readonly counts: InboxCounts;
  /** The repositories the rows in view name, unfiltered, each once, sorted by slug, at most MAX_INBOX_REPOSITORIES. */
  readonly repositories: readonly InboxRepository[];
}

export interface InboxStore {
  list(input: InboxListInput): Promise<InboxPage>;
}

/** One pass over the viewable rows, both views, grouped by state and repository. */
interface ViewableGroup {
  readonly state: string | null;
  readonly repoId: RepoId;
  readonly repoSlug: string | null;
  /** Open, not a draft, not archived. */
  readonly open: number;
  /** In the requested view and matching the filters. */
  readonly matching: number;
  /** In the requested view. */
  readonly inView: number;
  /** Archived by the viewer. */
  readonly archived: number;
  /** Matching the search text, in either view. */
  readonly searchMatches: number;
  /** Matching the search text and archived by the viewer. */
  readonly archivedSearchMatches: number;
}

/** The four totals summed over the open, non-draft, unarchived rows of each group; the viewer's own rows carry none. */
function shapeCounts(groups: readonly ViewableGroup[]): InboxCounts {
  const counts = { new: 0, inProgress: 0, reviewed: 0, updated: 0 };
  for (const group of groups) {
    if (group.state === InboxReviewStates.NEW) {
      counts.new += group.open;
    }
    if (group.state === InboxReviewStates.IN_PROGRESS) {
      counts.inProgress += group.open;
    }
    if (group.state === InboxReviewStates.REVIEWED) {
      counts.reviewed += group.open;
    }
    if (group.state === InboxReviewStates.UPDATED) {
      counts.updated += group.open;
    }
  }
  return counts;
}

/** Each repository with a row in view once, a named slug winning over none, sorted by slug and capped. */
function shapeRepositories(
  groups: readonly ViewableGroup[],
): readonly InboxRepository[] {
  const byId = new Map<RepoId, InboxRepository>();
  for (const group of groups) {
    if (group.inView === 0) {
      continue;
    }
    const known = byId.get(group.repoId);
    if (
      known === undefined ||
      (known.repoSlug === null && group.repoSlug !== null)
    ) {
      byId.set(group.repoId, {
        repoId: group.repoId,
        repoSlug: group.repoSlug,
      });
    }
  }
  return [...byId.values()]
    .toSorted((first, second) =>
      readRepositoryLabel(first).localeCompare(readRepositoryLabel(second)),
    )
    .slice(0, MAX_INBOX_REPOSITORIES);
}

function readRepositoryLabel(repository: InboxRepository): string {
  return repository.repoSlug ?? String(repository.repoId);
}

function isInboxReviewState(value: string): value is InboxReviewState {
  return Object.values(InboxReviewStates).some((state) => state === value);
}

type InboxDb = ReturnType<typeof internal>;

/** The row's latest Brief, joined laterally so the sort and the state can read it. */
function buildLatestBrief(db: InboxDb) {
  // Aliased by hand: a subquery column keeps its table name, and `id`,
  // `base_sha` and `created_at` all collide with the pull request's.
  return db
    .select({
      latestId: sql`${brief.id}`.mapWith(brief.id).as("latest_id"),
      latestBaseSha: sql`${brief.baseSha}`
        .mapWith(brief.baseSha)
        .as("latest_base_sha"),
      latestHeadSha: sql`${brief.headSha}`
        .mapWith(brief.headSha)
        .as("latest_head_sha"),
      latestCreatedAt: sql`${brief.createdAt}`
        .mapWith(brief.createdAt)
        .as("latest_created_at"),
    })
    .from(brief)
    .where(eq(brief.pullRequestId, pullRequest.id))
    .orderBy(desc(brief.headIndex), desc(brief.id))
    .limit(1)
    .as("latest");
}
type LatestBrief = ReturnType<typeof buildLatestBrief>;

/**
 * The viewer's last-reviewed SHA on the row: the head of the newest Brief
 * a review of theirs was submitted from after their Checkpoint, else the
 * Checkpoint's. A tie goes to the Checkpoint. One row always: the
 * aggregates answer NULL over no Checkpoint, and the subquery's `max`
 * reads that outer row.
 */
function buildLastReviewed(db: InboxDb, reviewerId: ReviewerId) {
  const submittedHead = sql`(
    select b.head_sha from ${reviewSubmittedReview} rsr
    join ${reviewSession} rs on rs.id = rsr.review_session_id
    join ${brief} b on b.id = rs.brief_id
    where b.pull_request_id = ${pullRequest.id} and rs.reviewer_id = ${reviewerId}
      and rsr.created_at > coalesce(max(${checkpoint.submittedAt}), '-infinity')
    order by b.head_index desc, b.id desc
    limit 1
  )`;
  return db
    .select({
      lastReviewedSha: sql<
        string | null
      >`coalesce(${submittedHead}, max(${checkpoint.lastSubmittedSha}))`.as(
        "last_reviewed_sha",
      ),
    })
    .from(checkpoint)
    .where(
      and(
        eq(checkpoint.pullRequestId, pullRequest.id),
        eq(checkpoint.reviewerId, reviewerId),
      ),
    )
    .as("reviewed");
}
type LastReviewed = ReturnType<typeof buildLastReviewed>;

/** Everything the list and the counts derive per row. */
interface RowFacts {
  readonly latest: LatestBrief;
  readonly reviewed: LastReviewed;
  readonly reviewState: SQL<string | null>;
  readonly viewerIsAuthor: SQL<boolean>;
  readonly behind: SQL<boolean>;
  /** The viewer archived the row at its latest brief's head. */
  readonly archived: SQL<boolean>;
}

function buildRowFacts(db: InboxDb, input: InboxListInput): RowFacts {
  const latest = buildLatestBrief(db);
  const reviewerId = input.reviewerId;
  const reviewed = buildLastReviewed(db, reviewerId);
  const lastReviewedSha = reviewed.lastReviewedSha;
  const sessionOnLatest = sql`exists (
    select 1 from ${reviewSession} rs
    where rs.brief_id = ${latest.latestId} and rs.reviewer_id = ${reviewerId}
  )`;
  const reviewedAtHead = sql`(${lastReviewedSha} = ${latest.latestHeadSha}
    or ${lastReviewedSha} = ${pullRequest.githubHeadSha})`;
  // A row whose author is unknown is nobody's own, never NULL.
  const viewerIsAuthor =
    input.reviewerLogin === null
      ? sql<boolean>`false`
      : sql<boolean>`coalesce(${pullRequest.authorLogin} = ${input.reviewerLogin}, false)`;
  const reviewState = sql<string | null>`case
    when ${viewerIsAuthor} then null
    when ${reviewedAtHead} then ${InboxReviewStates.REVIEWED}
    when ${lastReviewedSha} is not null then ${InboxReviewStates.UPDATED}
    when ${sessionOnLatest} then ${InboxReviewStates.IN_PROGRESS}
    else ${InboxReviewStates.NEW}
  end`;
  const behind = sql<boolean>`${pullRequest.githubHeadSha} is not null
    and ${latest.latestHeadSha} is not null
    and ${pullRequest.githubHeadSha} <> ${latest.latestHeadSha}`;
  // Anchored on the head: a brief at a new head lifts the archive on its own.
  const archived = sql<boolean>`exists (
    select 1 from ${inboxArchive} ia
    where ia.pull_request_id = ${pullRequest.id}
      and ia.reviewer_id = ${reviewerId}
      and ia.head_sha is not distinct from ${latest.latestHeadSha}
  )`;
  return {
    latest,
    reviewed,
    reviewState,
    viewerIsAuthor,
    behind,
    archived,
  };
}

function canReachInstallations(input: InboxListInput): boolean {
  return input.installationIds.length > 0 && input.allowedRepoIds.length > 0;
}

/** One bind parameter however many ids: a viewer's readable repos can run to thousands. */
function matchesAnyId(column: SQLWrapper, ids: readonly bigint[]): SQL {
  return sql`${column} = any(${sql.param(ids.map(String))}::bigint[])`;
}

/** The visible row set: the readable repos of every reachable installation plus the viewer's url rows. */
function buildVisibility(input: InboxListInput): SQL {
  const installationBranch = canReachInstallations(input)
    ? and(
        matchesAnyId(pullRequest.installationId, input.installationIds),
        matchesAnyId(pullRequest.repoId, input.allowedRepoIds),
      )
    : sql`false`;
  const ownerBranch = and(
    isNull(pullRequest.installationId),
    eq(pullRequest.ownerUserId, input.ownerUserId),
  );
  const visible = or(installationBranch, ownerBranch);
  if (visible === undefined) {
    throw new Error("visibility composed to nothing");
  }
  return visible;
}

/** A url row is hidden while an installation row for the same pull request is visible. */
function buildShadowing(input: InboxListInput): SQL {
  if (!canReachInstallations(input)) {
    return sql`true`;
  }
  const shadowInstallation = sql`shadow.installation_id`;
  const shadowRepo = sql`shadow.repo_id`;
  return sql`not (${pullRequest.source} = ${PullRequestSources.URL} and exists (
    select 1 from ${pullRequest} shadow
    where shadow.repo_id = ${pullRequest.repoId}
      and shadow.pr_number = ${pullRequest.prNumber}
      and ${matchesAnyId(shadowInstallation, input.installationIds)}
      and ${matchesAnyId(shadowRepo, input.allowedRepoIds)}
  ))`;
}

/** Open and not a draft: the one row shape a review can still be owed on. */
function buildOpenPredicate(state: SQLWrapper, draft: SQLWrapper): SQL {
  return sql`${state} = ${PrStates.OPEN} and not ${draft}`;
}

function buildStatusPredicate(status: InboxStatus): SQL {
  switch (status) {
    case InboxStatuses.OPEN:
      return buildOpenPredicate(pullRequest.state, pullRequest.draft);
    case InboxStatuses.DRAFT:
      return sql`${pullRequest.state} = ${PrStates.OPEN} and ${pullRequest.draft}`;
    case InboxStatuses.MERGED:
      return eq(pullRequest.state, PrStates.MERGED);
    case InboxStatuses.CLOSED:
      return eq(pullRequest.state, PrStates.CLOSED);
  }
}

/** The filters that read the row alone; the review-state filter reads the derived state. */
function buildRowFilters(input: InboxListInput, facts: RowFacts): SQL[] {
  const filters: SQL[] = [];
  const { statuses, repoIds, author, installationIds } = input.filters;

  if (statuses.length > 0) {
    const anyStatus = or(...statuses.map(buildStatusPredicate));
    if (anyStatus !== undefined) {
      filters.push(anyStatus);
    }
  }
  if (repoIds !== undefined && repoIds.length > 0) {
    filters.push(inArray(pullRequest.repoId, [...repoIds]));
  }
  if (author === InboxAuthorFilters.MINE) {
    filters.push(facts.viewerIsAuthor);
  }
  if (author === InboxAuthorFilters.OTHERS) {
    filters.push(sql`not ${facts.viewerIsAuthor}`);
  }
  if (installationIds !== undefined && installationIds.length > 0) {
    const chosen = or(
      inArray(pullRequest.installationId, [...installationIds]),
      isNull(pullRequest.installationId),
    );
    if (chosen !== undefined) {
      filters.push(chosen);
    }
  }
  const matchesSearch = buildSearchTextPredicate(input.filters.searchText, {
    title: pullRequest.title,
    prNumber: pullRequest.prNumber,
  });
  if (matchesSearch !== undefined) {
    filters.push(matchesSearch);
  }
  return filters;
}

function buildStateFilter(input: InboxListInput, state: SQLWrapper): SQL {
  const { reviewStates } = input.filters;
  if (reviewStates === undefined || reviewStates.length === 0) {
    return sql`true`;
  }
  const literals = sql.join(
    reviewStates.map((value) => sql`${value}`),
    sql`, `,
  );
  return sql`${state} in (${literals})`;
}

function buildArchivedPredicate(
  archived: SQLWrapper,
  view: InboxArchivedFilter,
): SQL {
  return view === InboxArchivedFilters.ONLY
    ? sql`${archived}`
    : sql`not ${archived}`;
}

interface ViewableScope {
  /** Only the rows the filters match. */
  readonly filtered: boolean;
  /** Only the rows of the requested view; off, both views and the `archived` column tells them apart. */
  readonly inView: boolean;
}

/**
 * The viewable rows with their facts, the one place the state is named.
 * Postgres inlines the subquery; the sort key is evaluated once per row
 * and the select list only for the page after the sort.
 */
function buildViewable(
  db: InboxDb,
  input: InboxListInput,
  facts: RowFacts,
  rowFilters: readonly SQL[],
  scope: ViewableScope,
) {
  const { latest, reviewed } = facts;
  const conditions = [buildVisibility(input), buildShadowing(input)];
  if (scope.inView) {
    conditions.push(
      buildArchivedPredicate(facts.archived, input.filters.archived),
    );
  }
  const matchesRows = and(...rowFilters) ?? sql`true`;
  if (scope.filtered) {
    conditions.push(matchesRows);
  }

  return db
    .select({
      ...getTableColumns(pullRequest),
      latestId: latest.latestId,
      latestBaseSha: latest.latestBaseSha,
      latestHeadSha: latest.latestHeadSha,
      latestCreatedAt: latest.latestCreatedAt,
      reviewState: facts.reviewState.as("review_state"),
      viewerIsAuthor: facts.viewerIsAuthor.as("viewer_is_author"),
      behind: facts.behind.as("behind"),
      archived: facts.archived.as("archived"),
      matchesRows: sql<boolean>`${matchesRows}`.as("matches_rows"),
    })
    .from(pullRequest)
    .leftJoinLateral(latest, sql`true`)
    .leftJoinLateral(reviewed, sql`true`)
    .where(and(...conditions))
    .as("viewable");
}
type Viewable = ReturnType<typeof buildViewable>;

/** The fold: open, non-draft rows in a fold state lead; the rest follow. */
function buildListQuery(db: InboxDb, input: InboxListInput, page: Viewable) {
  const foldStates = sql.join(
    Object.values(InboxFoldStates).map((state) => sql`${state}`),
    sql`, `,
  );
  const open = buildOpenPredicate(page.state, page.draft);
  const needsViewer = sql<boolean>`coalesce(${page.reviewState} in (${foldStates}) and ${open}, false)`;
  const sortColumn =
    input.sort === InboxSorts.GENERATED
      ? page.latestCreatedAt
      : page.githubUpdatedAt;
  const offset = (input.page - 1) * input.pageSize;
  const foldFirst =
    input.layout === InboxLayouts.FOLDED ? [desc(needsViewer)] : [];

  return db
    .select()
    .from(page)
    .where(buildStateFilter(input, page.reviewState))
    .orderBy(...foldFirst, sql`${sortColumn} desc nulls last`, desc(page.id))
    .limit(input.pageSize)
    .offset(offset);
}
type SelectedRow = Awaited<ReturnType<typeof buildListQuery>>[number];

function shapeRow(row: SelectedRow): InboxRow {
  const {
    latestId,
    latestBaseSha,
    latestHeadSha,
    latestCreatedAt,
    reviewState,
    viewerIsAuthor,
    behind,
    archived: _archived,
    matchesRows: _matchesRows,
    ...pullRequestRow
  } = row;
  const hasBrief =
    latestId !== null &&
    latestBaseSha !== null &&
    latestHeadSha !== null &&
    latestCreatedAt !== null;
  const latestBrief: InboxBriefRef | undefined = hasBrief
    ? {
        id: latestId,
        baseSha: latestBaseSha,
        headSha: latestHeadSha,
        createdAt: latestCreatedAt,
      }
    : undefined;
  const state =
    reviewState !== null && isInboxReviewState(reviewState)
      ? reviewState
      : null;
  return {
    pullRequest: pullRequestRow,
    latestBrief,
    reviewState: state,
    viewerIsAuthor,
    behind,
  };
}

export function createInboxStore(handle: AppDatabase): InboxStore {
  const db = internal(handle);

  return traceStore("inbox", {
    async list(input) {
      const pageValid =
        Number.isInteger(input.page) && Number.isInteger(input.pageSize);
      if (!pageValid || input.page < 1 || input.pageSize < 1) {
        throw new Error("inbox list takes whole pages of at least 1");
      }
      const facts = buildRowFacts(db, input);
      const rowFilters = buildRowFilters(input, facts);

      const page = buildViewable(db, input, facts, rowFilters, {
        filtered: true,
        inView: true,
      });
      const listQuery = buildListQuery(db, input, page);

      // One pass over every viewable row of both views answers the four
      // state counts, the filtered total, the archived total and the
      // repository vocabulary together, whatever page was asked for.
      const viewable = buildViewable(db, input, facts, rowFilters, {
        filtered: false,
        inView: false,
      });
      const inView = buildArchivedPredicate(
        viewable.archived,
        input.filters.archived,
      );
      const matches = and(
        viewable.matchesRows,
        buildStateFilter(input, viewable.reviewState),
        inView,
      );
      const open = sql`${buildOpenPredicate(viewable.state, viewable.draft)} and not ${viewable.archived}`;
      const searchPredicate = buildSearchTextPredicate(
        input.filters.searchText,
        {
          title: viewable.title,
          prNumber: viewable.prNumber,
        },
      );
      const matchesSearch = searchPredicate ?? sql`false`;
      const groupsQuery = db
        .select({
          state: viewable.reviewState,
          repoId: viewable.repoId,
          repoSlug: sql<string | null>`max(${viewable.repoSlug})`,
          open: sql<number>`count(*) filter (where ${open})::int`,
          matching: sql<number>`count(*) filter (where ${matches})::int`,
          inView: sql<number>`count(*) filter (where ${inView})::int`,
          archived: sql<number>`count(*) filter (where ${viewable.archived})::int`,
          searchMatches: sql<number>`count(*) filter (where ${matchesSearch})::int`,
          archivedSearchMatches: sql<number>`count(*) filter (where ${matchesSearch} and ${viewable.archived})::int`,
        })
        .from(viewable)
        .groupBy(viewable.reviewState, viewable.repoId);

      const [rows, grouped] = await Promise.all([listQuery, groupsQuery]);
      const total = grouped.reduce((sum, group) => sum + group.matching, 0);
      const archivedTotal = grouped.reduce(
        (sum, group) => sum + group.archived,
        0,
      );
      const searchMatchTotal = grouped.reduce(
        (sum, group) => sum + group.searchMatches,
        0,
      );
      const archivedSearchMatchTotal = grouped.reduce(
        (sum, group) => sum + group.archivedSearchMatches,
        0,
      );

      return {
        items: rows.map((row) => shapeRow(row)),
        page: input.page,
        pageSize: input.pageSize,
        total,
        archivedTotal,
        searchMatchTotal,
        archivedSearchMatchTotal,
        counts: shapeCounts(grouped),
        repositories: shapeRepositories(grouped),
      };
    },
  });
}
