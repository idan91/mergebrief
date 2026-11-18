import { describe, expect, it } from "vitest";
import { stripUrlQuery } from "../../src/tracing/url-query";

describe("stripUrlQuery", () => {
  it("drops the query and the fragment", () => {
    expect(stripUrlQuery("https://h/api/auth/callback?code=c&state=s")).toBe(
      "https://h/api/auth/callback",
    );
    expect(stripUrlQuery("/p#frag")).toBe("/p");
    expect(stripUrlQuery("/healthz")).toBe("/healthz");
  });
});
