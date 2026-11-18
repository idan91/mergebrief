import { describe, expect, it } from "vitest";
import { isRefusedPath } from "./refused-paths";

describe("isRefusedPath", () => {
  it("matches the transport base and everything under it", () => {
    expect(isRefusedPath("/_serverFn")).toBe(true);
    expect(isRefusedPath("/_serverFn/")).toBe(true);
    expect(isRefusedPath("/_serverFn/abc123")).toBe(true);
  });

  it("matches an encoded base the way Start decodes it", () => {
    expect(isRefusedPath("/%5FserverFn/abc")).toBe(true);
    expect(isRefusedPath("/_server%46n/abc")).toBe(true);
  });

  it("refuses a path that will not decode, wherever it points", () => {
    expect(isRefusedPath("/%E0%A4%A")).toBe(true);
    expect(isRefusedPath("/api/pulls/%E0%A4%A")).toBe(true);
  });

  it("refuses a control character Start would strip before matching", () => {
    expect(isRefusedPath("/_serverFn%00/abc")).toBe(true);
    expect(isRefusedPath("/%00_serverFn/abc")).toBe(true);
    expect(isRefusedPath("/_server%09Fn/abc")).toBe(true);
    expect(isRefusedPath("/x/.%00./_serverFn/abc")).toBe(true);
    expect(isRefusedPath("/_serverFn%7F/abc")).toBe(true);
  });

  it("leaves pages, the api and lookalike paths alone", () => {
    expect(isRefusedPath("/")).toBe(false);
    expect(isRefusedPath("/api/pulls")).toBe(false);
    expect(isRefusedPath("/_serverFnx")).toBe(false);
    expect(isRefusedPath("/repos/_serverFn/1")).toBe(false);
  });
});
