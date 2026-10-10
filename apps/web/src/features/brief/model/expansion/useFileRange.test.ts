import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { buildFileRangeQueryKey, type FileRangeResult } from "../../queries";
import { FileRangeResultKinds } from "./types";
import type { ExpansionSource } from "./useExpansionSource";
import { fetchFileRange } from "./useFileRange";

const SOURCE: ExpansionSource = {
  repoId: "repo-1",
  prNumber: 7,
  ref: "a".repeat(40),
};
const PATH = "src/a.ts";

function stubCachedRead(result: FileRangeResult): QueryClient {
  const queryClient = new QueryClient();
  const key = buildFileRangeQueryKey({ ...SOURCE, path: PATH, from: 3, to: 4 });
  queryClient.setQueryData(key, result);
  return queryClient;
}

describe("fetchFileRange", () => {
  it("answers a read with its wire range as head-file lines", async () => {
    const queryClient = stubCachedRead({
      kind: FileRangeResultKinds.READY,
      range: {
        path: PATH,
        ref: SOURCE.ref,
        from: 3,
        to: 4,
        lines: ["c", "d"],
        totalLines: 9,
      },
    });

    const read = await fetchFileRange(queryClient, SOURCE, PATH, {
      start: 3,
      end: 4,
    });

    expect(read).toEqual({
      kind: FileRangeResultKinds.READY,
      range: { start: 3, end: 4 },
      totalLines: 9,
    });
  });

  it("passes a refusal through as its kind", async () => {
    const queryClient = stubCachedRead({ kind: FileRangeResultKinds.NOT_TEXT });

    const read = await fetchFileRange(queryClient, SOURCE, PATH, {
      start: 3,
      end: 4,
    });

    expect(read).toEqual({ kind: FileRangeResultKinds.NOT_TEXT });
  });

  it("reads nothing without a source or for a range the route refuses", async () => {
    const queryClient = new QueryClient();

    const unsourced = await fetchFileRange(queryClient, undefined, PATH, {
      start: 3,
      end: 4,
    });
    const reversed = await fetchFileRange(queryClient, SOURCE, PATH, {
      start: 4,
      end: 3,
    });

    expect(unsourced).toBeUndefined();
    expect(reversed).toBeUndefined();
  });
});
