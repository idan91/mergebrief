// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LANDSCAPE_PHONE_QUERY } from "@web/hooks/useMobileViewport";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { createReadingPositionStore } from "../reading/reading-position";
import { CONTENT_START_ATTR } from "../utils";
import { useRotationHold } from "./useRotationHold";

function mountSentinel(top: number): HTMLElement {
  const sentinel = document.createElement("div");
  sentinel.setAttribute(CONTENT_START_ATTR, "");
  sentinel.getBoundingClientRect = () => new DOMRect(0, top, 10, 0);
  document.body.append(sentinel);
  return sentinel;
}

function mountCard(id: string, top: number, bottom: number): void {
  const card = document.createElement("article");
  card.id = id;
  card.getBoundingClientRect = () => new DOMRect(0, top, 10, bottom - top);
  document.body.append(card);
}

function renderHold(top: number, cardTop = -100) {
  mountSentinel(top);
  mountCard("c2", cardTop, cardTop + 500);
  const store = createReadingPositionStore();
  store.getState().actions.setActive("c2", "g1");
  const placeChunkUnderStack = vi.fn();
  renderHook(() => useRotationHold(store, placeChunkUnderStack));
  return placeChunkUnderStack;
}

function rotate(): void {
  act(() => {
    setMediaQueryMatches(LANDSCAPE_PHONE_QUERY, true);
  });
}

describe("useRotationHold", () => {
  afterEach(() => {
    cleanup();
    resetMediaQueries();
    document.body.innerHTML = "";
  });

  it("lands on the chunk being read when the phone turns", () => {
    const placeChunkUnderStack = renderHold(-400);

    rotate();

    expect(placeChunkUnderStack).toHaveBeenCalledWith("c2");
  });

  it("stays put when the reader is in the Overview above the chunks", () => {
    const placeChunkUnderStack = renderHold(600);

    rotate();

    expect(placeChunkUnderStack).not.toHaveBeenCalled();
  });

  it("stays put when no chunk is on screen", () => {
    mountSentinel(-400);
    const store = createReadingPositionStore();
    store.getState().actions.setActive("c2", "g1");
    store.getState().actions.leaveChunks(false);
    const placeChunkUnderStack = vi.fn();
    renderHook(() => useRotationHold(store, placeChunkUnderStack));

    rotate();

    expect(placeChunkUnderStack).not.toHaveBeenCalled();
  });

  it("stays put when an upright reader has scrolled past the chunk", () => {
    const placeChunkUnderStack = renderHold(-2000, -900);

    rotate();

    expect(placeChunkUnderStack).not.toHaveBeenCalled();
  });

  it("lands on the chunk the spy names after the scroll", () => {
    mountSentinel(-2000);
    mountCard("c2", -900, -400);
    mountCard("c3", -100, 400);
    const store = createReadingPositionStore();
    store.getState().actions.setActive("c2", "g1");
    const placeChunkUnderStack = vi.fn();
    renderHook(() => useRotationHold(store, placeChunkUnderStack));
    act(() => {
      store.getState().actions.setActive("c3", "g1");
    });

    rotate();

    expect(placeChunkUnderStack).toHaveBeenCalledWith("c3");
  });

  it("does nothing on mount, so a chunk link keeps its own landing", () => {
    setMediaQueryMatches(LANDSCAPE_PHONE_QUERY, true);

    const placeChunkUnderStack = renderHold(-400);

    expect(placeChunkUnderStack).not.toHaveBeenCalled();
  });
});
