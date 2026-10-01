// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createReadingPositionStore } from "./readingPosition";
import { useFocusAddress, type UseFocusAddressInput } from "./useFocusAddress";

afterEach(cleanup);

const CHUNK_IDS = ["c1", "c2"];

type AddressProps = Pick<
  UseFocusAddressInput,
  "focusMode" | "focusInUrl" | "link" | "lineSelected" | "inChangesScope"
>;

function renderAddress(initial: AddressProps) {
  const position = createReadingPositionStore();
  const setFocusParam = vi.fn();
  const navigateLink = vi.fn();
  const startReadThrough = vi.fn();
  const writtenLink = { current: undefined as string | undefined };
  const view = renderHook(
    (props: AddressProps) =>
      useFocusAddress({
        ...props,
        setFocusParam,
        navigateLink,
        writtenLink,
        chunkIds: CHUNK_IDS,
        position,
        startReadThrough,
      }),
    { initialProps: initial },
  );
  const moveTo = (chunkId: string) => {
    act(() => {
      position.getState().actions.setActive(chunkId, "g1");
    });
  };
  return {
    view,
    setFocusParam,
    navigateLink,
    startReadThrough,
    writtenLink,
    moveTo,
  };
}

const READING: AddressProps = {
  focusMode: false,
  focusInUrl: false,
  link: undefined,
  lineSelected: false,
  inChangesScope: false,
};

const FOCUSED: AddressProps = { ...READING, focusMode: true, focusInUrl: true };

describe("useFocusAddress", () => {
  it("writes the focus param when the mode and the URL disagree", () => {
    const { view, setFocusParam } = renderAddress(READING);
    expect(setFocusParam).not.toHaveBeenCalled();

    view.rerender({ ...READING, focusMode: true });
    expect(setFocusParam).toHaveBeenCalledWith(true);
  });

  it("writes the active chunk to the link in focus mode", () => {
    const { view, navigateLink, writtenLink, moveTo } = renderAddress(READING);
    moveTo("c1");
    expect(navigateLink).not.toHaveBeenCalled();

    view.rerender(FOCUSED);
    expect(navigateLink).toHaveBeenLastCalledWith("c1");
    expect(writtenLink.current).toBe("c1");

    moveTo("c2");
    expect(navigateLink).toHaveBeenLastCalledWith("c2");
  });

  it("leaves the link to a live line selection", () => {
    const { navigateLink, moveTo } = renderAddress({
      ...READING,
      focusMode: true,
      focusInUrl: true,
      lineSelected: true,
    });
    moveTo("c2");
    expect(navigateLink).not.toHaveBeenCalled();
  });

  it("opens on the first chunk when focus arrives without a chunk link", () => {
    const { startReadThrough } = renderAddress({
      ...READING,
      focusMode: true,
      focusInUrl: true,
      link: "unknown-chunk",
    });
    expect(startReadThrough).toHaveBeenCalledTimes(1);
  });

  it("lets a chunk link land when focus arrives with one", () => {
    const { startReadThrough } = renderAddress({
      ...READING,
      focusMode: true,
      focusInUrl: true,
      link: "c2",
    });
    expect(startReadThrough).not.toHaveBeenCalled();
  });

  it("keeps an arriving line link when its landing moves the chunk", () => {
    const { navigateLink, moveTo } = renderAddress({
      ...FOCUSED,
      link: "c2.R10",
    });
    moveTo("c2");
    expect(navigateLink).not.toHaveBeenCalled();
  });

  it("writes no chunk link in Changes scope", () => {
    const { navigateLink, moveTo } = renderAddress({
      ...FOCUSED,
      inChangesScope: true,
    });
    moveTo("c2");
    expect(navigateLink).not.toHaveBeenCalled();
  });

  it("drops its own chunk link once the URL is in Changes scope", () => {
    const { view, navigateLink, writtenLink, moveTo } = renderAddress(FOCUSED);
    moveTo("c1");
    view.rerender({ ...FOCUSED, link: "c1" });
    expect(writtenLink.current).toBe("c1");

    view.rerender({ ...FOCUSED, link: "c1", inChangesScope: true });
    expect(navigateLink).toHaveBeenLastCalledWith(undefined);
    expect(writtenLink.current).toBeUndefined();
  });
});
