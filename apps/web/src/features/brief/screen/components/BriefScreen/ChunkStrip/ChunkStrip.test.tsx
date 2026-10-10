// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n/I18nProvider";
import { briefFixture } from "../../../../fixtures";
import type { BriefChunk } from "../../../../model/types";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
  type ReadingPositionStore,
} from "../readingPosition";
import { ChunkStrip } from ".";

afterEach(cleanup);

const GROUP_ID = "g1";

function makeChunks(): BriefChunk[] {
  const [first, second] = briefFixture.chunks;
  if (first === undefined || second === undefined) {
    throw new Error("fixture needs two chunks");
  }
  return [
    first,
    second,
    {
      ...second,
      id: "chunk-c",
      file: "src/params.ts",
      addedRanges: [{ start: 40, end: 44 }],
    },
  ];
}

interface RenderStripResult {
  position: ReadingPositionStore;
  jumpToChunk: ReturnType<typeof vi.fn>;
  commits: () => number;
}

function renderStrip(activeChunkId?: string): RenderStripResult {
  const position = createReadingPositionStore();
  if (activeChunkId !== undefined) {
    position.getState().actions.setActive(activeChunkId, GROUP_ID);
  }
  const jumpToChunk = vi.fn();
  let commitCount = 0;
  render(
    <I18nProvider>
      <ReadingPositionProvider store={position}>
        <Profiler
          id="strip"
          onRender={() => {
            commitCount += 1;
          }}
        >
          <ChunkStrip
            chunks={makeChunks()}
            groupId={GROUP_ID}
            jumpToChunk={jumpToChunk}
          />
        </Profiler>
        <input aria-label="Outside" />
      </ReadingPositionProvider>
    </I18nProvider>,
  );
  return { position, jumpToChunk, commits: () => commitCount };
}

function getMarks(): HTMLElement[] {
  const toolbar = screen.getByRole("toolbar", { name: "Chunks in this group" });
  return within(toolbar).getAllByRole("button");
}

function getCaption(): string {
  return screen.getByRole("toolbar").nextElementSibling?.textContent ?? "";
}

describe("ChunkStrip", () => {
  it("names each mark by file, line and place", () => {
    renderStrip();
    expect(getMarks().map((mark) => mark.getAttribute("aria-label"))).toEqual([
      "leak.ts line 10, chunk 1 of 3",
      "leak.test.ts line 1, chunk 2 of 3",
      "params.ts line 40, chunk 3 of 3",
    ]);
  });

  it("has one tab stop, on the first mark when the reader is elsewhere", () => {
    renderStrip();
    const stops = getMarks().filter((mark) => mark.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(getMarks()[0]);
    expect(getCaption()).toBe("3 chunks");
  });

  it("puts the tab stop and the mark on the reader's chunk", () => {
    renderStrip("chunk-b");
    const second = getMarks()[1];
    expect(second?.tabIndex).toBe(0);
    expect(second?.getAttribute("aria-current")).toBe("true");
    expect(getCaption()).toBe("leak.test.ts :12 of 3");
  });

  it("follows the store as the reader moves", () => {
    const { position } = renderStrip("chunk-a");
    act(() => position.getState().actions.setActive("chunk-c", GROUP_ID));
    const current = getMarks().filter(
      (mark) => mark.getAttribute("aria-current") === "true",
    );
    expect(current).toEqual([getMarks()[2]]);
    expect(getCaption()).toBe("params.ts :403 of 3");
  });

  it("moves focus with the arrows and the caption follows", () => {
    renderStrip("chunk-a");
    const [first, second, third] = getMarks();
    first?.focus();

    fireEvent.keyDown(first as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    expect(getCaption()).toBe("leak.test.ts :12 of 3");

    fireEvent.keyDown(second as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(third);
    expect(third?.tabIndex).toBe(0);

    fireEvent.keyDown(third as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);
  });

  it("jumps to the chunk a mark names", () => {
    const { jumpToChunk } = renderStrip();
    fireEvent.click(getMarks()[2] as HTMLElement);
    expect(jumpToChunk).toHaveBeenCalledWith("chunk-c");
  });

  it("does not re-render for a tick in another group", () => {
    const { position, commits } = renderStrip("chunk-a");
    const before = commits();
    act(() => position.getState().actions.setActive("other-chunk", "g2"));
    act(() => position.getState().actions.setActive("other-next", "g2"));
    expect(commits()).toBe(before + 1);
  });

  it("returns the tab stop to the reader's mark once focus leaves", () => {
    const { position } = renderStrip("chunk-a");
    const [first, second] = getMarks();
    act(() => first?.focus());
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);

    act(() => screen.getByRole("textbox", { name: "Outside" }).focus());
    act(() => position.getState().actions.setActive("chunk-c", GROUP_ID));

    expect(getMarks()[2]?.tabIndex).toBe(0);
    expect(getMarks().filter((mark) => mark.tabIndex === 0)).toHaveLength(1);
    expect(getCaption()).toBe("params.ts :403 of 3");
  });

  it("holds the tab stop on the focused mark while the reader moves", () => {
    const { position } = renderStrip("chunk-a");
    act(() => getMarks()[0]?.focus());

    act(() => position.getState().actions.setActive("chunk-c", GROUP_ID));

    expect(getMarks()[0]?.tabIndex).toBe(0);
    expect(getMarks()[2]?.getAttribute("aria-current")).toBe("true");
  });

  it("lets a clicked mark go once the reader scrolls on", () => {
    const { position } = renderStrip("chunk-b");
    const first = getMarks()[0] as HTMLElement;
    fireEvent.pointerDown(first);
    act(() => first.focus());
    fireEvent.click(first);

    act(() => position.getState().actions.setActive("chunk-c", GROUP_ID));

    expect(first.dataset["state"]).toBeUndefined();
    expect(getCaption()).toBe("params.ts :403 of 3");
  });

  it("keeps one tab stop when the focused mark leaves the list", () => {
    const position = createReadingPositionStore();
    position.getState().actions.setActive("chunk-a", GROUP_ID);
    const chunks = makeChunks();
    const strip = (list: BriefChunk[]) => (
      <I18nProvider>
        <ReadingPositionProvider store={position}>
          <ChunkStrip chunks={list} groupId={GROUP_ID} jumpToChunk={vi.fn()} />
        </ReadingPositionProvider>
      </I18nProvider>
    );
    const { rerender } = render(strip(chunks));
    act(() => getMarks()[2]?.focus());

    rerender(strip(chunks.slice(0, 2)));

    const stops = getMarks().filter((mark) => mark.tabIndex === 0);
    expect(stops).toEqual([getMarks()[0]]);
  });
});
