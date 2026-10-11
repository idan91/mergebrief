import { describe, expect, it } from "vitest";
import {
  GitHubApiErrorCodes,
  type GitHubApiError,
  type GitHubApiErrorCode,
} from "github";
import {
  BadGateway,
  Forbidden,
  NotFound,
  Unauthorized,
  type ApiError,
} from "../api-error";
import { FailureKinds, type TokenUnreadableFailure } from "../failures";
import { DenialPostures, type GitHubFailure } from "./types";
import { resolveGitHubDenialError, unwrapGitHubFailure } from "./index";

type ApiErrorClass = abstract new (...args: never[]) => ApiError;

interface DenialAnswer {
  readonly expectedClass: ApiErrorClass;
  readonly expectedCode: string;
}

/** One row of the decision table: the answers under collapse, honest, app-read, app-write. */
interface DenialRow {
  readonly cause: string;
  readonly failure: GitHubFailure;
  readonly answers: readonly [
    DenialAnswer,
    DenialAnswer,
    DenialAnswer,
    DenialAnswer,
  ];
}

function makeGitHubError(code: GitHubApiErrorCode): GitHubApiError {
  return { code, message: `failed to read: ${code}` };
}

const TOKEN_UNREADABLE_FAILURE: TokenUnreadableFailure = {
  kind: FailureKinds.TOKEN_UNREADABLE,
};

const E401 = { expectedClass: Unauthorized, expectedCode: "unauthorized" };
const E404 = { expectedClass: NotFound, expectedCode: "not-found" };
const E403 = { expectedClass: Forbidden, expectedCode: "github-permission" };
const E502 = { expectedClass: BadGateway, expectedCode: "github-unavailable" };

const POSTURE_ORDER = [
  DenialPostures.COLLAPSE,
  DenialPostures.HONEST,
  DenialPostures.APP_READ,
  DenialPostures.APP_WRITE,
] as const;

const TABLE: readonly DenialRow[] = [
  {
    cause: "token-unreadable",
    failure: TOKEN_UNREADABLE_FAILURE,
    answers: [E401, E401, E401, E401],
  },
  {
    cause: "unauthorized",
    failure: makeGitHubError(GitHubApiErrorCodes.UNAUTHORIZED),
    answers: [E401, E401, E502, E502],
  },
  {
    cause: "not-found",
    failure: makeGitHubError(GitHubApiErrorCodes.NOT_FOUND),
    answers: [E404, E404, E404, E404],
  },
  {
    cause: "forbidden",
    failure: makeGitHubError(GitHubApiErrorCodes.FORBIDDEN),
    answers: [E404, E403, E404, E403],
  },
  {
    cause: "rate-limited",
    failure: makeGitHubError(GitHubApiErrorCodes.RATE_LIMITED),
    answers: [E502, E502, E502, E502],
  },
  {
    cause: "request-failed",
    failure: makeGitHubError(GitHubApiErrorCodes.REQUEST_FAILED),
    answers: [E502, E502, E502, E502],
  },
  {
    cause: "not-a-blob",
    failure: makeGitHubError(GitHubApiErrorCodes.NOT_A_BLOB),
    answers: [E502, E502, E502, E502],
  },
  {
    cause: "rule-refused",
    failure: makeGitHubError(GitHubApiErrorCodes.RULE_REFUSED),
    answers: [E502, E502, E502, E502],
  },
];

const CELLS = TABLE.flatMap((row) =>
  POSTURE_ORDER.map((posture, index) => ({
    cause: row.cause,
    failure: row.failure,
    posture,
    ...row.answers[index],
  })),
);

describe("resolveGitHubDenialError", () => {
  it.each(CELLS)(
    "answers $cause under $posture with $expectedCode",
    ({ failure, posture, expectedClass, expectedCode }) => {
      const error = resolveGitHubDenialError(failure, posture);
      expect(error).toBeInstanceOf(expectedClass);
      expect(error.code).toBe(expectedCode);
    },
  );

  it("unwraps a domain failure to the GitHub failure it carries", () => {
    const refusal = makeGitHubError(GitHubApiErrorCodes.FORBIDDEN);
    expect(
      unwrapGitHubFailure({ kind: FailureKinds.GITHUB_DENIED, error: refusal }),
    ).toBe(refusal);
    expect(unwrapGitHubFailure(TOKEN_UNREADABLE_FAILURE)).toBe(
      TOKEN_UNREADABLE_FAILURE,
    );
  });

  it("builds a fresh error on every call", () => {
    const failure = makeGitHubError(GitHubApiErrorCodes.NOT_FOUND);
    const first = resolveGitHubDenialError(failure, DenialPostures.COLLAPSE);
    const second = resolveGitHubDenialError(failure, DenialPostures.COLLAPSE);
    expect(first).not.toBe(second);
  });
});
