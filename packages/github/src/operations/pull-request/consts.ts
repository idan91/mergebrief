/** One first attempt plus two retries; the octokit retry plugin is off for these. */
export const COMPARE_DIFF_ATTEMPTS = 3;

/** The wait before each retry, in attempt order. */
export const COMPARE_DIFF_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];
