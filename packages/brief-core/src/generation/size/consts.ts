/** Measured bytes per input token for each kind of prompt text. */
export const BYTES_PER_TOKEN = { DIFF: 2, OUTLINE: 1.7 } as const;

export const SINGLE_CALL_MAX_DIFF_TOKENS = 400_000;

export const SINGLE_CALL_MAX_HUNKS = 120;

/** Bytes one changed line costs in a diff, measured on a 731 KB diff of 10,894 changed lines. */
export const BYTES_PER_CHANGED_LINE = 67;
