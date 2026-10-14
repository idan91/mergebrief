// A command's request URL: the operation row's path, then its query in the
// order given, each value percent-encoded the way the commands always sent it.
import { ProductActionIds, ProductQueryIds } from "contract";
import { describe, expect, it } from "vitest";
import { buildRequestPath } from "../src/commands/request-path";

describe("buildRequestPath", () => {
  it("fills the row's path", () => {
    const path = buildRequestPath(ProductQueryIds.READ_PULL, {
      repoId: "424242",
      prNumber: 7,
    });

    expect(path).toBe("/api/repos/424242/pulls/7");
  });

  it("appends the query in order with every value encoded", () => {
    const path = buildRequestPath(
      ProductQueryIds.READ_NARRATIVE,
      { repoId: "424242", prNumber: 7 },
      { prevHead: "a b", head: "c&d" },
    );

    expect(path).toBe(
      "/api/repos/424242/pulls/7/narrative?prevHead=a%20b&head=c%26d",
    );
  });

  it("builds a draft's path with its id encoded", () => {
    const path = buildRequestPath(
      ProductActionIds.UPDATE_DRAFT_COMMENT,
      { repoId: "424242", prNumber: 7, draftId: "4 1" },
      { base: "b", head: "h" },
    );

    expect(path).toBe(
      "/api/repos/424242/pulls/7/session/comments/4%201?base=b&head=h",
    );
  });
});
