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
