/** Measured bytes per input token for each kind of prompt text. */
export const BYTES_PER_TOKEN = { DIFF: 2, OUTLINE: 1.7 } as const;

export const SINGLE_CALL_MAX_INPUT_TOKENS = 400_000;

export const SINGLE_CALL_MAX_HUNKS = 120;
