// @vitest-environment jsdom
// The seam this file pins: reading position lives in the position store, so
// a scroll-spy tick re-renders position SUBSCRIBERS, never the component
// hosting this hook (the screen shell).
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewSessionProvider } from "@web/features/review/session";
import { briefFixture } from "@web/features/brief/fixtures";
import { buildBriefViewModel } from "../../utils/viewModel";
import { deriveGroupHeadingId, deriveGroupSectionId } from "./utils";
import {
  createReadingPositionStore,
  type ReadingPositionStore,
} from "./readingPosition";
import {
  useReadingSession,
  type UseReadingSessionValue,
} from "./useReadingSession";

const nativeScrollBy = window.scrollBy;

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
  window.scrollBy = nativeScrollBy;
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
  onSession?: ((session: UseReadingSessionValue) => void) | undefined;
}

function SessionHost({ position, onRender, onSession }: HostProps) {
  onRender();
  const session = useReadingSession({
    brief: briefFixture,
    briefId: "fixture-brief",
    compareViewFull: true,
    model,
    ownDraftActive: false,
    repoConfig: null,
    position,
  });
  onSession?.(session);
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
      <ReviewSessionProvider briefId="fixture-brief" model={model}>
        <SessionHost position={position} onRender={onRender} />
      </ReviewSessionProvider>,
    );
    // The spy's mount pass already reported the crossing chunk, with the
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

function requireFirst<T>(items: readonly T[], what: string): T {
  const first = items[0];
  if (!first) throw new Error(`fixture has no ${what}`);
  return first;
}

describe("useReadingSession heading landing", () => {
  const group = requireFirst(model.groups, "groups");
  const firstChunk = requireFirst(group.chunks, "chunks");

  /** A far-off section so the scroller takes its instant path onto the element. */
  function mountGroup(withHeading: boolean) {
    const section = document.createElement("section");
    section.id = deriveGroupSectionId(group.id);
    section.getBoundingClientRect = () => rectAt(9000, 9600);
    section.scrollIntoView = vi.fn();
    document.body.append(section);
    const chunk = document.createElement("article");
    chunk.id = firstChunk.id;
    chunk.getBoundingClientRect = () => rectAt(9100, 9400);
    chunk.scrollIntoView = vi.fn();
    section.append(chunk);
    let heading: HTMLElement | null = null;
    if (withHeading) {
      heading = document.createElement("h2");
      heading.id = deriveGroupHeadingId(group.id);
      heading.tabIndex = -1;
      section.prepend(heading);
    }
    return { section, chunk, heading };
  }

  function renderSession() {
    const position = createReadingPositionStore();
    let session: UseReadingSessionValue | null = null;
    render(
      <ReviewSessionProvider briefId="fixture-brief" model={model}>
        <SessionHost
          position={position}
          onRender={() => {}}
          onSession={(value) => {
            session = value;
          }}
        />
      </ReviewSessionProvider>,
    );
    if (!session) throw new Error("session not captured");
    return { position, session: session as UseReadingSessionValue };
  }

  it("lands on the group section, focuses the heading, marks a chunk", () => {
    vi.useFakeTimers();
    const { section, chunk, heading } = mountGroup(true);
    const { position, session } = renderSession();

    act(() => {
      session.jumpToGroupHeading(group.id);
      vi.advanceTimersByTime(100);
    });

    expect(document.activeElement).toBe(heading);
    expect(position.getState().activeChunkId).toBe(firstChunk.id);
    expect(section.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(chunk.scrollIntoView).not.toHaveBeenCalled();
  });

  it("drops a deferred chunk scroll once it is cancelled", () => {
    vi.useFakeTimers();
    const { chunk } = mountGroup(false);
    const { session } = renderSession();

    act(() => {
      session.jumpToChunk(firstChunk.id);
      session.cancelChunkScroll();
      vi.advanceTimersByTime(100);
    });

    expect(chunk.scrollIntoView).not.toHaveBeenCalled();
  });

  it("nudges a far chunk onto its mark once the scroll settles", () => {
    vi.useFakeTimers();
    window.scrollBy = vi.fn();
    mountGroup(false);
    const { session } = renderSession();

    act(() => {
      session.jumpToChunk(firstChunk.id);
      vi.advanceTimersByTime(200);
    });

    expect(window.scrollBy).toHaveBeenCalledTimes(1);
  });

  it("drops the settle nudge once the chunk scroll is cancelled", () => {
    vi.useFakeTimers();
    window.scrollBy = vi.fn();
    const { chunk } = mountGroup(false);
    const { session } = renderSession();

    act(() => {
      session.jumpToChunk(firstChunk.id);
      vi.advanceTimersByTime(1);
      session.cancelChunkScroll();
      vi.advanceTimersByTime(200);
    });

    expect(chunk.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(window.scrollBy).not.toHaveBeenCalled();
  });

  it("falls back to the chunk jump when the heading is not mounted", () => {
    vi.useFakeTimers();
    const { section, chunk } = mountGroup(false);
    const { position, session } = renderSession();

    act(() => {
      session.jumpToGroupHeading(group.id);
      vi.advanceTimersByTime(100);
    });

    expect(position.getState().activeChunkId).toBe(firstChunk.id);
    expect(chunk.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(section.scrollIntoView).not.toHaveBeenCalled();
  });
});
