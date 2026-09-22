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
import {
  InboxAuthorFilters,
  InboxReviewStates,
  InboxSorts,
  InboxStatuses,
  type InboxAuthorFilter,
  type InboxReviewState,
  type InboxSort,
  type InboxStatus,
} from "types/inbox";
import { type AppDatabase, internal } from "../db/handle";
import { brief } from "../schema/brief";
import { pullRequest } from "../schema/pull-request";
import { reviewSession } from "../schema/review-session";
import { reviewSubmittedReview } from "../schema/review-submitted-review";
import type { PullRequestRow } from "./tenant";
import {
  PrStates,
  PullRequestSources,
  type BriefRowId,
  type InstallationId,
  type RepoId,
  type ReviewerId,
} from "../types";

export interface InboxFilters {
  /** Empty means every status. */
  readonly statuses: readonly InboxStatus[];
  readonly repoIds?: readonly RepoId[];
  readonly reviewStates?: readonly InboxReviewState[];
  readonly author: InboxAuthorFilter;
  /** A subset of the reachable installations; absent means all of them. */
  readonly installationIds?: readonly InstallationId[];
}

/** `page` and `pageSize` are whole numbers of at least 1; the route parses, the store asserts. */
export interface InboxListInput {
  /** The installations the viewer reaches; the installation branch. */
  readonly installationIds: readonly InstallationId[];
  /** The viewer as url-row owner; the owner branch. */
  readonly ownerUserId: ReviewerId;
  /** The viewer as reviewer; the review state's key. */
  readonly reviewerId: ReviewerId;
  /** The viewer's login; `viewerIsAuthor` compares it to the row's author. */
  readonly reviewerLogin: string | null;
  readonly filters: InboxFilters;
  readonly sort: InboxSort;
  /** One-based. */
  readonly page: number;
  readonly pageSize: number;
}

/** The latest Brief of a row, lean: never the body, only its `stack` key. */
export interface InboxBriefRef {
  readonly id: BriefRowId;
  readonly baseSha: string;
  readonly headSha: string;
  readonly createdAt: Date;
  /** The body's `stack` JSON as stored, unparsed here; null when absent. */
  readonly stack: unknown;
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

export interface InboxPage {
  readonly items: readonly InboxRow[];
  readonly page: number;
  readonly pageSize: number;
  /** Rows matching the filters, across every page. */
  readonly total: number;
  /** The four review-state totals over every viewable row, unfiltered. */
  readonly counts: InboxCounts;
}

export interface InboxStore {
  list(input: InboxListInput): Promise<InboxPage>;
}

interface StateGroup {
  readonly state: string | null;
  readonly rows: number;
}

/** The four totals from one row per state; the viewer's own rows carry none. */
function shapeCounts(groups: readonly StateGroup[]): InboxCounts {
  const counts = { new: 0, inProgress: 0, reviewed: 0, updated: 0 };
  for (const group of groups) {
    if (group.state === InboxReviewStates.NEW) counts.new = group.rows;
    if (group.state === InboxReviewStates.IN_PROGRESS) {
      counts.inProgress = group.rows;
    }
    if (group.state === InboxReviewStates.REVIEWED)
      counts.reviewed = group.rows;
    if (group.state === InboxReviewStates.UPDATED) counts.updated = group.rows;
  }
  return counts;
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
    .orderBy(desc(brief.createdAt), desc(brief.id))
    .limit(1)
    .as("latest");
}
type LatestBrief = ReturnType<typeof buildLatestBrief>;

/** Everything the list and the counts derive per row. */
interface RowFacts {
  readonly latest: LatestBrief;
  readonly reviewState: SQL<string | null>;
  readonly viewerIsAuthor: SQL<boolean>;
  readonly behind: SQL<boolean>;
}

function buildRowFacts(db: InboxDb, input: InboxListInput): RowFacts {
  const latest = buildLatestBrief(db);
  const reviewerId = input.reviewerId;
  const sessionOnLatest = sql`exists (
    select 1 from ${reviewSession} rs
    where rs.brief_id = ${latest.latestId} and rs.reviewer_id = ${reviewerId}
  )`;
  const submittedOnLatest = sql`exists (
    select 1 from ${reviewSubmittedReview} rsr
    join ${reviewSession} rs on rs.id = rsr.review_session_id
    where rs.brief_id = ${latest.latestId} and rs.reviewer_id = ${reviewerId}
  )`;
  const submittedOnOlder = sql`exists (
    select 1 from ${reviewSubmittedReview} rsr
    join ${reviewSession} rs on rs.id = rsr.review_session_id
    join ${brief} older on older.id = rs.brief_id
    where older.pull_request_id = ${pullRequest.id}
      and older.id <> ${latest.latestId}
      and rs.reviewer_id = ${reviewerId}
  )`;
  // A row whose author is unknown is nobody's own, never NULL.
  const viewerIsAuthor =
    input.reviewerLogin === null
      ? sql<boolean>`false`
      : sql<boolean>`coalesce(${pullRequest.authorLogin} = ${input.reviewerLogin}, false)`;
  const reviewState = sql<string | null>`case
    when ${viewerIsAuthor} then null
    when ${submittedOnLatest} then ${InboxReviewStates.REVIEWED}
    when ${submittedOnOlder} then ${InboxReviewStates.UPDATED}
    when ${sessionOnLatest} then ${InboxReviewStates.IN_PROGRESS}
    else ${InboxReviewStates.NEW}
  end`;
  const behind = sql<boolean>`${pullRequest.githubHeadSha} is not null
    and ${latest.latestHeadSha} is not null
    and ${pullRequest.githubHeadSha} <> ${latest.latestHeadSha}`;
  return { latest, reviewState, viewerIsAuthor, behind };
}

/** The visible row set: every reachable installation plus the viewer's url rows. */
function buildVisibility(input: InboxListInput): SQL {
  const installationBranch =
    input.installationIds.length === 0
      ? sql`false`
      : inArray(pullRequest.installationId, [...input.installationIds]);
  const ownerBranch = and(
    isNull(pullRequest.installationId),
    eq(pullRequest.ownerUserId, input.ownerUserId),
  );
  const visible = or(installationBranch, ownerBranch);
  if (visible === undefined) throw new Error("visibility composed to nothing");
  return visible;
}

/** A url row is hidden while an installation row for the same pull request is visible. */
function buildShadowing(input: InboxListInput): SQL {
  if (input.installationIds.length === 0) return sql`true`;
  const ids = sql.join(
    input.installationIds.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql`not (${pullRequest.source} = ${PullRequestSources.URL} and exists (
    select 1 from ${pullRequest} shadow
    where shadow.repo_id = ${pullRequest.repoId}
      and shadow.pr_number = ${pullRequest.prNumber}
      and shadow.installation_id in (${ids})
  ))`;
}

function buildStatusPredicate(status: InboxStatus): SQL {
  switch (status) {
    case InboxStatuses.OPEN:
      return sql`${pullRequest.state} = ${PrStates.OPEN} and not ${pullRequest.draft}`;
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
    if (anyStatus !== undefined) filters.push(anyStatus);
  }
  if (repoIds !== undefined && repoIds.length > 0) {
    filters.push(inArray(pullRequest.repoId, [...repoIds]));
  }
  if (author === InboxAuthorFilters.MINE) filters.push(facts.viewerIsAuthor);
  if (author === InboxAuthorFilters.OTHERS) {
    filters.push(sql`not ${facts.viewerIsAuthor}`);
  }
  if (installationIds !== undefined && installationIds.length > 0) {
    const chosen = or(
      inArray(pullRequest.installationId, [...installationIds]),
      isNull(pullRequest.installationId),
    );
    if (chosen !== undefined) filters.push(chosen);
  }
  return filters;
}

function buildStateFilter(input: InboxListInput, state: SQLWrapper): SQL {
  const { reviewStates } = input.filters;
  if (reviewStates === undefined || reviewStates.length === 0) return sql`true`;
  const literals = sql.join(
    reviewStates.map((value) => sql`${value}`),
    sql`, `,
  );
  return sql`${state} in (${literals})`;
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
  filtered: boolean,
) {
  const { latest } = facts;
  const visible = buildVisibility(input);
  const shadowing = buildShadowing(input);
  const matchesRows = and(...rowFilters) ?? sql`true`;
  const where = filtered
    ? and(visible, shadowing, matchesRows)
    : and(visible, shadowing);

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
      matchesRows: sql<boolean>`${matchesRows}`.as("matches_rows"),
    })
    .from(pullRequest)
    .leftJoinLateral(latest, sql`true`)
    .where(where)
    .as("viewable");
}
type Viewable = ReturnType<typeof buildViewable>;

/** The fold: rows the reviewer still owes work lead; reviewed and own rows follow. */
const FOLD_STATES = [
  InboxReviewStates.NEW,
  InboxReviewStates.UPDATED,
  InboxReviewStates.IN_PROGRESS,
];

function buildListQuery(db: InboxDb, input: InboxListInput, page: Viewable) {
  const foldStates = sql.join(
    FOLD_STATES.map((state) => sql`${state}`),
    sql`, `,
  );
  const needsViewer = sql<boolean>`coalesce(${page.reviewState} in (${foldStates}), false)`;
  const sortColumn =
    input.sort === InboxSorts.GENERATED
      ? page.latestCreatedAt
      : page.githubUpdatedAt;
  const offset = (input.page - 1) * input.pageSize;

  return db
    .select()
    .from(page)
    .where(buildStateFilter(input, page.reviewState))
    .orderBy(
      desc(needsViewer),
      sql`${sortColumn} desc nulls last`,
      desc(page.id),
    )
    .limit(input.pageSize)
    .offset(offset);
}
type SelectedRow = Awaited<ReturnType<typeof buildListQuery>>[number];

/**
 * The page's stack snapshots, read after the sort and the limit: the body
 * is TOASTed and parsing it per viewable row would cost more than the page.
 * A body that is not JSON yields null rather than failing the list;
 * `pg_input_is_valid` is why the floor is Postgres 16. The ids carry no
 * scope predicate because the list just authorized every one of them.
 */
async function readStacks(
  db: InboxDb,
  rows: readonly SelectedRow[],
): Promise<ReadonlyMap<BriefRowId, unknown>> {
  const briefIds = rows
    .map((row) => row.latestId)
    .filter((id): id is BriefRowId => id !== null);
  if (briefIds.length === 0) return new Map();

  const stacks = await db
    .select({
      id: brief.id,
      stack: sql<unknown>`case when pg_input_is_valid(${brief.body}, 'jsonb')
        then (${brief.body})::jsonb -> 'stack' end`,
    })
    .from(brief)
    .where(inArray(brief.id, briefIds));
  return new Map(stacks.map((row) => [row.id, row.stack]));
}

function shapeRow(
  row: SelectedRow,
  stacks: ReadonlyMap<BriefRowId, unknown>,
): InboxRow {
  const {
    latestId,
    latestBaseSha,
    latestHeadSha,
    latestCreatedAt,
    reviewState,
    viewerIsAuthor,
    behind,
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
        stack: stacks.get(latestId) ?? null,
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

  return {
    async list(input) {
      const pageValid =
        Number.isInteger(input.page) && Number.isInteger(input.pageSize);
      if (!pageValid || input.page < 1 || input.pageSize < 1) {
        throw new Error("inbox list takes whole pages of at least 1");
      }
      const facts = buildRowFacts(db, input);
      const rowFilters = buildRowFilters(input, facts);

      const page = buildViewable(db, input, facts, rowFilters, true);
      const listQuery = buildListQuery(db, input, page);

      // One pass over every viewable row answers the four state counts and
      // the filtered total together, whatever page was asked for.
      const viewable = buildViewable(db, input, facts, rowFilters, false);
      const matches = and(
        viewable.matchesRows,
        buildStateFilter(input, viewable.reviewState),
      );
      const countsQuery = db
        .select({
          state: viewable.reviewState,
          rows: sql<number>`count(*)::int`,
          matching: sql<number>`count(*) filter (where ${matches})::int`,
        })
        .from(viewable)
        .groupBy(viewable.reviewState);

      const [rows, grouped] = await Promise.all([listQuery, countsQuery]);
      const stacks = await readStacks(db, rows);

      return {
        items: rows.map((row) => shapeRow(row, stacks)),
        page: input.page,
        pageSize: input.pageSize,
        total: grouped.reduce((sum, group) => sum + group.matching, 0),
        counts: shapeCounts(grouped),
      };
    },
  };
}
