import { createUserOctokit } from "github";

export type MutationOctokit = ReturnType<typeof createUserOctokit>;

/**
 * A create rides a client with octokit's retry off: GitHub can apply a POST
 * and still answer 5xx, so a replay is a second comment, thread or review,
 * never a repeat of the first.
 */
export function createMutationOctokit(token: string): MutationOctokit {
  return createUserOctokit(token, { retry: false });
}
