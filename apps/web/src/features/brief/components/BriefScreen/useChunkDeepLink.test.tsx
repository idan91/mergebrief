// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useChunkDeepLink } from "./useChunkDeepLink";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("useChunkDeepLink", () => {
  it("lands once on the chunk the hash names when the brief mounts", () => {
    window.location.hash = "#chunk-c2";
    const land = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ briefId }) =>
        useChunkDeepLink({
          briefId,
          chunkIds: ["c1", "c2"],
          enabled: true,
          land,
        }),
      { initialProps: { briefId: "brief-a" } },
    );
    rerender({ briefId: "brief-a" });

    expect(land).toHaveBeenCalledTimes(1);
    expect(land).toHaveBeenCalledWith("c2");
  });

  it("ignores a hash naming no chunk of this brief", () => {
    window.location.hash = "#chunk-c9";
    const land = vi.fn(() => true);
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        enabled: true,
        land,
      }),
    );

    expect(land).not.toHaveBeenCalled();
  });

  it("stands down while a thread target owns the arrival", () => {
    window.location.hash = "#chunk-c1";
    const land = vi.fn(() => true);
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        enabled: false,
        land,
      }),
    );

    expect(land).not.toHaveBeenCalled();
  });

  it("stays stood down once a thread arrival has yielded to", () => {
    window.location.hash = "#chunk-c1";
    const land = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ enabled }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds: ["c1"],
          enabled,
          land,
        }),
      { initialProps: { enabled: false } },
    );
    rerender({ enabled: true });

    expect(land).not.toHaveBeenCalled();
  });

  it("waits for the chunk list to carry the id, then lands once", () => {
    window.location.hash = "#chunk-c2";
    const land = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ chunkIds }) =>
        useChunkDeepLink({ briefId: "brief-a", chunkIds, enabled: true, land }),
      { initialProps: { chunkIds: ["c1"] } },
    );
    rerender({ chunkIds: ["c1", "c2"] });
    rerender({ chunkIds: ["c1", "c2", "c3"] });

    expect(land).toHaveBeenCalledTimes(1);
  });

  it("keeps the landing for a later attempt when it could not be scheduled", () => {
    window.location.hash = "#chunk-c1";
    const refused = vi.fn(() => false);
    const scheduled = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ land }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds: ["c1"],
          enabled: true,
          land,
        }),
      { initialProps: { land: refused } },
    );
    rerender({ land: scheduled });
    rerender({ land: scheduled });

    expect(refused).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledTimes(1);
  });

  it("hands a line hash to the line landing, once", () => {
    window.location.hash = "#src/a.ts:R12-R20";
    const land = vi.fn(() => true);
    const landLine = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ briefId }) =>
        useChunkDeepLink({
          briefId,
          chunkIds: ["c1"],
          enabled: true,
          land,
          landLine,
        }),
      { initialProps: { briefId: "brief-a" } },
    );
    rerender({ briefId: "brief-a" });

    expect(land).not.toHaveBeenCalled();
    expect(landLine).toHaveBeenCalledTimes(1);
    expect(landLine).toHaveBeenCalledWith({
      file: "src/a.ts",
      side: "new",
      startLine: 12,
      endLine: 20,
    });
  });

  it("keeps a line landing for later when it could not be scheduled", () => {
    window.location.hash = "#src/a.ts:R12";
    const refused = vi.fn(() => false);
    const scheduled = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ landLine }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds: ["c1"],
          enabled: true,
          land: () => true,
          landLine,
        }),
      { initialProps: { landLine: refused } },
    );
    rerender({ landLine: scheduled });
    rerender({ landLine: scheduled });

    expect(refused).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledTimes(1);
  });

  it("ignores a hash the page wrote itself", () => {
    window.location.hash = "#src/a.ts:R12";
    const landLine = vi.fn(() => true);
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        enabled: true,
        land: () => true,
        landLine,
        writtenHash: { current: "#src/a.ts:R12" },
      }),
    );

    expect(landLine).not.toHaveBeenCalled();
  });

  it("lands again when the brief changes under the same hash", () => {
    window.location.hash = "#chunk-c1";
    const land = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ briefId }) =>
        useChunkDeepLink({ briefId, chunkIds: ["c1"], enabled: true, land }),
      { initialProps: { briefId: "brief-a" } },
    );
    rerender({ briefId: "brief-b" });

    expect(land).toHaveBeenCalledTimes(2);
  });
});
