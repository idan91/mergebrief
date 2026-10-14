import { ProductActionIds, ProductQueryIds } from "contract";
import { describe, expect, it } from "vitest";

import { buildInit, buildPath } from "./build-init";

describe("buildPath", () => {
  it("refuses a param that is a dot segment", () => {
    expect(() =>
      buildPath(ProductActionIds.MARK_READY, {
        params: { repoId: "..", prNumber: 7 },
      }),
    ).toThrow(/dot segment/);
  });

  it("fills the path from the row and encodes every param", () => {
    expect(
      buildPath(ProductActionIds.MARK_READY, {
        params: { repoId: "org/repo", prNumber: 7 },
      }),
    ).toBe("/api/repos/org%2Frepo/pulls/7/ready");
  });

  it("appends the query and skips undefined values", () => {
    expect(
      buildPath(ProductQueryIds.READ_DIFF, {
        params: { repoId: "1", prNumber: 2 },
        query: { base: "a b", head: "c", group: undefined },
      }),
    ).toBe("/api/repos/1/pulls/2/diff?base=a+b&head=c");
  });
});

describe("buildInit", () => {
  it("uses the row's method", () => {
    expect(
      buildInit(ProductQueryIds.READ_DIFF, {
        params: { repoId: "1", prNumber: 2 },
      }),
    ).toEqual({ method: "GET" });
    expect(
      buildInit(ProductActionIds.REVOKE_TOKEN, { params: { id: "tok" } }),
    ).toEqual({ method: "DELETE" });
  });

  it("sends a JSON body under the json content type", () => {
    expect(
      buildInit(ProductActionIds.DISMISS_VERSION_NOTICE, {
        params: {},
        body: { version: "1.2.3" },
      }),
    ).toEqual({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"version":"1.2.3"}',
    });
  });

  it("keeps a caller's content type whatever its casing", () => {
    expect(
      buildInit(ProductActionIds.DISMISS_VERSION_NOTICE, {
        params: {},
        body: { version: "1.2.3" },
        headers: { "Content-Type": "application/merge-patch+json" },
      }),
    ).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/merge-patch+json" },
      body: '{"version":"1.2.3"}',
    });
  });

  it("passes a Blob body through without a content type", () => {
    const image = new Blob(["png"], { type: "image/png" });
    expect(
      buildInit(ProductActionIds.UPLOAD_ATTACHMENT, {
        params: { repoId: "1", prNumber: 2 },
        body: image,
      }),
    ).toEqual({ method: "POST", body: image });
  });

  it("forwards headers, the signal and the 401 options", () => {
    const controller = new AbortController();
    expect(
      buildInit(ProductActionIds.REVOKE_SESSIONS, {
        params: {},
        headers: { "x-trial": "yes" },
        signal: controller.signal,
        unauthorizedIsSignedOut: true,
        unauthorizedLeavesForSignIn: false,
      }),
    ).toEqual({
      method: "DELETE",
      headers: { "x-trial": "yes" },
      signal: controller.signal,
      unauthorizedIsSignedOut: true,
      unauthorizedLeavesForSignIn: false,
    });
  });
});
