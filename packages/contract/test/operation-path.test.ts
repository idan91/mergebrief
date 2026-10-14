// A row's path filled by id: every param encoded, a missing or dot-segment
// param refused before any request is built.
import { describe, expect, it } from "vitest";
import {
  buildOperationPath,
  ProductActionIds,
  ProductQueryIds,
} from "../src/index";

describe("buildOperationPath", () => {
  it("fills every param from the row", () => {
    const path = buildOperationPath(ProductQueryIds.READ_PULL, {
      repoId: "424242",
      prNumber: 7,
    });

    expect(path).toBe("/api/repos/424242/pulls/7");
  });

  it("encodes a param that would otherwise add a segment", () => {
    const path = buildOperationPath(ProductActionIds.REPLY_TO_COMMENT, {
      repoId: "org/repo",
      prNumber: 7,
      commentId: "a b",
    });

    expect(path).toBe("/api/repos/org%2Frepo/pulls/7/comments/a%20b/replies");
  });

  it("returns a paramless path as written", () => {
    expect(buildOperationPath(ProductQueryIds.LIST_INBOX, {})).toBe(
      "/api/inbox",
    );
  });

  it.each([".", ".."])("refuses the dot segment %s", (segment) => {
    expect(() =>
      buildOperationPath(ProductQueryIds.READ_STACK, {
        repoId: segment,
        prNumber: 7,
      }),
    ).toThrow(/dot segment/);
  });

  it("refuses a missing param", () => {
    const params = { repoId: "1" } as unknown as {
      repoId: string;
      prNumber: number;
    };

    expect(() => buildOperationPath(ProductQueryIds.READ_DIFF, params)).toThrow(
      /missing path param :prNumber/,
    );
  });
});
