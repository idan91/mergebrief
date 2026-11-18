import type { UserOctokitOptions } from "../auth/oauth";

/**
 * A create rides a client with retry off: GitHub can apply a POST and still
 * answer 5xx, so a replay is a second object. A rate-limit wait past the cap
 * could carry the create past its claim's lease.
 */
export const CREATE_OCTOKIT_OPTIONS = {
  retry: false,
  maxRetryAfterSeconds: 20,
} as const satisfies UserOctokitOptions;

/**
 * The owner lookup runs its own backoff, and a rate-limit wait would hold
 * boot, so octokit neither retries nor waits.
 */
export const OWNER_LOOKUP_OCTOKIT_OPTIONS = {
  retry: false,
  maxRetryAfterSeconds: 0,
} as const satisfies UserOctokitOptions;

export const OWNER_LOOKUP_TIMEOUT_MS = 10_000;
export const OWNER_RETRY_FIRST_DELAY_MS = 30_000;
export const OWNER_RETRY_MAX_DELAY_MS = 900_000;
