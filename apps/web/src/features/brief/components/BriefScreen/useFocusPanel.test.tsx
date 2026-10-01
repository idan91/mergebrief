// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createReadingPositionStore } from "./readingPosition";
import { useFocusPanel } from "./useFocusPanel";

afterEach(cleanup);

function renderPanel(focusMode = true) {
  const position = createReadingPositionStore();
  position.getState().actions.setActive("a1", "group-a");
  const view = renderHook(
    (props: { focusMode: boolean }) =>
      useFocusPanel({ position, focusMode: props.focusMode }),
    { initialProps: { focusMode } },
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
    rerender({ focusMode: false });
    rerender({ focusMode: true });
    expect(result.current.open).toBe(true);
  });
});
