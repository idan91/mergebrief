// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { LANDSCAPE_PHONE_QUERY, MOBILE_QUERY } from "../useMobileViewport";
import { useViewportShape } from ".";
import { ViewportShapes } from "./types";

describe("useViewportShape", () => {
  afterEach(() => {
    cleanup();
    resetMediaQueries();
  });

  it("reads a desktop when no phone query matches", () => {
    const { result } = renderHook(() => useViewportShape());

    expect(result.current).toBe(ViewportShapes.DESKTOP);
  });

  it("reads a sideways phone over the wider phone query", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    setMediaQueryMatches(LANDSCAPE_PHONE_QUERY, true);
    const { result } = renderHook(() => useViewportShape());

    expect(result.current).toBe(ViewportShapes.LANDSCAPE_PHONE);
  });

  it("follows a rotation from upright to sideways", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    const { result } = renderHook(() => useViewportShape());
    expect(result.current).toBe(ViewportShapes.PHONE);

    act(() => setMediaQueryMatches(LANDSCAPE_PHONE_QUERY, true));

    expect(result.current).toBe(ViewportShapes.LANDSCAPE_PHONE);
  });
});
