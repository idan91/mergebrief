// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ViewportBands,
  type ViewportBand,
} from "@web/hooks/useViewportBoundary";
import { createReadingPositionStore } from "../reading/reading-position";
import { useFocusPanel } from "./useFocusPanel";

interface PanelProps {
  focusMode: boolean;
  band: ViewportBand;
}

function renderPanel(band: ViewportBand = ViewportBands.DESKTOP) {
  const position = createReadingPositionStore();
  position.getState().actions.setActive("a1", "group-a");
  const view = renderHook(
    (props: PanelProps) =>
      useFocusPanel({ position, focusMode: props.focusMode, band: props.band }),
    { initialProps: { focusMode: true, band } },
  );
  const moveTo = (chunkId: string, groupId: string) => {
    act(() => {
      position.getState().actions.setActive(chunkId, groupId);
    });
  };
  return { ...view, moveTo };
}

describe("useFocusPanel", () => {
  it("starts open", () => {
    const { result } = renderPanel();
    expect(result.current.open).toBe(true);
  });

  it("stays closed while the reader steps within the group", () => {
    const { result, moveTo } = renderPanel();
    act(() => result.current.toggle());
    moveTo("a2", "group-a");
    expect(result.current.open).toBe(false);
  });

  it("opens on entering a new group", () => {
    const { result, moveTo } = renderPanel();
    act(() => result.current.close());
    moveTo("b1", "group-b");
    expect(result.current.open).toBe(true);
  });

  it("counts a return to a closed group as entering it", () => {
    const { result, moveTo } = renderPanel();
    act(() => result.current.close());
    moveTo("b1", "group-b");
    act(() => result.current.close());
    moveTo("a1", "group-a");
    expect(result.current.open).toBe(true);
  });

  it("resets to open on entering focus mode", () => {
    const { result, rerender } = renderPanel();
    act(() => result.current.close());
    rerender({ focusMode: false, band: ViewportBands.DESKTOP });
    rerender({ focusMode: true, band: ViewportBands.DESKTOP });
    expect(result.current.open).toBe(true);
  });

  it("starts the narrow sheet closed and keeps it shut across groups", () => {
    const { result, moveTo } = renderPanel(ViewportBands.NARROW);
    expect(result.current).toMatchObject({ open: false, sheet: true });
    moveTo("b1", "group-b");
    expect(result.current.open).toBe(false);
  });

  it("closes the sheet on crossing the breakpoint and restores desktop", () => {
    const { result, rerender } = renderPanel();
    act(() => result.current.close());
    rerender({ focusMode: true, band: ViewportBands.NARROW });
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ open: true, sheet: true });

    rerender({ focusMode: true, band: ViewportBands.DESKTOP });
    expect(result.current).toMatchObject({ open: false, sheet: false });
    rerender({ focusMode: true, band: ViewportBands.NARROW });
    expect(result.current.open).toBe(false);
  });

  it("starts the sheet closed on every entry into focus mode", () => {
    const { result, rerender } = renderPanel(ViewportBands.NARROW);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);

    rerender({ focusMode: false, band: ViewportBands.NARROW });
    rerender({ focusMode: true, band: ViewportBands.NARROW });
    expect(result.current.open).toBe(false);
  });
});
