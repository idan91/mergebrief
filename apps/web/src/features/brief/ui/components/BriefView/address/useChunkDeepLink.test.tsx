// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AddressEventKinds } from "./types";
import { useChunkDeepLink } from "./useChunkDeepLink";

const UNPARSED = { kind: AddressEventKinds.LINK_UNPARSED };

function stubAddress(ownLink?: string) {
  return {
    send: vi.fn(),
    isOwnLink: (link: string) => link === ownLink,
  };
}

describe("useChunkDeepLink", () => {
  it("scrolls once to the chunk the link names when the brief mounts", () => {
    const scrollToChunk = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ briefId }) =>
        useChunkDeepLink({
          briefId,
          chunkIds: ["c1", "c2"],
          link: "c2",
          enabled: true,
          scrollToChunk,
        }),
      { initialProps: { briefId: "brief-a" } },
    );
    rerender({ briefId: "brief-a" });

    expect(scrollToChunk).toHaveBeenCalledTimes(1);
    expect(scrollToChunk).toHaveBeenCalledWith("c2");
  });

  it("ignores a link naming no chunk of this brief", () => {
    const scrollToChunk = vi.fn(() => true);
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: "c9",
        enabled: true,
        scrollToChunk,
      }),
    );

    expect(scrollToChunk).not.toHaveBeenCalled();
  });

  it("does nothing without a link", () => {
    const scrollToChunk = vi.fn(() => true);
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: undefined,
        enabled: true,
        scrollToChunk,
      }),
    );

    expect(scrollToChunk).not.toHaveBeenCalled();
  });

  it("stands down while a thread target owns the arrival", () => {
    const scrollToChunk = vi.fn(() => true);
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: "c1",
        enabled: false,
        scrollToChunk,
      }),
    );

    expect(scrollToChunk).not.toHaveBeenCalled();
  });

  it("stays stood down once a thread arrival has yielded to", () => {
    const scrollToChunk = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ enabled }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds: ["c1"],
          link: "c1",
          enabled,
          scrollToChunk,
        }),
      { initialProps: { enabled: false } },
    );
    rerender({ enabled: true });

    expect(scrollToChunk).not.toHaveBeenCalled();
  });

  it("waits for the chunk list to carry the id, then scrolls once", () => {
    const scrollToChunk = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ chunkIds }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds,
          link: "c2",
          enabled: true,
          scrollToChunk,
        }),
      { initialProps: { chunkIds: ["c1"] } },
    );
    rerender({ chunkIds: ["c1", "c2"] });
    rerender({ chunkIds: ["c1", "c2", "c3"] });

    expect(scrollToChunk).toHaveBeenCalledTimes(1);
  });

  it("keeps the scroll for a later attempt when it could not be scheduled", () => {
    const refused = vi.fn(() => false);
    const scheduled = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ scrollToChunk }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds: ["c1"],
          link: "c1",
          enabled: true,
          scrollToChunk,
        }),
      { initialProps: { scrollToChunk: refused } },
    );
    rerender({ scrollToChunk: scheduled });
    rerender({ scrollToChunk: scheduled });

    expect(refused).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledTimes(1);
  });

  it("hands a line link to the line scroll, once", () => {
    const scrollToChunk = vi.fn(() => true);
    const scrollToLine = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ briefId }) =>
        useChunkDeepLink({
          briefId,
          chunkIds: ["c1"],
          link: "c1.R12-R20",
          enabled: true,
          scrollToChunk,
          scrollToLine,
        }),
      { initialProps: { briefId: "brief-a" } },
    );
    rerender({ briefId: "brief-a" });

    expect(scrollToChunk).not.toHaveBeenCalled();
    expect(scrollToLine).toHaveBeenCalledTimes(1);
    expect(scrollToLine).toHaveBeenCalledWith({
      chunkId: "c1",
      side: "new",
      startLine: 12,
      endLine: 20,
    });
  });

  it("keeps a line scroll for later when it could not be scheduled", () => {
    const refused = vi.fn(() => false);
    const scheduled = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ scrollToLine }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds: ["c1"],
          link: "c1.R12",
          enabled: true,
          scrollToChunk: () => true,
          scrollToLine,
        }),
      { initialProps: { scrollToLine: refused } },
    );
    rerender({ scrollToLine: scheduled });
    rerender({ scrollToLine: scheduled });

    expect(refused).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveBeenCalledTimes(1);
  });

  it("ignores a link the page wrote itself", () => {
    const scrollToLine = vi.fn(() => true);
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: "c1.R12",
        enabled: true,
        scrollToChunk: () => true,
        scrollToLine,
        address: stubAddress("c1.R12"),
      }),
    );

    expect(scrollToLine).not.toHaveBeenCalled();
  });

  it("scrolls again when the brief changes under the same link", () => {
    const scrollToChunk = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ briefId }) =>
        useChunkDeepLink({
          briefId,
          chunkIds: ["c1"],
          link: "c1",
          enabled: true,
          scrollToChunk,
        }),
      { initialProps: { briefId: "brief-a" } },
    );
    rerender({ briefId: "brief-b" });

    expect(scrollToChunk).toHaveBeenCalledTimes(2);
  });

  it("drops an unparseable link from the URL, once per brief", () => {
    const scrollToChunk = vi.fn(() => true);
    const scrollToLine = vi.fn(() => true);
    const address = stubAddress();
    const { rerender } = renderHook(
      ({ briefId }) =>
        useChunkDeepLink({
          briefId,
          chunkIds: ["c1"],
          link: "c1 R12",
          enabled: true,
          scrollToChunk,
          scrollToLine,
          address,
        }),
      { initialProps: { briefId: "brief-a" } },
    );
    rerender({ briefId: "brief-a" });

    expect(address.send).toHaveBeenCalledTimes(1);
    expect(address.send).toHaveBeenCalledWith(UNPARSED);
    expect(scrollToChunk).not.toHaveBeenCalled();
    expect(scrollToLine).not.toHaveBeenCalled();

    rerender({ briefId: "brief-b" });

    expect(address.send).toHaveBeenCalledTimes(2);
  });

  it("drops an unparseable link even while a thread owns the arrival", () => {
    const address = stubAddress();
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: "c1/R12",
        enabled: false,
        scrollToChunk: () => true,
        address,
      }),
    );

    expect(address.send).toHaveBeenCalledWith(UNPARSED);
  });

  it("leaves a parseable link it cannot scroll to yet in the URL", () => {
    const address = stubAddress();
    renderHook(() =>
      useChunkDeepLink({
        briefId: "brief-a",
        chunkIds: ["c1"],
        link: "c9",
        enabled: true,
        scrollToChunk: () => true,
        address,
      }),
    );

    expect(address.send).not.toHaveBeenCalled();
  });

  it("spends the one chance on the first link, not on a later one", () => {
    const scrollToChunk = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ link }) =>
        useChunkDeepLink({
          briefId: "brief-a",
          chunkIds: ["c1", "c2"],
          link,
          enabled: true,
          scrollToChunk,
        }),
      { initialProps: { link: "c1" } },
    );
    rerender({ link: "c2" });

    expect(scrollToChunk).toHaveBeenCalledTimes(1);
    expect(scrollToChunk).toHaveBeenCalledWith("c1");
  });
});
