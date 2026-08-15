// @vitest-environment jsdom
// The seam this file pins: reading position lives in the position store, so
// a scroll-spy tick re-renders position SUBSCRIBERS — never the component
// hosting this hook (the screen shell).
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MindMapProvider } from "@web/features/review/session";
import { briefFixture } from "../../utils/fixtures";
import { buildBriefViewModel } from "../../utils/viewModel";
import {
  createReadingPositionStore,
  type ReadingPositionStore,
} from "./readingPosition";
import { useReadingSession } from "./useReadingSession";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const model = buildBriefViewModel(briefFixture);

/** A real DOMRect spanning top→bottom (x/width irrelevant to the spy). */
function rectAt(top: number, bottom: number): DOMRect {
  return new DOMRect(0, top, 0, bottom - top);
}

/** A chunk node the spy sees as crossing the reading line (top<=150<bottom). */
function mountChunk(id: string, crossing: boolean): HTMLElement {
  const el = document.createElement("article");
  el.id = id;
  el.getBoundingClientRect = () =>
    crossing ? rectAt(100, 300) : rectAt(900, 1100);
  document.body.append(el);
  return el;
}

interface HostProps {
  position: ReadingPositionStore;
  onRender: () => void;
}

function SessionHost({ position, onRender }: HostProps) {
  onRender();
  useReadingSession({
    brief: briefFixture,
    briefId: "fixture-brief",
    compareViewFull: true,
    model,
    ownDraftActive: false,
    repoConfig: null,
    position,
  });
  return null;
}

describe("useReadingSession reading position", () => {
  it("writes spy ticks into the store without re-rendering the host", () => {
    vi.useFakeTimers();
    const chunkA = mountChunk("chunk-a", true);
    const chunkB = mountChunk("chunk-b", false);
    const position = createReadingPositionStore();
    const onRender = vi.fn();
    render(
      <MindMapProvider briefId="fixture-brief" model={model}>
        <SessionHost position={position} onRender={onRender} />
      </MindMapProvider>,
    );
    // The spy's mount pass already reported the crossing chunk — with the
    // derived group riding along in the same write.
    expect(position.getState().activeChunkId).toBe("chunk-a");
    expect(position.getState().activeGroupId).toBe(
      model.chunkToGroup.get("chunk-a"),
    );
    const rendersAfterMount = onRender.mock.calls.length;

    // The reading line crosses into chunk-b.
    chunkA.getBoundingClientRect = () => rectAt(-500, -300);
    chunkB.getBoundingClientRect = () => rectAt(100, 300);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(20);
    });

    expect(position.getState().activeChunkId).toBe("chunk-b");
    expect(onRender.mock.calls.length).toBe(rendersAfterMount);
  });
});
