// The one reader of a wire error body: a known code with its English line
// comes back typed, anything else is no body at all.
import { describe, expect, it } from "vitest";
import { ApiErrorCodes, parseApiErrorBody } from "../src/index";

describe("parseApiErrorBody", () => {
  it("returns the error line and code for a known code", () => {
    expect(
      parseApiErrorBody({ error: "not found", code: ApiErrorCodes.NOT_FOUND }),
    ).toEqual({ error: "not found", code: ApiErrorCodes.NOT_FOUND });
  });

  it("rejects a code outside the vocabulary", () => {
    expect(
      parseApiErrorBody({ error: "x", code: "brand-new-code" }),
    ).toBeUndefined();
  });

  it("rejects a body whose error line is missing or not a string", () => {
    expect(
      parseApiErrorBody({ code: ApiErrorCodes.NOT_FOUND }),
    ).toBeUndefined();
    expect(
      parseApiErrorBody({ error: 404, code: ApiErrorCodes.NOT_FOUND }),
    ).toBeUndefined();
  });

  it.each([null, undefined, "not found", 404, ["not-found"]])(
    "rejects a non-object body %p",
    (body) => {
      expect(parseApiErrorBody(body)).toBeUndefined();
    },
  );

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "never reads %s off the vocabulary's prototype",
    (code) => {
      expect(parseApiErrorBody({ error: "x", code })).toBeUndefined();
    },
  );
});
