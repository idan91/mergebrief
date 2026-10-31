import { SINGLE_CALL_MAX_INPUT_TOKENS } from "../size/consts";

/** The most hunks one detail call reads; shortened files count for none. */
export const DETAIL_BATCH_MAX_HUNKS = 80;

/**
 * The most diff tokens, at the diff rate, one detail call reads: half the
 * single call's input budget, the other half left for the system prompt and
 * the shared prefix. A constant, so a resumed run plans the same batches its
 * stored parts were written for.
 */
export const DETAIL_BATCH_MAX_DIFF_TOKENS = SINGLE_CALL_MAX_INPUT_TOKENS / 2;
