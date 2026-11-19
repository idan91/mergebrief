import { InboxQueryKeys } from "contract";
import {
  type InboxArchivedFilter,
  InboxArchivedFilters,
  InboxFoldStates,
  type InboxSort,
  InboxSorts,
  PrStates,
} from "types";

import {
  ApiError,
  ApiErrorCodes,
  type ApiErrorCode,
} from "../../data/apiFetch";
import {
  AgeUnits,
  FailureSides,
  InboxEmptinesses,
  TitleSegmentKinds,
  type AgeUnit,
  type FailureSide,
  type InboxEmptiness,
  type InboxItem,
  type InboxPage,
  type InboxQueryParams,
  SearchMissKinds,
  type SearchMissReason,
  type TitleSegmentKind,
} from "./types";

const FIRST_PAGE = 1;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const YESTERDAY_MS = 2 * DAY_MS;
const DATE_AFTER_MS = 14 * DAY_MS;

/** The wire query for a set of params; the defaults produce no search at all. */
export function buildInboxSearch(params: InboxQueryParams): string {
  const search = new URLSearchParams();

  if (params.page !== undefined && params.page !== FIRST_PAGE) {
    search.set(InboxQueryKeys.PAGE, String(params.page));
  }
  if (params.sort !== undefined) {
    search.set(InboxQueryKeys.SORT, params.sort);
  }
  if (params.direction !== undefined) {
    search.set(InboxQueryKeys.DIRECTION, params.direction);
  }
  if (params.layout !== undefined) {
    search.set(InboxQueryKeys.LAYOUT, params.layout);
  }
  appendEach(search, InboxQueryKeys.STATE, params.state);
  appendEach(search, InboxQueryKeys.REPO, params.repo);
  appendEach(search, InboxQueryKeys.REVIEW, params.review);
  if (params.author !== undefined) {
    search.set(InboxQueryKeys.AUTHOR, params.author);
  }
  appendEach(search, InboxQueryKeys.INSTALLATION, params.installation);
  if (params.archived !== undefined) {
    search.set(InboxQueryKeys.ARCHIVED, params.archived);
  }
  if (params.q !== undefined) {
    search.set(InboxQueryKeys.SEARCH_TEXT, params.q);
  }

  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

function appendEach(
  search: URLSearchParams,
  key: string,
  values: readonly string[] | undefined,
): void {
  for (const value of values ?? []) {
    search.append(key, value);
  }
}

const ABOVE_FOLD = new Set<InboxItem["reviewState"]>(
  Object.values(InboxFoldStates),
);

export interface FoldSplit {
  readonly above: readonly InboxItem[];
  readonly below: readonly InboxItem[];
}

/** Rows that need the reviewer first, then the rest; each side keeps the server order. */
export function splitAtFold(items: readonly InboxItem[]): FoldSplit {
  const above = items.filter((item) => needsReviewer(item));
  const below = items.filter((item) => !needsReviewer(item));
  return { above, below };
}

/** A row above the fold, so the title takes Text 1: open, not a draft, in a state that needs the reviewer. */
export function needsReviewer(item: InboxItem): boolean {
  const open = item.state === PrStates.OPEN && !item.draft;
  return open && ABOVE_FOLD.has(item.reviewState);
}

/** The timestamp the age reads, by sort; a missing one falls back to the other. */
export function pickAgeAt(
  item: InboxItem,
  sort: InboxSort,
): string | undefined {
  if (sort === InboxSorts.GENERATED) {
    return item.latestBriefAt ?? item.githubUpdatedAt;
  }
  if (sort === InboxSorts.CREATED) {
    return item.githubCreatedAt ?? item.githubUpdatedAt;
  }
  return item.githubUpdatedAt ?? item.latestBriefAt;
}

export interface Age {
  readonly unit: AgeUnit;
  readonly count: number;
}

/** How long ago a stamp was, in the unit the row prints; past two weeks it is a date. */
export function formatAge(stamp: string, now: Date): Age {
  const then = Date.parse(stamp);
  const elapsed = Number.isNaN(then) ? 0 : Math.max(0, now.getTime() - then);

  if (elapsed < HOUR_MS) {
    return { unit: AgeUnits.MINUTES, count: Math.floor(elapsed / MINUTE_MS) };
  }
  if (elapsed < DAY_MS) {
    return { unit: AgeUnits.HOURS, count: Math.floor(elapsed / HOUR_MS) };
  }
  if (elapsed < YESTERDAY_MS) {
    return { unit: AgeUnits.YESTERDAY, count: 1 };
  }
  const days = Math.floor(elapsed / DAY_MS);
  if (elapsed < DATE_AFTER_MS) {
    return { unit: AgeUnits.DAYS, count: days };
  }
  return { unit: AgeUnits.DATE, count: days };
}

export interface TitleSegment {
  readonly kind: TitleSegmentKind;
  readonly text: string;
}

const CODE_SPAN = /`([^`]+)`/g;

/** GitHub shows a backtick span in a title as code; so does the row. */
export function splitTitleCode(title: string): readonly TitleSegment[] {
  const segments: TitleSegment[] = [];
  let cursor = 0;

  for (const match of title.matchAll(CODE_SPAN)) {
    const code = match[1];
    if (code === undefined) {
      continue;
    }
    if (match.index > cursor) {
      segments.push({
        kind: TitleSegmentKinds.TEXT,
        text: title.slice(cursor, match.index),
      });
    }
    segments.push({ kind: TitleSegmentKinds.CODE, text: code });
    cursor = match.index + match[0].length;
  }

  if (cursor < title.length) {
    segments.push({ kind: TitleSegmentKinds.TEXT, text: title.slice(cursor) });
  }
  return segments;
}

/** The wire code of the list's failed last read; absent while it succeeded. A codeless failure is the server's. */
export function readFailedReadCode(error: unknown): ApiErrorCode | undefined {
  if (error === null || error === undefined) {
    return undefined;
  }
  if (error instanceof ApiError) {
    return error.code;
  }
  return ApiErrorCodes.INTERNAL_ERROR;
}

/** GitHub when the API said GitHub did not answer; otherwise the server itself. */
export function readFailureSide(code: ApiErrorCode): FailureSide {
  if (code === ApiErrorCodes.GITHUB_UNAVAILABLE) {
    return FailureSides.GITHUB;
  }
  return FailureSides.SERVER;
}

/**
 * Why the page shows no rows, if it shows none. The repository vocabulary
 * names the rows in view whatever the filters, so an empty one means no row
 * of the view in any status; the archived total counts the viewer's
 * archived rows whatever the filters or the view. Rows behind a default
 * status filter the reviewer never touched are hidden, not filtered.
 */
export function readInboxEmptiness(
  page: Pick<InboxPage, "total" | "repositories" | "archivedTotal">,
  changedCount: number,
  archived: InboxArchivedFilter,
): InboxEmptiness {
  if (page.total > 0) {
    return InboxEmptinesses.ROWS;
  }
  if (archived === InboxArchivedFilters.ONLY) {
    if (page.archivedTotal === 0) {
      return InboxEmptinesses.ARCHIVED_ONLY;
    }
    // The view is itself one changed filter.
    return changedCount > 1
      ? InboxEmptinesses.FILTERED
      : InboxEmptinesses.HIDDEN_BY_DEFAULT;
  }
  if (page.repositories.length > 0) {
    return changedCount > 0
      ? InboxEmptinesses.FILTERED
      : InboxEmptinesses.HIDDEN_BY_DEFAULT;
  }
  if (page.archivedTotal > 0) {
    return InboxEmptinesses.ALL_ARCHIVED;
  }
  return InboxEmptinesses.EMPTY;
}

/**
 * Why a search shows no rows, and how many matches sit where the reviewer
 * is not looking: behind the other filters of this view first, in the other
 * view second.
 */
export function readSearchMissReason(
  page: Pick<
    InboxPage,
    "total" | "searchMatchTotal" | "archivedSearchMatchTotal"
  >,
  searchText: string,
  archived: InboxArchivedFilter,
): SearchMissReason | undefined {
  if (searchText === "" || page.total > 0) {
    return undefined;
  }
  const archivedMatches = page.archivedSearchMatchTotal;
  const inboxMatches = page.searchMatchTotal - archivedMatches;
  const archivedView = archived === InboxArchivedFilters.ONLY;
  const inView = archivedView ? archivedMatches : inboxMatches;
  const inOtherView = archivedView ? inboxMatches : archivedMatches;

  if (inView > 0) {
    return { kind: SearchMissKinds.HIDDEN_BY_FILTERS, count: inView };
  }
  if (inOtherView > 0) {
    return { kind: SearchMissKinds.IN_OTHER_VIEW, count: inOtherView };
  }
  return { kind: SearchMissKinds.NOWHERE };
}

/** One row's identity across the page: repository, number and world. */
export function readRowKey(item: InboxItem): string {
  return `${item.repoId}/${item.prNumber}/${item.source}`;
}

/**
 * Run `work` over every item with at most `limit` in flight, answering the
 * outcomes in the items' order. A rejection is the caller's to turn into an
 * outcome; one here would drop the whole batch.
 */
export async function runWithConcurrency<Item, Outcome>(
  items: readonly Item[],
  limit: number,
  work: (item: Item) => Promise<Outcome>,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  let next = 0;

  async function drain(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      outcomes[index] = await work(item);
    }
  }

  const lanes = Array.from({ length: Math.min(limit, items.length) }, () =>
    drain(),
  );
  await Promise.all(lanes);
  return outcomes;
}
