// Reviewer filters apply to all conversation kinds; verdict and recency apply to reviews.
// Combine within a family with OR, across families with AND; empty means inactive.
// Facet counts exclude their own selection and follow recency reduction.
// Latest-per-reviewer is the default; active verdict filters hide chipless DISMISSED reviews.
import { toggleSet } from "@web/utils/collections";
import { buildInlineThreads, type DigestRow } from "./digest";
import type { Mutable } from "types";
import {
  ReviewVerdictStates,
  type ConversationAuthor,
  type ConversationReview,
  type PrConversation,
} from "../types";
import type { BriefChunk } from "../../brief/types";
import type { ValueOf } from "types";

/**
 * The verdict states that earn a chip, in render order. DISMISSED is absent,
 * so it can never be selected, and therefore never survives an active
 * verdict filter.
 */
export const FilterVerdictStates = {
  APPROVED: ReviewVerdictStates.APPROVED,
  CHANGES_REQUESTED: ReviewVerdictStates.CHANGES_REQUESTED,
  COMMENTED: ReviewVerdictStates.COMMENTED,
} as const;
export type FilterVerdictState = ValueOf<typeof FilterVerdictStates>;

/** URL vocabulary for the verdict family, kebab-case, user-editable. */
const VERDICT_PARAM: Readonly<Record<FilterVerdictState, string>> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  COMMENTED: "commented",
};

const VERDICT_ORDER: readonly FilterVerdictState[] = [
  FilterVerdictStates.APPROVED,
  FilterVerdictStates.CHANGES_REQUESTED,
  FilterVerdictStates.COMMENTED,
];

/** The `reviews` param's only non-default value: show every review, not the latest. */
const ALL_REVIEWS_PARAM = "all";

export interface ConversationFilter {
  /** Selected verdict states; empty = family inactive. */
  readonly verdicts: ReadonlySet<FilterVerdictState>;
  /** Selected author logins; empty = family inactive. */
  readonly reviewers: ReadonlySet<string>;
  /** Keep only each reviewer's most recent review (default). */
  readonly latestOnly: boolean;
}

/** Search-param projection of the filter; `undefined` = key omitted from the URL. */
// A type alias, not an interface: only aliases carry an implicit index
// signature, and this shape is spread into route search objects. Keys are
// OPTIONAL under `exactOptionalPropertyTypes`, an absent key, never an
// explicit undefined.
export type ConversationFilterSearch = {
  readonly verdicts?: string;
  readonly reviewers?: string;
  readonly reviews?: string;
};

export const DEFAULT_CONVERSATION_FILTER: ConversationFilter = {
  verdicts: new Set<FilterVerdictState>(),
  reviewers: new Set<string>(),
  latestOnly: true,
};

function parseVerdictToken(token: string): FilterVerdictState | undefined {
  for (const state of VERDICT_ORDER) {
    if (VERDICT_PARAM[state] === token) return state;
  }
  return undefined;
}

function splitParam(value: unknown): readonly string[] {
  if (typeof value !== "string" || value === "") return [];
  return value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token !== "");
}

/**
 * Read the filter out of URL search params. Every unknown token is DROPPED
 * rather than rejected, this state is user-editable and shareable, so a
 * stale link degrades to a looser filter instead of an error.
 */
export function parseConversationFilter(
  params: Readonly<Record<string, unknown>>,
): ConversationFilter {
  const verdicts = new Set<FilterVerdictState>();
  for (const token of splitParam(params["verdicts"])) {
    const state = parseVerdictToken(token);
    if (state !== undefined) verdicts.add(state);
  }
  return {
    verdicts,
    reviewers: new Set(splitParam(params["reviewers"])),
    latestOnly: params["reviews"] !== ALL_REVIEWS_PARAM,
  };
}

/** Project the filter back onto search params; defaults drop their key. */
export function conversationFilterSearch(
  filter: ConversationFilter,
): ConversationFilterSearch {
  const verdicts = VERDICT_ORDER.filter((state) =>
    filter.verdicts.has(state),
  ).map((state) => VERDICT_PARAM[state]);
  const reviewers = [...filter.reviewers];
  const search: Mutable<ConversationFilterSearch> = {};

  if (verdicts.length !== 0) search.verdicts = verdicts.join(",");
  if (reviewers.length !== 0) search.reviewers = reviewers.join(",");
  if (!filter.latestOnly) search.reviews = ALL_REVIEWS_PARAM;

  return search;
}

/**
 * Empty COMMENTED envelopes must not replace an earlier approval in recency or counts.
 * They carry inline comments, not a new verdict.
 */
export function isStatedVerdict(review: ConversationReview): boolean {
  return (
    review.state !== ReviewVerdictStates.COMMENTED || review.body.trim() !== ""
  );
}

function isNewer(
  candidate: ConversationReview,
  incumbent: ConversationReview,
): boolean {
  // `submittedAt` is optional on the wire, so array order, GitHub returns
  // reviews in submission order, is the fallback, and the candidate always
  // sits later in the array than the incumbent.
  if (
    candidate.submittedAt === undefined ||
    incumbent.submittedAt === undefined
  )
    return true;
  return candidate.submittedAt >= incumbent.submittedAt;
}

/**
 * One review per author, the most recent. Authors keep first-appearance
 * order, so repeated renders are stable.
 */
export function latestReviewPerAuthor(
  reviews: readonly ConversationReview[],
): readonly ConversationReview[] {
  const byAuthor = new Map<string, ConversationReview>();
  for (const review of reviews) {
    const incumbent = byAuthor.get(review.author.login);
    if (incumbent === undefined || isNewer(review, incumbent)) {
      byAuthor.set(review.author.login, review);
    }
  }
  return [...byAuthor.values()];
}

function matchesReviewer(
  author: ConversationAuthor,
  filter: ConversationFilter,
): boolean {
  return filter.reviewers.size === 0 || filter.reviewers.has(author.login);
}

function matchesVerdict(
  review: ConversationReview,
  filter: ConversationFilter,
): boolean {
  if (filter.verdicts.size === 0) return true;
  // DISMISSED can never be in the set, so it falls out here by construction.
  return VERDICT_ORDER.some(
    (state) => state === review.state && filter.verdicts.has(state),
  );
}

function threadAuthor(
  thread: PrConversation["threads"][number],
): ConversationAuthor | undefined {
  return thread.comments[0]?.author;
}

/** Stated verdicts, reduced to the latest per author when the toggle is on. */
function reviewsUnder(
  conversation: PrConversation,
  filter: ConversationFilter,
): readonly ConversationReview[] {
  const stated = conversation.reviews.filter(isStatedVerdict);
  return filter.latestOnly ? latestReviewPerAuthor(stated) : stated;
}

/**
 * The conversation as the filter leaves it. Returning a `PrConversation`
 * keeps the digest and inline-thread builders filtered by one call, with no
 * second filtering path to drift.
 */
export function applyConversationFilter(
  conversation: PrConversation,
  filter: ConversationFilter,
): PrConversation {
  return {
    ...conversation,
    reviews: reviewsUnder(conversation, filter).filter(
      (review) =>
        matchesReviewer(review.author, filter) &&
        matchesVerdict(review, filter),
    ),
    threads: conversation.threads.filter((thread) => {
      if (filter.reviewers.size === 0) return true;
      const author = threadAuthor(thread);
      return author !== undefined && matchesReviewer(author, filter);
    }),
    prComments: conversation.prComments.filter((comment) =>
      matchesReviewer(comment.author, filter),
    ),
  };
}

export interface VerdictFacet {
  readonly state: FilterVerdictState;
  readonly humanCount: number;
  readonly botCount: number;
}

/**
 * Verdict chip counts: computed after the recency reduction and under the
 * reviewer selection, but blind to the verdict selection itself, a chip says
 * what it would add. States with no reviews yield no chip.
 */
export function verdictFacets(
  conversation: PrConversation,
  filter: ConversationFilter,
): readonly VerdictFacet[] {
  const visible = reviewsUnder(conversation, filter).filter((review) =>
    matchesReviewer(review.author, filter),
  );
  const facets: VerdictFacet[] = [];
  for (const state of VERDICT_ORDER) {
    const matching = visible.filter((review) => review.state === state);
    if (matching.length === 0) continue;
    facets.push({
      state,
      humanCount: matching.filter((review) => !review.author.isBot).length,
      botCount: matching.filter((review) => review.author.isBot).length,
    });
  }
  return facets;
}

export interface ReviewerFacet {
  readonly login: string;
  readonly isBot: boolean;
}

/**
 * Every author with activity on the PR, reviews, threads or PR comments,
 * humans first, then bots, each alphabetically. Deliberately NOT faceted:
 * chips that vanish as you select would move the target mid-click, and thread
 * authors have no verdict to be faceted by.
 */
export function reviewerFacets(
  conversation: PrConversation,
): readonly ReviewerFacet[] {
  const byLogin = new Map<string, ReviewerFacet>();
  const add = (author: ConversationAuthor): void => {
    if (!byLogin.has(author.login)) {
      byLogin.set(author.login, { login: author.login, isBot: author.isBot });
    }
  };
  for (const review of conversation.reviews) add(review.author);
  for (const thread of conversation.threads) {
    const author = threadAuthor(thread);
    if (author !== undefined) add(author);
  }
  for (const comment of conversation.prComments) add(comment.author);
  return [...byLogin.values()].toSorted((left, right) => {
    if (left.isBot !== right.isBot) return left.isBot ? 1 : -1;
    return left.login.localeCompare(right.login);
  });
}

/**
 * Drop reviewer selections nobody on this PR matches, the same
 * degrade-to-looser rule the verdict vocabulary gets. A shared link whose
 * logins have since changed would otherwise arrive as an ACTIVE family
 * matching nothing. Call once the conversation resolves.
 */
export function reconcileReviewers(
  filter: ConversationFilter,
  conversation: PrConversation,
): ConversationFilter {
  if (filter.reviewers.size === 0) return filter;
  const known = new Set(
    reviewerFacets(conversation).map((facet) => facet.login),
  );
  const kept = [...filter.reviewers].filter((login) => known.has(login));
  if (kept.length === filter.reviewers.size) return filter;
  return { ...filter, reviewers: new Set(kept) };
}

const NO_OWN_THREADS: ReadonlySet<number> = new Set<number>();

/**
 * Count removals from the inline set, excluding threads only visible in the digest.
 * Removing reviewers drops whole rows, so subtract from one digest without regrouping.
 */
export function countHiddenInlineThreads(
  conversation: PrConversation,
  filter: ConversationFilter,
  chunks: readonly BriefChunk[],
): number {
  if (filter.reviewers.size === 0) return 0;
  let hidden = 0;
  for (const rows of buildInlineThreads({
    conversation,
    chunks,
    ownThreadIds: NO_OWN_THREADS,
  }).values()) {
    for (const row of rows) {
      hidden += countHiddenInRow(row, filter);
    }
  }
  return hidden;
}

/** Threads the reviewer filter removes from one inline row. */
function countHiddenInRow(row: DigestRow, filter: ConversationFilter): number {
  if (row.kind === "bot-group") {
    return filter.reviewers.has(row.author) ? 0 : row.threads.length;
  }
  const author = row.thread.comments[0]?.author;
  const shown = author !== undefined && matchesReviewer(author, filter);
  return shown ? 0 : 1;
}

/** Whether anything is being filtered out right now. */
export function isFilterActive(filter: ConversationFilter): boolean {
  return filter.verdicts.size > 0 || filter.reviewers.size > 0;
}

export function withVerdictSelection(
  filter: ConversationFilter,
  state: FilterVerdictState,
): ConversationFilter {
  return { ...filter, verdicts: toggleSet(filter.verdicts, state) };
}

export function withReviewerSelection(
  filter: ConversationFilter,
  login: string,
): ConversationFilter {
  return { ...filter, reviewers: toggleSet(filter.reviewers, login) };
}

/** The All link: select every reviewer, same visible set as selecting none. */
export function withAllReviewers(
  filter: ConversationFilter,
  logins: readonly string[],
): ConversationFilter {
  return { ...filter, reviewers: new Set(logins) };
}

/** The None link: clear the family back to inactive, never to a blank digest. */
export function withNoReviewers(
  filter: ConversationFilter,
): ConversationFilter {
  return { ...filter, reviewers: new Set<string>() };
}

/**
 * Both families back to inactive, recency PRESERVED, resetting to the
 * default would silently re-collapse a history the reader opted into.
 */
export function withNoFilters(filter: ConversationFilter): ConversationFilter {
  return {
    verdicts: new Set<FilterVerdictState>(),
    reviewers: new Set<string>(),
    latestOnly: filter.latestOnly,
  };
}

export function withLatestOnly(
  filter: ConversationFilter,
  latestOnly: boolean,
): ConversationFilter {
  return { ...filter, latestOnly };
}
