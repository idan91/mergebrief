import type { ReviewerId } from "persistence";
import type { Result } from "types/utils";
import {
  createUserOctokit,
  requestAuthenticatedUser,
  type AuthenticatedUser,
} from "../auth/oauth";
import {
  GitHubApiErrorCodes,
  type GitHubApiError,
  type GitHubApiErrorCode,
} from "../errors";
import {
  OWNER_LOOKUP_OCTOKIT_OPTIONS,
  OWNER_LOOKUP_TIMEOUT_MS,
  OWNER_RETRY_FIRST_DELAY_MS,
  OWNER_RETRY_MAX_DELAY_MS,
} from "./consts";
import type {
  OperatorOwnerDeps,
  OperatorToken,
  OwnedOperatorToken,
  RetryScheduler,
} from "./types";

/** A token GitHub refuses stays refused: env is read only at boot. */
const REFUSAL_CODES: ReadonlySet<GitHubApiErrorCode> = new Set([
  GitHubApiErrorCodes.UNAUTHORIZED,
  GitHubApiErrorCodes.FORBIDDEN,
  GitHubApiErrorCodes.NOT_FOUND,
]);

/** An unref'd timer holds no process open, so shutdown needs no hook. */
function scheduleUnrefRetry(retry: () => Promise<void>, delayMs: number): void {
  setTimeout(() => {
    void retry();
  }, delayMs).unref();
}

function deriveRetryDelay(failedLookups: number): number {
  const doubled = OWNER_RETRY_FIRST_DELAY_MS * 2 ** failedLookups;
  return Math.min(doubled, OWNER_RETRY_MAX_DELAY_MS);
}

/**
 * Ask GitHub who owns `token`, then serve that account only. Resolves after
 * the first lookup; a transient failure keeps retrying in the background,
 * and until one succeeds the token serves nobody.
 */
export async function resolveOperatorTokenOwner(
  token: OperatorToken,
  deps: OperatorOwnerDeps,
): Promise<OwnedOperatorToken> {
  const { log } = deps;
  const createOctokit = deps.octokitFactory ?? createUserOctokit;
  const scheduleRetry: RetryScheduler =
    deps.scheduleRetry ?? scheduleUnrefRetry;
  let ownerId: ReviewerId | undefined;
  let lookupPending = true;
  let failedLookups = 0;

  function fetchOwner(): Promise<Result<AuthenticatedUser, GitHubApiError>> {
    const octokit = createOctokit(token, OWNER_LOOKUP_OCTOKIT_OPTIONS);
    return requestAuthenticatedUser(
      octokit,
      AbortSignal.timeout(OWNER_LOOKUP_TIMEOUT_MS),
    );
  }

  async function lookUpOwner(): Promise<void> {
    const owner = await fetchOwner();

    if (owner.ok) {
      ownerId = owner.value.reviewerId;
      lookupPending = false;
      log.info("URL fallback token serves its owner only", {
        ownerId: String(ownerId),
      });
      return;
    }

    const { code, status } = owner.error;
    if (REFUSAL_CODES.has(code)) {
      lookupPending = false;
      log.error(
        "GitHub refused MERGEBRIEF_URL_FALLBACK_TOKEN, so it serves nobody; fix the token and restart",
        { evt: "url-fallback-token.owner.fail", status, code },
      );
      return;
    }

    const retryInMs = deriveRetryDelay(failedLookups);
    failedLookups += 1;
    log.warn(
      "URL fallback token owner lookup failed; the token serves nobody until a retry succeeds",
      { status, code, retryInMs },
    );
    scheduleRetry(lookUpOwner, retryInMs);
  }

  await lookUpOwner();

  return {
    token,
    isOwnedBy: (reviewerId) => ownerId === reviewerId,
    isLookupPending: () => lookupPending,
  };
}
