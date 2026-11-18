import { GitHubApiErrorCodes } from "github";
import { describe, expect, it } from "vitest";
import { wrapBytesFailure, wrapDenial } from "./read-failures";

const REFUSED_RANGE = {
  code: GitHubApiErrorCodes.REQUEST_FAILED,
  status: 416,
  message: "x",
};
const NOT_FOUND = {
  code: GitHubApiErrorCodes.NOT_FOUND,
  status: 404,
  message: "x",
};

describe("wrapDenial", () => {
  it("passes a value through and wraps a refusal whole", () => {
    expect(wrapDenial({ ok: true, value: 1 })).toEqual({ ok: true, value: 1 });
    expect(wrapDenial({ ok: false, error: NOT_FOUND })).toEqual({
      ok: false,
      error: { kind: "github-denied", error: NOT_FOUND },
    });
  });
});

describe("wrapBytesFailure", () => {
  it("reads an upstream 416 as an unsatisfiable range", () => {
    expect(wrapBytesFailure({ ok: false, error: REFUSED_RANGE })).toEqual({
      ok: false,
      error: { kind: "range-not-satisfiable" },
    });
  });

  it("reads any other refusal as a denial", () => {
    expect(wrapBytesFailure({ ok: false, error: NOT_FOUND })).toEqual({
      ok: false,
      error: { kind: "github-denied", error: NOT_FOUND },
    });
  });
});
