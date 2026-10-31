import { SINGLE_CALL_MAX_DIFF_TOKENS } from "../size/consts";

/** The most hunks one detail call reads; shortened files count for none. */
export const DETAIL_BATCH_MAX_HUNKS = 80;

/**
 * The most diff tokens, at the diff rate, one detail call reads: half the
 * single call's input budget, the other half left for the system prompt and
 * the shared prefix. A constant, so a resumed run plans the same batches its
 * stored parts were written for.
 */
export const DETAIL_BATCH_MAX_DIFF_TOKENS = SINGLE_CALL_MAX_DIFF_TOKENS / 2;

/** Detail calls in flight at once after call 1 warmed the cache. */
export const DEFAULT_DETAIL_CONCURRENCY = 8;

/** The grouping call writes every group and the hunk map; a detail call writes one batch's chunks. */
export const GROUPING_MAX_OUTPUT_TOKENS = 128_000;
export const DETAIL_MAX_OUTPUT_TOKENS = 64_000;

/** The grouping output's droppable enum arrays; chunk arrays ride the detail calls. */
export const GROUPING_SALVAGE_FIELDS = [
  "secondaryCategories",
  "uncertainBetween",
] as const;

export const PART_KEY_GROUPING = "grouping";
