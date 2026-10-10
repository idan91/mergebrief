// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createExpansionStore,
  readExpansion,
  useCreateExpansionStore,
} from "./useExpansion";

afterEach(cleanup);

describe("hunk edge expansion store", () => {
  it("records the lines an edge just read", () => {
    const store = createExpansionStore();

    store.getState().actions.expandEdge("chunk-a:3:down", {
      start: 2,
      end: 21,
    });

    expect(readExpansion(store.getState(), "chunk-a:3:down")).toEqual({
      range: { start: 2, end: 21 },
      ranges: [{ start: 2, end: 21 }],
    });
  });

  it("widens an edge that has already expanded once", () => {
    const store = createExpansionStore();
    const actions = store.getState().actions;

    actions.expandEdge("chunk-a:3:down", { start: 2, end: 21 });
    actions.expandEdge("chunk-a:3:down", { start: 22, end: 41 }, 60);

    expect(readExpansion(store.getState(), "chunk-a:3:down")).toEqual({
      range: { start: 2, end: 41 },
      ranges: [
        { start: 2, end: 21 },
        { start: 22, end: 41 },
      ],
      totalLines: 60,
    });
  });

  it("records the file end by path when the read names it", () => {
    const store = createExpansionStore();
    const actions = store.getState().actions;

    actions.expandEdge("chunk-a:3:down", { start: 2, end: 21 }, 60, "src/a.ts");
    actions.expandEdge(
      "chunk-b:9:up",
      { start: 30, end: 49 },
      undefined,
      "src/a.ts",
    );

    expect(store.getState().fileEnds.get("src/a.ts")).toBe(60);
  });

  it("keeps the file end once a read has reported it", () => {
    const store = createExpansionStore();
    const actions = store.getState().actions;

    actions.expandEdge("chunk-a:3:down", { start: 2, end: 21 }, 60);
    actions.expandEdge("chunk-a:3:down", { start: 22, end: 41 });

    expect(readExpansion(store.getState(), "chunk-a:3:down")?.totalLines).toBe(
      60,
    );
  });

  it("keeps each edge of each chunk apart", () => {
    const store = createExpansionStore();

    store
      .getState()
      .actions.expandEdge("chunk-a:3:down", { start: 2, end: 21 });

    expect(readExpansion(store.getState(), "chunk-a:3:up")).toBeUndefined();
  });
});

describe("expansion store per brief", () => {
  it("starts a switched brief with a fresh store and no expansion", () => {
    let briefId = "brief-a";
    const { result, rerender } = renderHook(() =>
      useCreateExpansionStore(briefId),
    );
    const first = result.current;
    first.getState().actions.expandEdge("c1:1:up", { start: 25, end: 29 });

    briefId = "brief-b";
    rerender();

    expect(result.current).not.toBe(first);
    expect(result.current.getState().expandedEdges.size).toBe(0);
    expect(result.current.getState().fileEnds.size).toBe(0);
  });

  it("keeps the store and its expansion across a same-brief render", () => {
    const { result, rerender } = renderHook(() =>
      useCreateExpansionStore("brief-a"),
    );
    const first = result.current;
    first.getState().actions.expandEdge("c1:1:up", { start: 25, end: 29 });

    rerender();

    expect(result.current).toBe(first);
    expect(readExpansion(result.current.getState(), "c1:1:up")?.range).toEqual({
      start: 25,
      end: 29,
    });
  });
});
