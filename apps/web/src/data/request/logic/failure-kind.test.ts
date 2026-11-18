import { describe, expect, it } from "vitest";

import { ApiError, ApiErrorCodes, type ApiErrorCode } from "../../apiFetch";
import { WriteFailureKinds, type WriteKindTable } from "../types";
import { readFailureKind } from "./failure-kind";

const TrialKinds = {
  NOT_FOUND: "gone",
  FALLBACK: "upstream",
} as const;
type TrialKind = (typeof TrialKinds)[keyof typeof TrialKinds];

const trialKinds: WriteKindTable<TrialKind> = {
  [ApiErrorCodes.NOT_FOUND]: TrialKinds.NOT_FOUND,
  fallback: TrialKinds.FALLBACK,
};

function makeApiError(code: ApiErrorCode, status: number): ApiError {
  return new ApiError(code, status, "/api/repos/1/pulls/2/ready");
}

describe("readFailureKind", () => {
  it("maps a listed code to its kind", () => {
    const error = makeApiError(ApiErrorCodes.NOT_FOUND, 404);
    expect(readFailureKind(error, trialKinds)).toBe(TrialKinds.NOT_FOUND);
  });

  it("maps an unlisted code to the fallback", () => {
    const error = makeApiError(ApiErrorCodes.GITHUB_UNAVAILABLE, 502);
    expect(readFailureKind(error, trialKinds)).toBe(TrialKinds.FALLBACK);
  });

  it("maps a malformed 2xx to the fallback unless the table lists it", () => {
    const error = makeApiError(ApiErrorCodes.MALFORMED, 200);
    expect(readFailureKind(error, trialKinds)).toBe(TrialKinds.FALLBACK);
  });

  it.each([ApiErrorCodes.UNAUTHORIZED, ApiErrorCodes.SIGNED_OUT])(
    "maps a %s 401 to the shared unauthorized kind",
    (code) => {
      const error = makeApiError(code, 401);
      expect(readFailureKind(error, trialKinds)).toBe(
        WriteFailureKinds.UNAUTHORIZED,
      );
    },
  );

  it("lets the table name a 401 kind of its own", () => {
    const kinds: WriteKindTable<TrialKind> = {
      [ApiErrorCodes.UNAUTHORIZED]: TrialKinds.NOT_FOUND,
      fallback: TrialKinds.FALLBACK,
    };
    const error = makeApiError(ApiErrorCodes.UNAUTHORIZED, 401);
    expect(readFailureKind(error, kinds)).toBe(TrialKinds.NOT_FOUND);
  });

  it("maps a thrown fetch to indeterminate", () => {
    const error = new TypeError("network down");
    expect(readFailureKind(error, trialKinds)).toBe(
      WriteFailureKinds.INDETERMINATE,
    );
  });

  it("maps the proxy's 504 to indeterminate even under a listed code", () => {
    const error = makeApiError(ApiErrorCodes.NOT_FOUND, 504);
    expect(readFailureKind(error, trialKinds)).toBe(
      WriteFailureKinds.INDETERMINATE,
    );
  });
});
