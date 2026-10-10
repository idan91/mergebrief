// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useChunkDeepLink } from "./useChunkDeepLink";

afterEach(cleanup);

describe("useChunkDeepLink", () => {
  it("lands once on the chunk the link names when the brief mounts", () => {
    const land = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ briefId }) =>
        useChunkDeepLink({
          briefId,
          chunkIds: ["c1", "c2"],
          link: "c2",
          enabled: true,
          land,
        }),
      { initialProps: { briefId: "brief-a" } },
    );
    rerender({ briefId: "brief-a" });

    expect(land).toHaveBeenCalledTimes(1);
    expect(land).toHaveBeenCalledWith("c2");
  });

  it("ignores a link naming no chunk of this brief", () => {
    const land = vi.fn(() => true);
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: "c9",
        enabled: true,
        land,
      }),
    );

    expect(land).not.toHaveBeenCalled();
  });

  it("does nothing without a link", () => {
    const land = vi.fn(() => true);
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: undefined,
        enabled: true,
        land,
      }),
    );

    expect(land).not.toHaveBeenCalled();
  });

  it("stands down while a thread target owns the arrival", () => {
    const land = vi.fn(() => true);
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: "c1",
        enabled: false,
        land,
      }),
    );

    expect(land).not.toHaveBeenCalled();
  });

  it("stays stood down once a thread arrival has yielded to", () => {
    const land = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ enabled }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds: ["c1"],
          link: "c1",
          enabled,
          land,
        }),
      { initialProps: { enabled: false } },
    );
    rerender({ enabled: true });

    expect(land).not.toHaveBeenCalled();
  });

  it("waits for the chunk list to carry the id, then lands once", () => {
    const land = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ chunkIds }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds,
          link: "c2",
          enabled: true,
          land,
        }),
      { initialProps: { chunkIds: ["c1"] } },
    );
    rerender({ chunkIds: ["c1", "c2"] });
    rerender({ chunkIds: ["c1", "c2", "c3"] });

    expect(land).toHaveBeenCalledTimes(1);
  });

  it("keeps the landing for a later attempt when it could not be scheduled", () => {
    const refused = vi.fn(() => false);
    const scheduled = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ land }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds: ["c1"],
          link: "c1",
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

  it("hands a line link to the line landing, once", () => {
    const land = vi.fn(() => true);
    const landLine = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ briefId }) =>
        useChunkDeepLink({
          briefId,
          chunkIds: ["c1"],
          link: "c1.R12-R20",
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
      chunkId: "c1",
      side: "new",
      startLine: 12,
      endLine: 20,
    });
  });

  it("keeps a line landing for later when it could not be scheduled", () => {
    const refused = vi.fn(() => false);
    const scheduled = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ landLine }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds: ["c1"],
          link: "c1.R12",
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

  it("ignores a link the page wrote itself", () => {
    const landLine = vi.fn(() => true);
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: "c1.R12",
        enabled: true,
        land: () => true,
        landLine,
        writtenLink: { current: "c1.R12" },
      }),
    );

    expect(landLine).not.toHaveBeenCalled();
  });

  it("lands again when the brief changes under the same link", () => {
    const land = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ briefId }) =>
        useChunkDeepLink({
          briefId,
          chunkIds: ["c1"],
          link: "c1",
          enabled: true,
          land,
        }),
      { initialProps: { briefId: "brief-a" } },
    );
    rerender({ briefId: "brief-b" });

    expect(land).toHaveBeenCalledTimes(2);
  });

  it("drops an unparseable link from the URL, once per brief", () => {
    const land = vi.fn(() => true);
    const landLine = vi.fn(() => true);
    const navigateLink = vi.fn();
    const { rerender } = renderHook(
      ({ briefId }) =>
        useChunkDeepLink({
          briefId,
          chunkIds: ["c1"],
          link: "c1 R12",
          enabled: true,
          land,
          landLine,
          navigateLink,
        }),
      { initialProps: { briefId: "brief-a" } },
    );
    rerender({ briefId: "brief-a" });

    expect(navigateLink).toHaveBeenCalledTimes(1);
    expect(navigateLink).toHaveBeenCalledWith(undefined);
    expect(land).not.toHaveBeenCalled();
    expect(landLine).not.toHaveBeenCalled();

    rerender({ briefId: "brief-b" });

    expect(navigateLink).toHaveBeenCalledTimes(2);
  });

  it("drops an unparseable link even while a thread owns the arrival", () => {
    const navigateLink = vi.fn();
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: "c1/R12",
        enabled: false,
        land: () => true,
        navigateLink,
      }),
    );

    expect(navigateLink).toHaveBeenCalledWith(undefined);
  });

  it("leaves a parseable link it cannot land yet in the URL", () => {
    const navigateLink = vi.fn();
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: "c9",
        enabled: true,
        land: () => true,
        navigateLink,
      }),
    );

    expect(navigateLink).not.toHaveBeenCalled();
  });

  it("spends the one chance on the first link, not on a later one", () => {
    const land = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ link }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds: ["c1", "c2"],
          link,
          enabled: true,
          land,
        }),
      { initialProps: { link: "c1" } },
    );
    rerender({ link: "c2" });

    expect(land).toHaveBeenCalledTimes(1);
    expect(land).toHaveBeenCalledWith("c1");
  });
});
