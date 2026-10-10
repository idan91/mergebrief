// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BriefAddressSearch } from "../../../comparison/compareState";
import type { NavigateSearch, SearchNavigation } from "./types";
import { useBriefAddress } from "./useBriefAddress";

interface PageSearch extends BriefAddressSearch {
  rev?: number;
}

const PREVIOUS: PageSearch = {
  rev: 2,
  view: "changes",
  compare: "last-review",
  diff: "split",
  focus: true,
  l: "c1",
};

function stubNavigate() {
  return vi.fn<NavigateSearch<BriefAddressSearch>>(() => Promise.resolve());
}

function readSoleNavigation(
  navigate: ReturnType<typeof stubNavigate>,
): SearchNavigation<BriefAddressSearch> {
  expect(navigate).toHaveBeenCalledTimes(1);
  const [navigation] = navigate.mock.calls[0]!;

  return navigation;
}

describe("useBriefAddress", () => {
  afterEach(cleanup);

  it("hands the link param through as the URL carries it", () => {
    const { result } = renderHook(() =>
      useBriefAddress({ l: "c1.R4" }, stubNavigate()),
    );

    expect(result.current.link).toBe("c1.R4");
  });

  it("replaces the link and keeps the scroll and every other param", () => {
    const navigate = stubNavigate();
    const { result } = renderHook(() => useBriefAddress(PREVIOUS, navigate));

    result.current.navigateLink("c2.R1-R3");

    const navigation = readSoleNavigation(navigate);
    expect(navigation.replace).toBe(true);
    expect(navigation.resetScroll).toBe(false);
    expect(navigation.search(PREVIOUS)).toEqual({
      ...PREVIOUS,
      l: "c2.R1-R3",
    });
  });

  it("drops the link key when the link is cleared", () => {
    const navigate = stubNavigate();
    const { result } = renderHook(() => useBriefAddress(PREVIOUS, navigate));

    result.current.navigateLink(undefined);

    expect(readSoleNavigation(navigate).search(PREVIOUS)).not.toHaveProperty(
      "l",
    );
  });

  it("writes focus on and drops the key when it goes off", () => {
    const navigate = stubNavigate();
    const { result } = renderHook(() => useBriefAddress({}, navigate));

    result.current.setFocusParam(true);
    result.current.setFocusParam(false);

    const [on, off] = navigate.mock.calls.map(([navigation]) => navigation);
    expect(on?.search({ l: "c1" })).toEqual({ l: "c1", focus: true });
    expect(on?.replace).toBe(true);
    expect(on?.resetScroll).toBe(false);
    expect(off?.search(PREVIOUS)).not.toHaveProperty("focus");
  });

  it("drops the diff param with replace", () => {
    const navigate = stubNavigate();
    const { result } = renderHook(() => useBriefAddress(PREVIOUS, navigate));

    result.current.clearDiffParam();

    const navigation = readSoleNavigation(navigate);
    expect(navigation.replace).toBe(true);
    expect(navigation.search(PREVIOUS)).toEqual({
      rev: 2,
      view: "changes",
      compare: "last-review",
      focus: true,
      l: "c1",
    });
  });

  it("replaces the whole View, Compare and diff trio", () => {
    const navigate = stubNavigate();
    const { result } = renderHook(() => useBriefAddress(PREVIOUS, navigate));

    result.current.navigateSearch({ view: "full" });

    const navigation = readSoleNavigation(navigate);
    expect(navigation.replace).toBe(false);
    expect(navigation.search(PREVIOUS)).toEqual({
      rev: 2,
      focus: true,
      l: "c1",
      view: "full",
    });
  });

  it("replaces history on a Scope write that asks for it", () => {
    const navigate = stubNavigate();
    const { result } = renderHook(() => useBriefAddress(PREVIOUS, navigate));

    result.current.navigateSearch({ view: "full" }, { replace: true });

    expect(readSoleNavigation(navigate).replace).toBe(true);
  });

  it("keeps every writer stable across a search change", () => {
    const navigate = stubNavigate();
    const { result, rerender } = renderHook(
      ({ search }) => useBriefAddress(search, navigate),
      { initialProps: { search: PREVIOUS } },
    );
    const first = result.current;

    rerender({ search: { ...PREVIOUS, l: "c9" } });

    expect(result.current.link).toBe("c9");
    expect(result.current.navigateLink).toBe(first.navigateLink);
    expect(result.current.setFocusParam).toBe(first.setFocusParam);
    expect(result.current.clearDiffParam).toBe(first.clearDiffParam);
    expect(result.current.navigateSearch).toBe(first.navigateSearch);
  });
});
