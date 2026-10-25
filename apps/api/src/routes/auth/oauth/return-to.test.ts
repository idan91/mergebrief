import { describe, expect, it } from "vitest";
import {
  RETURN_TO_MAX_LENGTH,
  isSafeReturnPath,
  returnToSchema,
} from "./return-to";

const APP_ORIGIN = "https://app.example";

const ACCEPTED_PATHS = [
  "/",
  "/repos/424242/pulls/1",
  "/repos/424242/pulls/1?rev=1&thread=9",
  "/repos/424242/pulls/1?path=src%2Findex.ts",
  "/settings#tokens",
  "/apis",
];

const REFUSED_PATHS = [
  "",
  "https://evil.example",
  "evil.example",
  "javascript:alert(1)",
  "//evil.example",
  "///evil.example",
  "/\\evil.example",
  "/repos\\424242",
  "/\t/evil.example",
  "/\n/evil.example",
  "/\r/evil.example",
  " /repos/424242",
  "/repos/424242 ",
  "/repos/\u0000",
  "/repos/\u007f",
  "/%2F%2Fevil.example",
  "/%2f%2fevil.example",
  "/%5Cevil.example",
  "/%09/evil.example",
  "/%252F%252Fevil.example",
  "/repos/%2e%2e/api/auth/github",
  "/api",
  "/api/",
  "/api/auth/github",
  "/API/auth/github",
  "/api?x=1",
  "/repos/../api/auth/github",
  "/./api/auth/github",
  "/.//evil.example",
  "/repos/..//evil.example",
  "/repos/caf\u00e9",
  "/repos/\u2215evil.example",
  "/repos/424242?q=a b",
];

describe("isSafeReturnPath", () => {
  it.each(ACCEPTED_PATHS)("accepts %j", (path) => {
    expect(isSafeReturnPath(path)).toBe(true);
  });

  it.each(ACCEPTED_PATHS)("keeps %j on the app's own origin", (path) => {
    expect(new URL(path, APP_ORIGIN).origin).toBe(APP_ORIGIN);
  });

  it.each(REFUSED_PATHS)("refuses %j", (path) => {
    expect(isSafeReturnPath(path)).toBe(false);
  });

  it("accepts a path at the length cap", () => {
    const atCap = `/${"a".repeat(RETURN_TO_MAX_LENGTH - 1)}`;
    expect(isSafeReturnPath(atCap)).toBe(true);
  });

  it("refuses a path one character past the length cap", () => {
    const pastCap = `/${"a".repeat(RETURN_TO_MAX_LENGTH)}`;
    expect(isSafeReturnPath(pastCap)).toBe(false);
  });

  it("caps a return path at 2048 characters", () => {
    expect(RETURN_TO_MAX_LENGTH).toBe(2048);
  });
});

describe("returnToSchema", () => {
  it("parses a safe path to itself", () => {
    expect(returnToSchema.safeParse("/repos/424242/pulls/1").data).toBe(
      "/repos/424242/pulls/1",
    );
  });

  it.each([undefined, 42, "//evil.example"])("refuses %j", (value) => {
    expect(returnToSchema.safeParse(value).success).toBe(false);
  });
});
