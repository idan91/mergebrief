import type { Result } from "types/utils";
import type { GitHubApiError } from "../errors";
import { FAILURE_ANSWERS } from "./consts";
import { FakeFailures, type FakeFailure } from "./types";

export type FakeAnswer<Value> = Result<Value, GitHubApiError>;

export function buildFailure(
  failure: FakeFailure,
  context: string,
): GitHubApiError {
  const { code, status } = FAILURE_ANSWERS[failure];
  if (status === undefined) {
    return { code, message: `failed to ${context}: ${code}` };
  }
  return {
    code,
    status,
    message: `failed to ${context}: GitHub API returned status ${status}`,
  };
}

export function answerOk<Value>(value: Value): FakeAnswer<Value> {
  return { ok: true, value };
}

export function answerNotFound<Value>(context: string): FakeAnswer<Value> {
  return { ok: false, error: buildFailure(FakeFailures.NOT_FOUND, context) };
}

export function answerAnchorRejected<Value>(
  context: string,
): FakeAnswer<Value> {
  const error = buildFailure(FakeFailures.ANCHOR_REJECTED, context);
  return { ok: false, error };
}
