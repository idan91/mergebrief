import { describe, expect, it } from "vitest";
import {
  isDiffTooLarge,
  isNotAcceptable,
  isPermanentGitHubError,
  isRenderTimedOut,
  isSpanUnrendered,
} from "../src/call-failures";
import {
  CredentialFailureCodes,
  type GitHubCallFailure,
} from "../src/client/types";
import { GitHubApiErrorCodes } from "../src/errors";

function stubStatusFailure(status: number): GitHubCallFailure {
  return {
    code: GitHubApiErrorCodes.REQUEST_FAILED,
    status,
    message: "stub",
  };
}

const NOT_ACCEPTABLE = stubStatusFailure(406);
const UNPROCESSABLE = stubStatusFailure(422);
const SERVER_ERROR = stubStatusFailure(502);
const INCOMPLETE: GitHubCallFailure = {
  code: GitHubApiErrorCodes.DIFF_INCOMPLETE,
  message: "stub",
};
const NOT_FOUND: GitHubCallFailure = {
  code: GitHubApiErrorCodes.NOT_FOUND,
  status: 404,
  message: "stub",
};
const RATE_LIMITED: GitHubCallFailure = {
  code: GitHubApiErrorCodes.RATE_LIMITED,
  status: 403,
  message: "stub",
};
const UNREADABLE_CREDENTIAL: GitHubCallFailure = {
  code: CredentialFailureCodes.CREDENTIAL_UNREADABLE,
  message: "stub",
};

describe("GitHub call failure predicates", () => {
  it("reads only a 406 as not acceptable", () => {
    expect(isNotAcceptable(NOT_ACCEPTABLE)).toBe(true);
    expect(isNotAcceptable(INCOMPLETE)).toBe(false);
    expect(isNotAcceptable(UNPROCESSABLE)).toBe(false);
  });

  it("reads a 406 or a diff served short as too large", () => {
    expect(isDiffTooLarge(NOT_ACCEPTABLE)).toBe(true);
    expect(isDiffTooLarge(INCOMPLETE)).toBe(true);
    expect(isDiffTooLarge(UNPROCESSABLE)).toBe(false);
  });

  it("reads a 422 as a render timeout and either as unrendered", () => {
    expect(isRenderTimedOut(UNPROCESSABLE)).toBe(true);
    expect(isRenderTimedOut(NOT_ACCEPTABLE)).toBe(false);
    expect(isSpanUnrendered(UNPROCESSABLE)).toBe(true);
    expect(isSpanUnrendered(INCOMPLETE)).toBe(true);
    expect(isSpanUnrendered(SERVER_ERROR)).toBe(false);
  });

  it("reads denials, an unreadable credential and too large as permanent", () => {
    expect(isPermanentGitHubError(NOT_FOUND)).toBe(true);
    expect(isPermanentGitHubError(UNREADABLE_CREDENTIAL)).toBe(true);
    expect(isPermanentGitHubError(NOT_ACCEPTABLE)).toBe(true);
    expect(isPermanentGitHubError(RATE_LIMITED)).toBe(false);
    expect(isPermanentGitHubError(SERVER_ERROR)).toBe(false);
    expect(isPermanentGitHubError(UNPROCESSABLE)).toBe(false);
  });
});
