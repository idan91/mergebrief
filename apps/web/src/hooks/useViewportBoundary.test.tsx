// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "../test/setup";
import {
  TABLET_BREAKPOINT_PX,
  useViewportBoundary,
} from "./useViewportBoundary";

const NARROW_QUERY = `(width <= ${TABLET_BREAKPOINT_PX}px)`;

afterEach(resetMediaQueries);

describe("useViewportBoundary", () => {
  it("reports desktop while the query does not match", () => {
    const { result } = renderHook(() => useViewportBoundary());
    expect(result.current).toBe("desktop");
  });

  it("reports narrow when the query matches at mount", () => {
    setMediaQueryMatches(NARROW_QUERY, true);
    const { result } = renderHook(() => useViewportBoundary());
    expect(result.current).toBe("narrow");
  });

  it("follows the query across a change event", () => {
    const { result } = renderHook(() => useViewportBoundary());

    act(() => setMediaQueryMatches(NARROW_QUERY, true));
    expect(result.current).toBe("narrow");

    act(() => setMediaQueryMatches(NARROW_QUERY, false));
    expect(result.current).toBe("desktop");
  });
});
