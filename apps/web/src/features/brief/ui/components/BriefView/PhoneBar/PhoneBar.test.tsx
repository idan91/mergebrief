// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MOBILE_QUERY } from "@web/hooks/useMobileViewport";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../reading/reading-position";
import { CONTENT_START_ATTR } from "../utils";
import { PhoneBar, type PhoneBarProps } from ".";

const chunkIds = ["c1", "c2", "c3"];
const VIEWPORT_HEIGHT = 700;
const SHORT_PAGE_HEIGHT = 1000;

function renderBar(overrides: Partial<PhoneBarProps> = {}) {
  setMediaQueryMatches(MOBILE_QUERY, true);
  const sentinel = document.createElement("div");
  sentinel.setAttribute(CONTENT_START_ATTR, "");
  // jsdom lays nothing out: the sentinel starts below the stack, as on a page.
  sentinel.getBoundingClientRect = () => new DOMRect(0, 200, 10, 0);
  document.body.append(sentinel);
  const store = createReadingPositionStore();
  const jumpToChunk = vi.fn();
  const props: PhoneBarProps = {
    chunkIds,
    scope: "full",
    jumpToChunk,
    openBriefControls: vi.fn(),
    openChunks: vi.fn(),
    chunksExpanded: false,
    ...overrides,
  };
  render(
    <ReadingPositionProvider store={store}>
      <PhoneBar {...props} />
    </ReadingPositionProvider>,
  );
  const scrollPast = (past: boolean) => {
    sentinel.getBoundingClientRect = () =>
      new DOMRect(0, past ? -10 : 200, 10, 0);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
  };
  const setActive = (chunkId: string, groupId: string) => {
    act(() => {
      store.getState().actions.setActive(chunkId, groupId);
    });
  };
  return { props, jumpToChunk, scrollPast, setActive, sentinel };
}

describe("PhoneBar", () => {
  afterEach(() => {
    cleanup();
    resetMediaQueries();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document.documentElement, "scrollHeight");
    document
      .querySelectorAll(`[${CONTENT_START_ATTR}]`)
      .forEach((node) => node.remove());
  });

  it("offers no chunk steps in Changes, where the chunks are not on the page", () => {
    renderBar({ scope: "changes" });

    expect(screen.queryByRole("button", { name: "Next chunk" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous chunk" })).toBeNull();
  });

  it("reads Overview above the first chunk and the position past it", () => {
    const { scrollPast, setActive } = renderBar();
    const indicator = () => screen.getByTestId("chunk-indicator");
    expect(indicator().textContent).toContain("Overview");

    setActive("c2", "g1");
    expect(indicator().textContent).toContain("Overview");

    scrollPast(true);
    expect(indicator().textContent).toContain("Chunk 2 of 3");

    scrollPast(false);
    expect(indicator().textContent).toContain("Overview");
  });

  it("steps one chunk either way from the active one", () => {
    const { jumpToChunk, scrollPast, setActive } = renderBar();
    setActive("c2", "g1");
    scrollPast(true);

    fireEvent.click(screen.getByRole("button", { name: "Next chunk" }));
    expect(jumpToChunk).toHaveBeenLastCalledWith("c3");

    fireEvent.click(screen.getByRole("button", { name: "Previous chunk" }));
    expect(jumpToChunk).toHaveBeenLastCalledWith("c1");
  });

  it("steps past the first chunk on a brief whose end stops short", () => {
    const { jumpToChunk, setActive } = renderBar();
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: SHORT_PAGE_HEIGHT,
    });
    vi.stubGlobal("innerHeight", VIEWPORT_HEIGHT);
    vi.stubGlobal("scrollY", SHORT_PAGE_HEIGHT - VIEWPORT_HEIGHT);
    setActive("c1", "g1");
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    const indicator = screen.getByTestId("chunk-indicator");
    expect(indicator.textContent).toContain("Chunk 1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Next chunk" }));
    expect(jumpToChunk).toHaveBeenLastCalledWith("c2");
  });

  it("opens the first chunk from Overview and has no Previous", () => {
    const { jumpToChunk } = renderBar();

    const previous = screen.getByRole("button", { name: "Previous chunk" });
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next chunk" }));

    expect(jumpToChunk).toHaveBeenLastCalledWith("c1");
  });

  it("names the Changes scope in Changes-only, with no count", () => {
    const { scrollPast, setActive } = renderBar({
      scope: "changes",
      openChunks: undefined,
    });
    setActive("c2", "g2");
    scrollPast(true);

    const indicator = screen.getByTestId("chunk-indicator");
    expect(indicator.textContent).toBe("Changes only");
    expect(screen.queryByRole("button", { name: /open chunks/i })).toBeNull();
  });

  it("opens the Sidebar sheet and the controls from the bar", () => {
    const { props } = renderBar();

    fireEvent.click(screen.getByRole("button", { name: /open chunks/i }));
    fireEvent.click(screen.getByRole("button", { name: "Brief controls" }));

    expect(props.openChunks).toHaveBeenCalledTimes(1);
    expect(props.openBriefControls).toHaveBeenCalledTimes(1);
  });
});
