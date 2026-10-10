// @vitest-environment jsdom
// The post-now gate: one request per draft, refused synchronously, released on
// every settle, and never reset out from under a live request.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useInFlightDraftPosts } from "./useInFlightDraftPosts";

afterEach(cleanup);

describe("useInFlightDraftPosts", () => {
  it("refuses a duplicate synchronously and releases on settle", () => {
    const { result } = renderHook(() => useInFlightDraftPosts());

    // Both calls inside one act: the second must be refused before React has
    // rendered the disabled button.
    let first = false;
    let second = true;
    act(() => {
      first = result.current.begin("d1");
      second = result.current.begin("d1");
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect([...result.current.ids]).toEqual(["d1"]);

    act(() => result.current.end("d1"));
    expect([...result.current.ids]).toEqual([]);
    act(() => {
      first = result.current.begin("d1");
    });
    expect(first).toBe(true);
  });

  it("gates per draft, so distinct drafts post concurrently", () => {
    const { result } = renderHook(() => useInFlightDraftPosts());
    act(() => {
      result.current.begin("d1");
      result.current.begin("d2");
    });
    expect([...result.current.ids].toSorted()).toEqual(["d1", "d2"]);
    act(() => result.current.end("d1"));
    expect([...result.current.ids]).toEqual(["d2"]);
  });

  it("holds through a re-render: a brief switch never re-opens the gate", () => {
    // The screen outlives a brief switch, and a draft id carries across spans.
    // Dropping the entry there would re-enable Post under a live request.
    const { result, rerender } = renderHook(() => useInFlightDraftPosts());
    act(() => {
      result.current.begin("d1");
    });
    rerender();
    expect([...result.current.ids]).toEqual(["d1"]);
    expect(result.current.begin("d1")).toBe(false);
  });

  it("keeps one identity per transition", () => {
    const { result, rerender } = renderHook(() => useInFlightDraftPosts());
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
    act(() => {
      result.current.begin("d1");
    });
    expect(result.current).not.toBe(before);
  });
});
