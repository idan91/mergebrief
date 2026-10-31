import { describe, expect, it } from "vitest";

import { parseRouteSearch } from "./search-params";

const DIGIT_SHA = "3000300030003000300030003000300030003000";
const EXPONENT_SHA = "1234567e89123456789012345678901234567890";

describe("parseRouteSearch", () => {
  it("keeps an all-digit SHA as its exact text", () => {
    expect(
      parseRouteSearch(`?base=${"a".repeat(40)}&head=${DIGIT_SHA}`),
    ).toEqual({ base: "a".repeat(40), head: DIGIT_SHA });
  });

  it("keeps a SHA of digits around one e as its exact text", () => {
    expect(parseRouteSearch(`?head=${EXPONENT_SHA}`)).toEqual({
      head: EXPONENT_SHA,
    });
  });

  it("still reads exact numbers, booleans and quoted strings as JSON", () => {
    expect(parseRouteSearch("?rev=2&thread=17&open=true&q=%2212%22")).toEqual({
      rev: 2,
      thread: 17,
      open: true,
      q: "12",
    });
  });
});
