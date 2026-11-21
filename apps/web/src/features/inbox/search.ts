import {
  InboxQueryBounds,
  SIGN_IN_FAILURE_PARAM,
  SignInFailures,
} from "contract";
import {
  InboxArchivedFilters,
  InboxAuthorFilters,
  InboxGenerationFilters,
  InboxReviewStates,
  InboxSortDirections,
  InboxSorts,
  InboxStatuses,
  type InboxArchivedFilter,
  type InboxAuthorFilter,
  type InboxGenerationFilter,
  type InboxReviewState,
  type InboxSort,
  type InboxSortDirection,
  type InboxStatus,
  InboxLayouts,
  type InboxLayout,
} from "types/inbox";
import type { Mutable } from "types/utils";

import type {
  FilterOption,
  InboxQueryParams,
  InboxRepository,
  InboxSearch,
  InboxSearchChange,
} from "./types";

const LIST_SEPARATOR = ",";
const FIRST_PAGE = 1;
const ID_PATTERN = /^[0-9]{1,19}$/;
const MAX_PAGE = InboxQueryBounds.MAX_PAGE;
const MAX_LIST_VALUES = InboxQueryBounds.MAX_FILTER_VALUES;
const MAX_SEARCH_TEXT_LENGTH = InboxQueryBounds.MAX_SEARCH_TEXT_LENGTH;
/** Digits the router reads as a number and prints back unchanged. */
const BARE_NUMBER_PATTERN = /^(?:0|[1-9][0-9]{0,14})$/;

/** The opening view: open and draft rows, everyone's, most recently updated first. */
export const DEFAULT_STATES: readonly InboxStatus[] = [
  InboxStatuses.OPEN,
  InboxStatuses.DRAFT,
];

/** Every status the wire knows, as the address spells it. */
export const EVERY_STATUS_PARAM: string =
  Object.values(InboxStatuses).join(LIST_SEPARATOR);

/**
 * A list in the address: comma-joined as the app writes it, or repeated
 * keys as the wire spells it, which the router hands over as an array. The
 * wire refuses a longer list, so the address keeps the first values.
 */
function readList(value: unknown): readonly string[] {
  const parts = Array.isArray(value) ? value : [value];
  return parts
    .map(readListPart)
    .filter((part): part is string => part !== undefined)
    .flatMap((part) => part.split(LIST_SEPARATOR))
    .filter((part) => part !== "")
    .slice(0, MAX_LIST_VALUES);
}

/** The router decodes a digits-only value as a number; an id reads back as its digits. */
function readListPart(part: unknown): string | undefined {
  if (typeof part === "string") {
    return part;
  }
  if (typeof part === "number" && Number.isSafeInteger(part)) {
    return String(part);
  }
  return undefined;
}

function keepKnown<Value extends string>(
  values: readonly string[],
  vocabulary: Record<string, Value>,
): readonly Value[] {
  const known: readonly Value[] = Object.values(vocabulary);
  const kept: Value[] = [];
  for (const value of values) {
    const match = known.find((candidate) => candidate === value);
    if (match !== undefined && !kept.includes(match)) {
      kept.push(match);
    }
  }
  return kept;
}

function readOne<Value extends string>(
  value: unknown,
  vocabulary: Record<string, Value>,
): Value | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const [known] = keepKnown([value], vocabulary);
  return known;
}

function readPage(value: unknown): number | undefined {
  const page = typeof value === "string" ? Number(value) : value;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 2) {
    return undefined;
  }
  if (page > MAX_PAGE) {
    return undefined;
  }
  return page;
}

/** Trimmed and cut to the wire's bound by whole characters, as the API cuts it. */
export function shapeSearchText(text: string): string {
  const characters = Array.from(text.trim()).slice(0, MAX_SEARCH_TEXT_LENGTH);
  return characters.join("").trimEnd();
}

/** The router decodes `q=141`, `q=true` and `q=null` as JSON; each reads back as the text typed. */
function readSearchText(value: unknown): string | undefined {
  const typed =
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null;
  if (!typed) {
    return undefined;
  }
  const text = shapeSearchText(String(value));
  return text === "" ? undefined : text;
}

function readIds(value: unknown): readonly string[] {
  return readList(value).filter((id) => ID_PATTERN.test(id));
}

/**
 * The URL's search, read with the contract's vocabulary: an unknown value
 * is dropped, a default is omitted, so the address only ever carries a
 * choice the reviewer made.
 */
export function parseInboxSearch(search: Record<string, unknown>): InboxSearch {
  const parsed: {
    -readonly [Key in keyof InboxSearch]: InboxSearch[Key];
  } = {};
  const page = readPage(search["page"]);
  const sort = readOne(search["sort"], InboxSorts);
  const direction = readOne(search["direction"], InboxSortDirections);
  const layout = readOne(search["layout"], InboxLayouts);
  const states = keepKnown(readList(search["state"]), InboxStatuses);
  const repos = readIds(search["repo"]);
  const reviews = keepKnown(readList(search["review"]), InboxReviewStates);
  const author = readOne(search["author"], InboxAuthorFilters);
  const installations = readIds(search["installation"]);
  const archived = readOne(search["archived"], InboxArchivedFilters);
  const generation = readOne(search["generation"], InboxGenerationFilters);
  const searchText = readSearchText(search["q"]);
  const error = readOne(search[SIGN_IN_FAILURE_PARAM], SignInFailures);

  if (page !== undefined) {
    parsed.page = page;
  }
  if (sort !== undefined && sort !== InboxSorts.UPDATED) {
    parsed.sort = sort;
  }
  if (direction === InboxSortDirections.ASCENDING) {
    parsed.direction = direction;
  }
  if (layout !== undefined && layout !== InboxLayouts.FOLDED) {
    parsed.layout = layout;
  }
  if (states.length > 0 && !isDefaultStates(states)) {
    parsed.state = states.join(LIST_SEPARATOR);
  }
  if (repos.length > 0) {
    parsed.repo = repos.join(LIST_SEPARATOR);
  }
  if (reviews.length > 0) {
    parsed.review = reviews.join(LIST_SEPARATOR);
  }
  if (author !== undefined && author !== InboxAuthorFilters.ALL) {
    parsed.author = author;
  }
  if (installations.length > 0) {
    parsed.installation = installations.join(LIST_SEPARATOR);
  }
  if (archived !== undefined && archived !== InboxArchivedFilters.HIDE) {
    parsed.archived = archived;
  }
  if (generation !== undefined) {
    parsed.generation = generation;
  }
  if (searchText !== undefined) {
    parsed.q = BARE_NUMBER_PATTERN.test(searchText)
      ? Number(searchText)
      : searchText;
  }
  if (error !== undefined) {
    parsed.error = error;
  }
  return parsed;
}

function isDefaultStates(states: readonly InboxStatus[]): boolean {
  return (
    states.length === DEFAULT_STATES.length &&
    DEFAULT_STATES.every((state) => states.includes(state))
  );
}

/** The wire's view of the URL: the same choices as arrays, defaults filled in. */
export function readInboxParams(search: InboxSearch): InboxQueryParams {
  const params: {
    -readonly [Key in keyof InboxQueryParams]: InboxQueryParams[Key];
  } = {};
  const states = keepKnown(readList(search.state), InboxStatuses);
  const repos = readIds(search.repo);
  const reviews = keepKnown(readList(search.review), InboxReviewStates);
  const installations = readIds(search.installation);

  if (search.page !== undefined) {
    params.page = search.page;
  }
  if (search.sort !== undefined) {
    params.sort = search.sort;
  }
  if (search.direction !== undefined) {
    params.direction = search.direction;
  }
  if (search.layout !== undefined) {
    params.layout = search.layout;
  }
  if (states.length > 0) {
    params.state = states;
  }
  if (repos.length > 0) {
    params.repo = repos;
  }
  if (reviews.length > 0) {
    params.review = reviews;
  }
  if (search.author !== undefined) {
    params.author = search.author;
  }
  if (installations.length > 0) {
    params.installation = installations;
  }
  if (search.archived !== undefined) {
    params.archived = search.archived;
  }
  if (search.generation !== undefined) {
    params.generation = search.generation;
  }
  if (search.q !== undefined) {
    params.q = String(search.q);
  }
  return params;
}

/** The choices as the controls read them, defaults filled in. */
export interface InboxChoices {
  readonly page: number;
  readonly sort: InboxSort;
  readonly direction: InboxSortDirection;
  readonly layout: InboxLayout;
  readonly states: readonly InboxStatus[];
  readonly repos: readonly string[];
  readonly reviews: readonly InboxReviewState[];
  readonly author: InboxAuthorFilter;
  readonly installations: readonly string[];
  readonly archived: InboxArchivedFilter;
  /** Held while the held view is on; absent lists every row. */
  readonly generation?: InboxGenerationFilter | undefined;
  /** Empty when the reviewer is not searching. */
  readonly searchText: string;
}

export function readInboxChoices(search: InboxSearch): InboxChoices {
  const params = readInboxParams(search);
  return {
    page: params.page ?? FIRST_PAGE,
    sort: params.sort ?? InboxSorts.UPDATED,
    direction: params.direction ?? InboxSortDirections.DESCENDING,
    layout: search.layout ?? InboxLayouts.FOLDED,
    states: params.state ?? DEFAULT_STATES,
    repos: params.repo ?? [],
    reviews: params.review ?? [],
    author: params.author ?? InboxAuthorFilters.ALL,
    installations: params.installation ?? [],
    archived: params.archived ?? InboxArchivedFilters.HIDE,
    generation: params.generation,
    searchText: params.q ?? "",
  };
}

/** Whether the Status filter is at its opening pair, the one filter with a hidden default. */
export function hasDefaultStatus(search: InboxSearch): boolean {
  return search.state === undefined;
}

/** Whether the Status filter has every status ticked. */
export function hasEveryStatus(states: readonly InboxStatus[]): boolean {
  return Object.values(InboxStatuses).every((status) =>
    states.includes(status),
  );
}

/** The filters the controls row draws as triggers; the search text is the one more. */
const FILTER_KEYS = [
  "state",
  "repo",
  "review",
  "author",
  "installation",
  "archived",
  "generation",
] as const satisfies readonly (keyof InboxSearch)[];

/** How many filters sit off their default; the sort and the page are not filters. */
export function countChangedFilters(search: InboxSearch): number {
  const keys: readonly (keyof InboxSearch)[] = [...FILTER_KEYS, "q"];
  return keys.filter((key) => search[key] !== undefined).length;
}

/** A filter, sort or layout change starts over from page one; the page keeps the rest. */
export function writeInboxSearch(
  current: InboxSearch,
  change: InboxSearchChange,
): InboxSearch {
  const merged: Record<string, unknown> = { ...current, ...change };
  const touchesWire = Object.keys(change).some((key) => key !== "page");
  if (!("page" in change) && touchesWire) {
    delete merged["page"];
  }
  return parseInboxSearch(merged);
}

/** The keys a search write leaves alone; `q` and the page it restarts are the rest. */
const KEYS_BESIDE_SEARCH_TEXT: readonly (keyof InboxSearch)[] = [
  ...FILTER_KEYS,
  "sort",
  "direction",
  "layout",
  "error",
];

/**
 * The address still loading with its search text put back to the one on
 * screen. Nothing else loading means the list on screen, page included; a
 * filter change loading beside it stays, on the page that change asked for.
 */
export function dropPendingSearchText(
  loading: InboxSearch,
  shown: InboxSearch,
): InboxSearch {
  const onlySearchLoading = KEYS_BESIDE_SEARCH_TEXT.every(
    (key) => loading[key] === shown[key],
  );
  const page = onlySearchLoading ? shown.page : loading.page;
  return parseInboxSearch({ ...loading, q: shown.q, page });
}

/**
 * Every filter at its widest beside the search text: all statuses, nothing
 * else narrowed, in the view asked for. A row the search text matches in
 * that view then shows, whatever was hiding it.
 */
export function widenInboxFilters(
  view: InboxArchivedFilter,
): InboxSearchChange {
  const widest: Mutable<InboxSearchChange> = {};
  for (const key of FILTER_KEYS) {
    widest[key] = undefined;
  }
  widest.state = EVERY_STATUS_PARAM;
  if (view === InboxArchivedFilters.ONLY) {
    widest.archived = view;
  }
  return widest;
}

/** Every filter back to its default; the sort, its direction and the layout stay. */
export function clearInboxFilters(current: InboxSearch): InboxSearch {
  const kept: Record<string, unknown> = {};
  if (current.sort !== undefined) {
    kept["sort"] = current.sort;
  }
  if (current.direction !== undefined) {
    kept["direction"] = current.direction;
  }
  if (current.layout !== undefined) {
    kept["layout"] = current.layout;
  }
  return parseInboxSearch(kept);
}

/** A multi-valued filter toggles one value; an empty set is the default. */
export function toggleListValue(
  current: readonly string[],
  value: string,
): string | undefined {
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  return next.length === 0 ? undefined : next.join(LIST_SEPARATOR);
}

/** The status filter never empties: unticking the last one keeps it ticked. */
export function toggleStateValue(
  current: readonly InboxStatus[],
  value: InboxStatus,
): string | undefined {
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  if (next.length === 0) {
    return current.join(LIST_SEPARATOR);
  }
  return isDefaultStates(next) ? undefined : next.join(LIST_SEPARATOR);
}

/** One of a closed vocabulary, or nothing; a control's option value comes back as a string. */
export function readKnown<Value extends string>(
  value: string,
  vocabulary: Record<string, Value>,
): Value | undefined {
  const [known] = keepKnown([value], vocabulary);
  return known;
}

/** The last page the total allows; a page past it is replaced by this one. */
export function readLastPage(total: number, pageSize: number): number {
  return Math.max(FIRST_PAGE, Math.ceil(total / pageSize));
}

/** The Repository filter's options from the wire's vocabulary, sorted by slug. */
export function listRepoOptions(
  repositories: readonly InboxRepository[],
): readonly FilterOption[] {
  return repositories
    .map((repository) => ({
      value: repository.repoId,
      label: repository.repoSlug ?? repository.repoId,
    }))
    .toSorted((first, second) => first.label.localeCompare(second.label));
}
