// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import {
  HOVERLESS_QUERY,
  openReleaseNotes,
  readHoverless,
  subscribeHoverless,
} from "./utils";

describe("openReleaseNotes", () => {
  it("opens nothing without a URL", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    openReleaseNotes(undefined);

    expect(open).not.toHaveBeenCalled();
  });
});

describe("readHoverless", () => {
  afterEach(() => {
    resetMediaQueries();
  });

  it("follows the hover media query", () => {
    expect(readHoverless()).toBe(false);

    setMediaQueryMatches(HOVERLESS_QUERY, true);

    expect(readHoverless()).toBe(true);
  });
});

describe("subscribeHoverless", () => {
  afterEach(() => {
    resetMediaQueries();
  });

  it("reports each change until unsubscribed", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeHoverless(onChange);

    setMediaQueryMatches(HOVERLESS_QUERY, true);
    unsubscribe();
    setMediaQueryMatches(HOVERLESS_QUERY, false);

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
