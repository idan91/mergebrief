import type { ResponseHeaders } from "@octokit/types";
import type { Octokit } from "octokit";
import { HttpStatuses } from "types/http";
import type { Mutable, Result } from "types/utils";
import {
  buildDiffIncompleteError,
  buildDiffTimedOutError,
  mapRequestError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../../errors";
import { runWithinDeadline } from "../deadline";
import { COMPARE_DIFF_ATTEMPTS, COMPARE_DIFF_RETRY_DELAYS_MS } from "./consts";
import { countDiffFiles, isShortOfDeclaredLength } from "./diff-completeness";
import type { CheckedCompareDiffRef } from "./types";

const CONTEXT = "fetch compare diff";

interface CompareRequestOptions {
  readonly retries: number;
  readonly signal?: AbortSignal;
}

interface SettledAttempt {
  readonly settled: true;
  readonly result: Result<string, GitHubApiError>;
}

interface RetryableAttempt {
  readonly settled: false;
  readonly error: GitHubApiError;
}

type CompareDiffAttempt = SettledAttempt | RetryableAttempt;

/**
 * The span's diff, checked whole. A 422 (GitHub's render timeout), a 5xx and a
 * transport failure are retried here and never by the octokit plugin, so
 * attempts cannot stack; a run whose last attempt ends on a 422 reads as
 * `diff-timed-out`.
 */
export async function fetchCheckedCompareDiff(
  octokit: Octokit,
  ref: CheckedCompareDiffRef,
): Promise<Result<string, GitHubApiError>> {
  const deadlineAt =
    ref.deadlineMs === undefined ? undefined : Date.now() + ref.deadlineMs;
  let lastFailure = buildDiffTimedOutError(CONTEXT);

  for (let attempt = 0; attempt < COMPARE_DIFF_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await waitForRetry(attempt, deadlineAt);
    }
    const remainingMs = readRemainingMs(deadlineAt);
    if (remainingMs !== undefined && remainingMs <= 0) {
      return { ok: false, error: buildDiffTimedOutError(CONTEXT) };
    }

    const outcome = await attemptCompareDiff(octokit, ref, remainingMs);
    if (outcome.settled) {
      return outcome.result;
    }
    lastFailure = outcome.error;
  }

  if (lastFailure.status === HttpStatuses.UNPROCESSABLE_CONTENT) {
    return {
      ok: false,
      error: buildDiffTimedOutError(CONTEXT, lastFailure.status),
    };
  }
  return { ok: false, error: lastFailure };
}

async function attemptCompareDiff(
  octokit: Octokit,
  ref: CheckedCompareDiffRef,
  remainingMs: number | undefined,
): Promise<CompareDiffAttempt> {
  let deadlineSignal: AbortSignal | undefined;
  try {
    const response =
      remainingMs === undefined
        ? await requestCompareDiff(octokit, ref)
        : await runWithinDeadline((signal) => {
            deadlineSignal = signal;
            return requestCompareDiff(octokit, ref, signal);
          }, remainingMs);
    const result = checkCompareDiff(
      response.data,
      response.headers,
      ref.expectedFileCount,
    );
    return { settled: true, result };
  } catch (error) {
    if (deadlineSignal?.aborted === true) {
      return {
        settled: true,
        result: { ok: false, error: buildDiffTimedOutError(CONTEXT) },
      };
    }
    return classifyFailure(mapRequestError(error, CONTEXT));
  }
}

function requestCompareDiff(
  octokit: Octokit,
  ref: CheckedCompareDiffRef,
  signal?: AbortSignal,
) {
  const request: Mutable<CompareRequestOptions> = { retries: 0 };
  if (signal !== undefined) {
    request.signal = signal;
  }
  return octokit.rest.repos.compareCommitsWithBasehead({
    owner: ref.owner,
    repo: ref.repo,
    basehead: `${ref.base}...${ref.head}`,
    mediaType: { format: "diff" },
    request,
  });
}

/**
 * A statusless failure never reached a status: an abort, a body read cut short,
 * or a non-octokit throw. octokit reports a refused connection as a 500.
 */
function classifyFailure(failure: GitHubApiError): CompareDiffAttempt {
  const isRetryable =
    failure.status === undefined ||
    failure.status === HttpStatuses.UNPROCESSABLE_CONTENT ||
    failure.status >= HttpStatuses.INTERNAL_SERVER_ERROR;
  if (isRetryable) {
    return { settled: false, error: failure };
  }
  return { settled: true, result: { ok: false, error: failure } };
}

/** octokit types the `diff` media-type body as the JSON compare object. */
function checkCompareDiff(
  body: unknown,
  headers: ResponseHeaders,
  expectedFileCount: number | undefined,
): Result<string, GitHubApiError> {
  if (typeof body !== "string") {
    return { ok: false, error: unexpectedResponseError(CONTEXT) };
  }
  const isFileCountWrong =
    expectedFileCount !== undefined &&
    countDiffFiles(body) !== expectedFileCount;
  const isIncomplete =
    isFileCountWrong || isShortOfDeclaredLength(body, headers);
  if (isIncomplete) {
    return { ok: false, error: buildDiffIncompleteError(CONTEXT) };
  }
  return { ok: true, value: body };
}

function readRemainingMs(deadlineAt: number | undefined): number | undefined {
  if (deadlineAt === undefined) {
    return undefined;
  }
  return deadlineAt - Date.now();
}

async function waitForRetry(
  attempt: number,
  deadlineAt: number | undefined,
): Promise<void> {
  const delayMs = COMPARE_DIFF_RETRY_DELAYS_MS[attempt - 1] ?? 0;
  const remainingMs = readRemainingMs(deadlineAt) ?? delayMs;
  const waitMs = Math.max(0, Math.min(delayMs, remainingMs));
  await new Promise((resolve) => {
    setTimeout(resolve, waitMs);
  });
}
