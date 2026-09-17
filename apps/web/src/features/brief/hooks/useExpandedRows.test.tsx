// @vitest-environment jsdom
import type { DiffLine } from "@web/utils/diffTokens/types";
import { appI18n } from "../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import {
  createReviewFlowStore,
  initialReviewFlowState,
  ReviewFlowProvider,
} from "@web/features/review/session";
import { fileRangeQueryKey } from "../queries";
import { useExpandedRows } from "./useExpandedRows";
import {
  ExpansionSourceProvider,
  type ExpansionSource,
} from "./useExpansionSource";

const HEAD = "b".repeat(40);
const SOURCE: ExpansionSource = { repoId: "repo-1", prNumber: 7, ref: HEAD };
const rows: DiffLine[] = [
  { kind: "hunk", content: "@@ -33,2 +30,2 @@" },
  { kind: "ctx", content: "a", oldLine: 33, newLine: 30 },
  { kind: "add", content: "c", newLine: 31 },
];

function setup(source: ExpansionSource | undefined) {
  const queryClient = new QueryClient();
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
      reanchorComment: vi.fn(),
    },
    initialReviewFlowState({
      composerDisabledReason: undefined,
      flagsReadOnly: false,
      postingCommentIds: new Set(),
      postBlockedExternally: undefined,
      postComment: undefined,
    }),
    appI18n.t,
  );
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ExpansionSourceProvider source={source}>
          <ReviewFlowProvider store={flowStore}>{children}</ReviewFlowProvider>
        </ExpansionSourceProvider>
      </QueryClientProvider>
    );
  }
  return { queryClient, flowStore, wrapper };
}

describe("useExpandedRows", () => {
  it("returns the base rows, no edges and no key without a source", () => {
    const { wrapper } = setup(undefined);
    const { result } = renderHook(
      () =>
        useExpandedRows({ chunkId: "c1", path: "src/a.ts", rows, claimed: [] }),
      { wrapper },
    );

    expect(result.current.rows).toEqual(rows);
    expect(result.current.edges).toEqual([]);
    expect(result.current.expansionKey).toBeUndefined();
    expect(result.current.baseIndexOf).toEqual([0, 1, 2]);
  });

  it("splices a stored edge from the cached window and names the state", () => {
    const { queryClient, flowStore, wrapper } = setup(SOURCE);
    queryClient.setQueryData(
      fileRangeQueryKey({ ...SOURCE, path: "src/a.ts", from: 25, to: 29 }),
      {
        kind: "ready",
        range: {
          path: "src/a.ts",
          ref: HEAD,
          from: 25,
          to: 29,
          lines: ["v", "w", "x", "y", "z"],
          totalLines: 90,
        },
      },
    );
    const { result } = renderHook(
      () =>
        useExpandedRows({ chunkId: "c1", path: "src/a.ts", rows, claimed: [] }),
      { wrapper },
    );
    act(() => {
      flowStore
        .getState()
        .actions.expandEdge("c1:1:up", { start: 25, end: 29 });
    });

    expect(result.current.rows.map((row) => row.kind)).toEqual([
      "hunk",
      ...Array<string>(5).fill("ctx"),
      "ctx",
      "add",
    ]);
    expect(result.current.rows.map((row) => row.origin)).toEqual([
      undefined,
      ...Array<string>(5).fill("expanded"),
      undefined,
      undefined,
    ]);
    expect(result.current.rows[1]).toMatchObject({
      oldLine: 28,
      newLine: 25,
      content: "v",
    });
    expect(result.current.baseIndexOf).toEqual([0, -1, -1, -1, -1, -1, 1, 2]);
    expect(result.current.expansionKey).toBe("c1:1:up=25-29");
    const up = result.current.edges.find((edge) => edge.edgeKey === "c1:1:up");
    expect(up).toMatchObject({ rowIndex: 1, gap: { from: 1, to: 29 } });
  });
});
