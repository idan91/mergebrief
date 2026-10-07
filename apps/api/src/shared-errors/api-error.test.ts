import { describe, expect, expectTypeOf, it } from "vitest";
import { ApiErrorCodes, ApiErrorStatusByCode } from "contract";
import {
  ApiError,
  BadGateway,
  BadRequest,
  Conflict,
  Forbidden,
  InternalError,
  NotFound,
  PayloadTooLarge,
  ServiceUnavailable,
  TooManyRequests,
  Unauthorized,
  type CodeFor,
} from "./api-error";

describe("ApiError classes", () => {
  const instances: readonly ApiError[] = [
    new BadRequest(),
    new BadRequest(ApiErrorCodes.NOT_A_PR_URL),
    new BadRequest(ApiErrorCodes.SIGN_IN_FAILED),
    new Unauthorized(),
    new Unauthorized(ApiErrorCodes.INVALID_SIGNATURE),
    new Forbidden(),
    new Forbidden(ApiErrorCodes.GITHUB_PERMISSION),
    new Forbidden(ApiErrorCodes.SCOPE_EXCEEDED),
    new Forbidden(ApiErrorCodes.HUMAN_ONLY),
    new Forbidden(ApiErrorCodes.NO_REPO_WRITE_ACCESS),
    new Forbidden(ApiErrorCodes.REPO_ADMIN_ONLY),
    new Forbidden(ApiErrorCodes.ATTACHMENTS_DISABLED),
    new Forbidden(ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY),
    new Forbidden(ApiErrorCodes.APP_NOT_INSTALLED),
    new NotFound(),
    new Conflict(ApiErrorCodes.DRAFT_ALREADY_PUBLISHED),
    new Conflict(ApiErrorCodes.DRAFT_ANCHOR_ORPHANED),
    new Conflict(ApiErrorCodes.DRAFT_LIMIT_REACHED),
    new Conflict(ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED),
    new Conflict(ApiErrorCodes.PENDING_REVIEW_HELD),
    new Conflict(ApiErrorCodes.PR_CHANGED_SINCE_READ),
    new Conflict(ApiErrorCodes.PR_REWRITTEN_SINCE_READ),
    new PayloadTooLarge(ApiErrorCodes.REQUEST_TOO_LARGE),
    new PayloadTooLarge(ApiErrorCodes.DIFF_TOO_LARGE),
    new NotFound(ApiErrorCodes.FILE_NOT_FOUND),
    new PayloadTooLarge(ApiErrorCodes.FILE_TOO_LARGE),
    new BadRequest(ApiErrorCodes.FILE_NOT_TEXT),
    new BadRequest(ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE),
    new TooManyRequests(ApiErrorCodes.ATTACHMENT_LIMIT_REACHED),
    new InternalError(),
    new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE),
    new BadGateway(ApiErrorCodes.GENERATION_FAILED),
    new ServiceUnavailable(ApiErrorCodes.GENERATION_UNAVAILABLE),
    new ServiceUnavailable(ApiErrorCodes.GENERATION_CONFIG, {
      detail: "missing key",
    }),
  ];

  it("covers every code with exactly one class instance", () => {
    const codes = instances.map((e) => e.code).toSorted();
    expect(codes).toEqual(Object.values(ApiErrorCodes).toSorted());
  });

  it("every instance's status matches the code's pinned status", () => {
    for (const err of instances) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBe(ApiErrorStatusByCode[err.code]);
    }
  });

  it("message is the code, name is the class", () => {
    const err = new NotFound();
    expect(err.message).toBe("not-found");
    expect(err.name).toBe("NotFound");
  });

  it("carries params when the code takes them, undefined otherwise", () => {
    const withParams = new ServiceUnavailable(ApiErrorCodes.GENERATION_CONFIG, {
      detail: "missing key",
    });
    expect(withParams.params).toEqual({ detail: "missing key" });
    expect(new NotFound().params).toBeUndefined();
  });

  it("CodeFor pins class-code agreement at the type level", () => {
    expectTypeOf<CodeFor<404>>().toEqualTypeOf<
      "not-found" | "file-not-found"
    >();
    expectTypeOf<CodeFor<401>>().toEqualTypeOf<
      "unauthorized" | "invalid-signature"
    >();
    // @ts-expect-error, a 403 code cannot construct a NotFound
    void new NotFound(ApiErrorCodes.FORBIDDEN);
    // @ts-expect-error, a paramful code requires its params
    void new ServiceUnavailable(ApiErrorCodes.GENERATION_CONFIG);
    // @ts-expect-error, a paramless code takes no params
    void new NotFound(ApiErrorCodes.NOT_FOUND, { detail: "x" });
  });
});
