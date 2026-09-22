// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseInboxSearch } from "../search";
import type { InboxSearch } from "../types";
import { useInboxSearchState } from "./useInboxSearchState";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

afterEach(cleanup);
beforeEach(() => navigateMock.mockReset());

/** What the nth navigate would write, given the URL it finds at that moment. */
function readWrite(index: number, live: InboxSearch): unknown {
  const call: unknown = navigateMock.mock.calls[index]?.[0];
  if (typeof call !== "object" || call === null || !("search" in call)) {
    throw new Error("navigate was not called with a search");
  }
  const { search } = call;
  if (typeof search !== "function") throw new Error("search is not live");
  expect(call).toMatchObject({ to: "/", replace: true });
  return search(live);
}

describe("useInboxSearchState", () => {
  it("replaces a page past the end with the last page, once", () => {
    const { rerender } = renderHook(
      ({ page }: { page: number }) =>
        useInboxSearchState(parseInboxSearch({ page, review: "new" }), 30, 25),
      { initialProps: { page: 9 } },
    );

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(readWrite(0, { page: 9, review: "new" })).toEqual({
      page: 2,
      review: "new",
    });

    rerender({ page: 2 });
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  it("an empty list goes back to the first page; an unknown total waits", () => {
    renderHook(() =>
      useInboxSearchState(parseInboxSearch({ page: 3 }), undefined, undefined),
    );
    expect(navigateMock).not.toHaveBeenCalled();

    renderHook(() => useInboxSearchState(parseInboxSearch({ page: 3 }), 0, 25));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(readWrite(0, { page: 3 })).toEqual({});
  });

  it("a write reads the URL as it is when it lands, not as it was rendered", () => {
    const { result } = renderHook(() =>
      useInboxSearchState(parseInboxSearch({ page: 2 }), 60, 25),
    );

    result.current.write((live) => ({
      review: [...live.reviews, "new"].join(","),
    }));
    result.current.write((live) => ({
      review: [...live.reviews, "updated"].join(","),
    }));

    const afterFirst = readWrite(0, { page: 2 });
    expect(afterFirst).toEqual({ review: "new" });
    expect(readWrite(1, afterFirst as InboxSearch)).toEqual({
      review: "new,updated",
    });
  });

  it("clear goes back to the sort alone", () => {
    const { result } = renderHook(() =>
      useInboxSearchState(
        parseInboxSearch({ page: 2, review: "new", sort: "generated" }),
        60,
        25,
      ),
    );

    result.current.clear();

    expect(readWrite(0, { page: 2, review: "new", sort: "generated" })).toEqual(
      {
        sort: "generated",
      },
    );
  });
});
