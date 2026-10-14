import { describe, expect, expectTypeOf, it } from "vitest";
import { ApiErrorCodes } from "contract";
import {
  ApiError,
  BadGateway,
  BadRequest,
  Conflict,
  Forbidden,
  InternalError,
  NotFound,
  PayloadTooLarge,
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
    new Unauthorized(ApiErrorCodes.SIGNED_OUT),
    new Unauthorized(ApiErrorCodes.INVALID_SIGNATURE),
    new Forbidden(),
    new Forbidden(ApiErrorCodes.GITHUB_PERMISSION),
    new Forbidden(ApiErrorCodes.SCOPE_EXCEEDED),
    new Forbidden(ApiErrorCodes.HUMAN_ONLY),
    new Forbidden(ApiErrorCodes.NO_REPO_WRITE_ACCESS),
    new Forbidden(ApiErrorCodes.REPO_ADMIN_ONLY),
    new Forbidden(ApiErrorCodes.ATTACHMENTS_DISABLED),
    new Forbidden(ApiErrorCodes.ATTACHMENTS_ADMIN_ONLY),
    new NotFound(),
    new Conflict(ApiErrorCodes.DRAFT_ALREADY_PUBLISHED),
    new Conflict(ApiErrorCodes.DRAFT_ANCHOR_ORPHANED),
    new Conflict(ApiErrorCodes.DRAFT_LIMIT_REACHED),
    new Conflict(ApiErrorCodes.SESSION_RECORD_LIMIT_REACHED),
    new Conflict(ApiErrorCodes.DRAFT_PUBLISH_PENDING),
    new Conflict(ApiErrorCodes.DRAFT_PUBLISH_IN_DOUBT),
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
    new InternalError(ApiErrorCodes.ARTIFACT_UNREADABLE),
    new BadGateway(ApiErrorCodes.GITHUB_UNAVAILABLE),
  ];

  it("covers every code with exactly one class instance", () => {
    const codes = instances.map((e) => e.code).toSorted();
    expect(codes).toEqual(Object.values(ApiErrorCodes).toSorted());
  });

  it("every instance is an ApiError and an Error", () => {
    for (const err of instances) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("message is the code, name is the class", () => {
    const err = new NotFound();
    expect(err.message).toBe("not-found");
    expect(err.name).toBe("NotFound");
  });

  it("CodeFor pins class-code agreement at the type level", () => {
    expectTypeOf<CodeFor<404>>().toEqualTypeOf<
      "not-found" | "file-not-found"
    >();
    expectTypeOf<CodeFor<401>>().toEqualTypeOf<
      "unauthorized" | "signed-out" | "invalid-signature"
    >();
    // @ts-expect-error, a 403 code cannot construct a NotFound
    void new NotFound(ApiErrorCodes.FORBIDDEN);
    // @ts-expect-error, a class takes its code and nothing else
    void new NotFound(ApiErrorCodes.NOT_FOUND, { detail: "x" });
  });
});
