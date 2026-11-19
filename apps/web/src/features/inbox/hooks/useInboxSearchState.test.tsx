// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseInboxSearch } from "../search";
import type { InboxSearch } from "../types";
import { useInboxSearchState } from "./useInboxSearchState";

interface HistoryEvent {
  readonly location: { readonly pathname: string; readonly q?: string };
  readonly action: { readonly type: string };
}

const navigateMock = vi.fn();
const historyListeners = new Set<(event: HistoryEvent) => void>();
/** The router as the hook reads it: history events in, the target's path and search out. */
const routerStub = {
  history: {
    subscribe: (listener: (event: HistoryEvent) => void) => {
      historyListeners.add(listener);
      return () => historyListeners.delete(listener);
    },
  },
  parseLocation: ({ pathname, q }: HistoryEvent["location"]) => ({
    pathname,
    search: q === undefined ? {} : { q },
  }),
};
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useRouter: () => routerStub,
}));

beforeEach(() => {
  navigateMock.mockReset();
  historyListeners.clear();
});

function emitHistory(type: string, pathname: string, q?: string): void {
  const location = q === undefined ? { pathname } : { pathname, q };
  act(() => {
    for (const listener of historyListeners) {
      listener({ location, action: { type } });
    }
  });
}

/** What the nth navigate would write, given the URL it finds at that moment. */
function readWrite(index: number, live: InboxSearch): unknown {
  const call: unknown = navigateMock.mock.calls[index]?.[0];
  if (typeof call !== "object" || call === null || !("search" in call)) {
    throw new Error("navigate was not called with a search");
  }
  const { search } = call;
  if (typeof search !== "function") {
    throw new Error("search is not live");
  }
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

  it("dropping the pending search text keeps a filter loading beside it", () => {
    const shown = parseInboxSearch({ review: "new" });
    const { result } = renderHook(() => useInboxSearchState(shown, 30, 25));

    result.current.dropPendingSearchText();

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock.mock.calls[0]?.[0]).toMatchObject({
      resetScroll: false,
    });
    expect(readWrite(0, { review: "new", q: "fo" })).toEqual({
      review: "new",
    });
    expect(readWrite(0, { review: "new", author: "mine", q: "fo" })).toEqual({
      review: "new",
      author: "mine",
    });
  });

  it("every Clear overrides the search text with none", () => {
    const shown = parseInboxSearch({ review: "new", q: "fo" });
    const { result } = renderHook(() => useInboxSearchState(shown, 30, 25));
    expect(result.current.searchTextOverride).toEqual({ count: 0, text: "" });

    act(() => result.current.clear());

    expect(result.current.searchTextOverride).toEqual({ count: 1, text: "" });
  });
});

describe("useInboxSearchState, a navigation that is not a write", () => {
  function renderState() {
    const shown = parseInboxSearch({});
    return renderHook(() => useInboxSearchState(shown, 30, 25)).result;
  }

  it.each(["BACK", "FORWARD", "GO", "PUSH"])(
    "a %s onto Home overrides the search text with the target's",
    (type) => {
      const result = renderState();

      emitHistory(type, "/", "ledg");

      expect(result.current.searchTextOverride).toEqual({
        count: 1,
        text: "ledg",
      });
    },
  );

  it("a target with no search text overrides with none", () => {
    const result = renderState();

    emitHistory("BACK", "/");

    expect(result.current.searchTextOverride).toEqual({ count: 1, text: "" });
  });

  it("a replace is one of the list's own writes and overrides nothing", () => {
    const result = renderState();

    emitHistory("REPLACE", "/", "ledg");

    expect(result.current.searchTextOverride.count).toBe(0);
  });

  it("a navigation away from Home leaves the field alone", () => {
    const result = renderState();

    emitHistory("PUSH", "/repos/1/pulls/2");

    expect(result.current.searchTextOverride.count).toBe(0);
  });

  it("stops listening once Home is gone", () => {
    const { unmount } = renderHook(() =>
      useInboxSearchState(parseInboxSearch({}), 30, 25),
    );

    unmount();

    expect(historyListeners.size).toBe(0);
  });
});
