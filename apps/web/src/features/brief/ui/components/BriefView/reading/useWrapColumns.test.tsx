// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { MOBILE_QUERY } from "@web/hooks/useMobileViewport";
import {
  resetMediaQueries,
  resetViewportWidth,
  setMediaQueryMatches,
  setViewportWidth,
} from "@web/test/setup";
import {
  DESKTOP_WRAP_COLUMNS,
  derivePhoneWrapColumns,
} from "./chunk-height-model";
import { CARD_BLEED_QUERY, useWrapColumns } from "./useWrapColumns";

function WrapColumnsProbe() {
  const columns = useWrapColumns();
  return (
    <output>{`${String(columns.unified)}/${String(columns.split)}`}</output>
  );
}

function stubUprightPhone(): void {
  setMediaQueryMatches(MOBILE_QUERY, true);
  setMediaQueryMatches(CARD_BLEED_QUERY, true);
  setViewportWidth(390);
}

describe("useWrapColumns", () => {
  afterEach(() => {
    resetMediaQueries();
    resetViewportWidth();
    document.documentElement.style.fontSize = "";
  });

  it.each([881, 1024, 1440])("keeps the desktop's columns at %ipx", (width) => {
    setViewportWidth(width);
    const { result } = renderHook(() => useWrapColumns());

    expect(result.current).toEqual(DESKTOP_WRAP_COLUMNS);
  });

  it("reads the columns a 390px phone fits", () => {
    stubUprightPhone();
    const { result } = renderHook(() => useWrapColumns());

    expect(result.current).toEqual(
      derivePhoneWrapColumns({ widthPx: 390, cardBleeds: true }),
    );
  });

  it("reads an upright tablet's gutter from the bleed query", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    setViewportWidth(768);
    const { result } = renderHook(() => useWrapColumns());

    expect(result.current).toEqual({ unified: 76, split: 32 });
  });

  it("follows a rotation from upright to sideways", () => {
    stubUprightPhone();
    const { result } = renderHook(() => useWrapColumns());

    act(() => {
      setMediaQueryMatches(CARD_BLEED_QUERY, false);
      setViewportWidth(844);
    });

    expect(result.current).toEqual(
      derivePhoneWrapColumns({ widthPx: 844, cardBleeds: false }),
    );
  });

  it("keeps the same columns object while a resize moves no count", () => {
    stubUprightPhone();
    const { result } = renderHook(() => useWrapColumns());
    const before = result.current;

    act(() => setViewportWidth(392));

    expect(result.current).toBe(before);
  });

  it("ignores a pinch zoom that shrinks only the visual viewport", () => {
    stubUprightPhone();
    const { result } = renderHook(() => useWrapColumns());
    const before = result.current;

    act(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 195,
      });
      window.dispatchEvent(new Event("resize"));
    });

    expect(result.current).toBe(before);
  });

  it("sizes the code inside a classic scrollbar", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    setViewportWidth(880);
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 863,
    });
    const { result } = renderHook(() => useWrapColumns());

    expect(result.current).toEqual(
      derivePhoneWrapColumns({ widthPx: 863, cardBleeds: false }),
    );
  });

  it("sizes the code by the root font a reader enlarged", () => {
    stubUprightPhone();
    document.documentElement.style.fontSize = "20px";
    const { result } = renderHook(() => useWrapColumns());

    expect(result.current).toEqual(
      derivePhoneWrapColumns({ widthPx: 390, cardBleeds: true, remPx: 20 }),
    );
  });

  it("renders the desktop's columns on the server at any width", () => {
    stubUprightPhone();
    const html = renderToString(<WrapColumnsProbe />);

    expect(html).toContain("125/58");
  });
});
