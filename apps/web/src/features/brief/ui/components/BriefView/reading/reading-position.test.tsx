// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import {
  createReadingPositionStore,
  ReadingPositionProvider,
  useCreateReadingPositionStore,
  useReadingPosition,
} from "./reading-position";

describe("createReadingPositionStore", () => {
  it("setActive writes both halves together", () => {
    const store = createReadingPositionStore();
    store.getState().actions.setActive("c2", "g1");
    expect(store.getState().activeChunkId).toBe("c2");
    expect(store.getState().activeGroupId).toBe("g1");
  });
});

describe("useCreateReadingPositionStore", () => {
  it("keeps one store instance across re-renders", () => {
    const { result, rerender } = renderHook(
      ({ briefId }) => useCreateReadingPositionStore(briefId),
      { initialProps: { briefId: "brief-1" } },
    );
    const first = result.current;
    rerender({ briefId: "brief-1" });
    expect(result.current).toBe(first);
  });

  it("hands out a fresh empty store on a brief switch without remount", () => {
    // A fresh store, never a render-phase reset: resetting would notify the
    // still-mounted subscribers while their parent renders.
    const { result, rerender } = renderHook(
      ({ briefId }) => useCreateReadingPositionStore(briefId),
      { initialProps: { briefId: "brief-1" } },
    );
    const first = result.current;
    act(() => {
      first.getState().actions.setActive("c2", "g1");
    });
    rerender({ briefId: "brief-2" });
    expect(result.current).not.toBe(first);
    expect(result.current.getState().activeChunkId).toBeNull();
    expect(result.current.getState().activeGroupId).toBeNull();
  });
});

function ActiveChunkProbe() {
  const activeChunkId = useReadingPosition((state) => state.activeChunkId);
  return <output data-testid="probe">{activeChunkId ?? "none"}</output>;
}

describe("useReadingPosition", () => {
  it("throws outside a provider", () => {
    expect(() => renderHook(() => useReadingPosition((s) => s))).toThrow(
      /ReadingPositionProvider/,
    );
  });

  it("subscribes through the provider's store", () => {
    const store = createReadingPositionStore();
    render(
      <ReadingPositionProvider store={store}>
        <ActiveChunkProbe />
      </ReadingPositionProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("none");
    act(() => {
      store.getState().actions.setActive("c3", "g2");
    });
    expect(screen.getByTestId("probe").textContent).toBe("c3");
  });
});
