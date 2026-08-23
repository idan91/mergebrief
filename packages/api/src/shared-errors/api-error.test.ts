import { describe, expect, expectTypeOf, it } from "vitest";
import { API_ERROR_STATUS, ApiErrorCode } from "../error-response";
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
  Unauthorized,
  type CodeFor,
} from "./api-error";

describe("ApiError classes", () => {
  const instances: readonly ApiError[] = [
    new BadRequest(ApiErrorCode.INVALID_REQUEST),
    new BadRequest(ApiErrorCode.NOT_A_PR_URL),
    new BadRequest(ApiErrorCode.SIGN_IN_FAILED),
    new Unauthorized(ApiErrorCode.UNAUTHORIZED),
    new Unauthorized(ApiErrorCode.INVALID_SIGNATURE),
    new Forbidden(ApiErrorCode.FORBIDDEN),
    new Forbidden(ApiErrorCode.GITHUB_PERMISSION),
    new Forbidden(ApiErrorCode.SCOPE_EXCEEDED),
    new Forbidden(ApiErrorCode.HUMAN_ONLY),
    new Forbidden(ApiErrorCode.APP_NOT_INSTALLED),
    new NotFound(ApiErrorCode.NOT_FOUND),
    new Conflict(ApiErrorCode.DRAFT_ALREADY_PUBLISHED),
    new Conflict(ApiErrorCode.DRAFT_ANCHOR_ORPHANED),
    new Conflict(ApiErrorCode.DRAFT_LIMIT_REACHED),
    new Conflict(ApiErrorCode.PR_CHANGED_SINCE_READ),
    new Conflict(ApiErrorCode.PR_REWRITTEN_SINCE_READ),
    new PayloadTooLarge(ApiErrorCode.REQUEST_TOO_LARGE),
    new PayloadTooLarge(ApiErrorCode.DIFF_TOO_LARGE),
    new InternalError(ApiErrorCode.INTERNAL_ERROR),
    new BadGateway(ApiErrorCode.GITHUB_UNAVAILABLE),
    new BadGateway(ApiErrorCode.GENERATION_FAILED),
    new ServiceUnavailable(ApiErrorCode.GENERATION_UNAVAILABLE),
    new ServiceUnavailable(ApiErrorCode.GENERATION_CONFIG, {
      detail: "missing key",
    }),
  ];

  it("covers every code with exactly one class instance", () => {
    const codes = instances.map((e) => e.code).toSorted();
    expect(codes).toEqual(Object.values(ApiErrorCode).toSorted());
  });

  it("every instance's status matches the code's pinned status", () => {
    for (const err of instances) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBe(API_ERROR_STATUS[err.code]);
    }
  });

  it("message is the code, name is the class", () => {
    const err = new NotFound(ApiErrorCode.NOT_FOUND);
    expect(err.message).toBe("not-found");
    expect(err.name).toBe("NotFound");
  });

  it("carries params when the code takes them, undefined otherwise", () => {
    const withParams = new ServiceUnavailable(ApiErrorCode.GENERATION_CONFIG, {
      detail: "missing key",
    });
    expect(withParams.params).toEqual({ detail: "missing key" });
    expect(new NotFound(ApiErrorCode.NOT_FOUND).params).toBeUndefined();
  });

  it("CodeFor pins class-code agreement at the type level", () => {
    expectTypeOf<CodeFor<404>>().toEqualTypeOf<"not-found">();
    expectTypeOf<CodeFor<401>>().toEqualTypeOf<
      "unauthorized" | "invalid-signature"
    >();
    // @ts-expect-error — a 403 code cannot construct a NotFound
    void new NotFound(ApiErrorCode.FORBIDDEN);
    // @ts-expect-error — a paramful code requires its params
    void new ServiceUnavailable(ApiErrorCode.GENERATION_CONFIG);
    // @ts-expect-error — a paramless code takes no params
    void new NotFound(ApiErrorCode.NOT_FOUND, { detail: "x" });
  });
});
