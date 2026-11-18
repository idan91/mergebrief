// @vitest-environment jsdom
// The seam this file pins: reading position lives in the position store, so
// a scroll-spy tick re-renders position SUBSCRIBERS, never the component
// hosting this hook (the screen shell).
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewSessionProvider } from "@web/features/review/session";
import { briefFixture } from "@web/features/brief/test-utils";
import type { Brief } from "../../../../model/types";
import {
  buildBriefViewModel,
  type BriefViewModel,
} from "../../../../model/utils/view-model";
import { ScrollPlacements } from "../scroll-to-target/engine/types";
import { ScrollHistories } from "../scroll-to-target/types";
import type { ScopeExitOptions } from "../types";
import { createBriefViewStore } from "../store";
import {
  deriveGroupHeadingId,
  deriveGroupSectionId,
  listInitiallyOpenChunkIds,
} from "../utils";
import {
  createReadingPositionStore,
  type ReadingPositionStore,
} from "./reading-position";
import {
  useReadingSession,
  type UseReadingSessionValue,
} from "./useReadingSession";

const nativeScrollBy = window.scrollBy;

beforeEach(() => {
  document.documentElement.style.setProperty("--sticky-stack-h", "110px");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.documentElement.style.removeProperty("--sticky-stack-h");
  vi.useRealTimers();
  window.scrollBy = nativeScrollBy;
});

const model = buildBriefViewModel(briefFixture);

/** A real DOMRect spanning top→bottom (x/width irrelevant to the spy). */
function rectAt(top: number, bottom: number): DOMRect {
  return new DOMRect(0, top, 0, bottom - top);
}

/** A chunk node the spy sees as crossing the reading line (top<=151<bottom):
 * the stack below is 110px and the scroll gap 40px. */
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
  compareViewFull?: boolean;
  exitChangesScope?: ((options: ScopeExitOptions) => void) | undefined;
  initialFocusMode?: boolean;
  brief?: Brief;
  viewModel?: BriefViewModel;
}

function SessionHost({
  position,
  onRender,
  onSession,
  compareViewFull = true,
  exitChangesScope,
  initialFocusMode = false,
  brief = briefFixture,
  viewModel = model,
}: HostProps) {
  onRender();
  const [viewStore] = useState(() =>
    createBriefViewStore({
      openChunkIds: listInitiallyOpenChunkIds(viewModel.groups),
      focusMode: initialFocusMode,
    }),
  );
  const session = useReadingSession({
    brief,
    briefId: "fixture-brief",
    compareViewFull,
    model: viewModel,
    ownDraftActive: false,
    repoConfig: null,
    position,
    exitChangesScope,
    viewStore,
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

describe("useReadingSession page end", () => {
  afterEach(() => vi.restoreAllMocks());

  function mountShortLastChunk(scrollY: number, scrollHeight: number) {
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(
      scrollHeight,
    );
    vi.useFakeTimers();
    mountChunk("chunk-a", true);
    const last = mountChunk("chunk-b", false);
    last.getBoundingClientRect = () => rectAt(400, 500);
    const position = createReadingPositionStore();
    render(
      <ReviewSessionProvider briefId="fixture-brief" model={model}>
        <SessionHost position={position} onRender={() => {}} />
      </ReviewSessionProvider>,
    );
    act(() => {
      position
        .getState()
        .actions.setActive(
          "chunk-b",
          model.chunkToGroup.get("chunk-b") ?? null,
        );
    });
    const scrollTo = (nextScrollY: number) => {
      scrollY = nextScrollY;
      act(() => {
        window.dispatchEvent(new Event("scroll"));
        vi.advanceTimersByTime(20);
      });
    };
    return { position, scrollTo };
  }

  it("keeps a short last chunk at the end, then follows a scroll up", () => {
    const pageEnd = 2000 - window.innerHeight;
    const page = mountShortLastChunk(pageEnd, 2000);

    page.scrollTo(pageEnd);
    expect(page.position.getState().activeChunkId).toBe("chunk-b");

    page.scrollTo(pageEnd - 200);
    expect(page.position.getState().activeChunkId).toBe("chunk-a");
  });

  it("keeps a short last chunk on a page that never scrolls", () => {
    const page = mountShortLastChunk(0, window.innerHeight);

    page.scrollTo(0);

    expect(page.position.getState().activeChunkId).toBe("chunk-b");
  });
});

function requireFirst<T>(items: readonly T[], what: string): T {
  const first = items[0];
  if (!first) {
    throw new Error(`fixture has no ${what}`);
  }
  return first;
}

describe("useReadingSession heading scroll", () => {
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
    if (!session) {
      throw new Error("session not captured");
    }
    return { position, session: session as UseReadingSessionValue };
  }

  it("scrolls to the group section, focuses the heading, marks a chunk", () => {
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

  it("a focused chunk jump focuses the card once the scroll finds it", () => {
    vi.useFakeTimers();
    const { session } = renderSession();

    act(() => {
      session.jumpToChunk(
        firstChunk.id,
        "smooth",
        ScrollPlacements.UNDER_STACK,
        ScrollHistories.NONE,
        true,
      );
    });
    const { chunk } = mountGroup(false);
    chunk.tabIndex = -1;
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(document.activeElement).toBe(chunk);
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

describe("useReadingSession heading jump from Changes scope", () => {
  const group = requireFirst(model.groups, "groups");
  const firstChunk = requireFirst(group.chunks, "chunks");

  function mountStoryGroup() {
    const section = document.createElement("section");
    section.id = deriveGroupSectionId(group.id);
    section.getBoundingClientRect = () => rectAt(9000, 9600);
    section.scrollIntoView = vi.fn();
    const chunk = document.createElement("article");
    chunk.id = firstChunk.id;
    chunk.getBoundingClientRect = () => rectAt(9100, 9400);
    chunk.scrollIntoView = vi.fn();
    section.append(chunk);
    document.body.append(section);
    return { section, chunk };
  }

  function mountHeading(section: HTMLElement): HTMLElement {
    const heading = document.createElement("h2");
    heading.id = deriveGroupHeadingId(group.id);
    heading.tabIndex = -1;
    section.prepend(heading);
    return heading;
  }

  function renderInChanges(initialFocusMode: boolean) {
    const position = createReadingPositionStore();
    const exitChangesScope = vi.fn();
    let session: UseReadingSessionValue | null = null;
    const makeHost = (compareViewFull: boolean) => (
      <ReviewSessionProvider briefId="fixture-brief" model={model}>
        <SessionHost
          position={position}
          onRender={() => {}}
          onSession={(value) => {
            session = value;
          }}
          compareViewFull={compareViewFull}
          exitChangesScope={exitChangesScope}
          initialFocusMode={initialFocusMode}
        />
      </ReviewSessionProvider>
    );
    const { rerender } = render(makeHost(false));
    const showStory = () => rerender(makeHost(true));
    const jump = () =>
      session?.jumpToGroupHeading(group.id, ScrollHistories.PUSH);
    return { exitChangesScope, jump, showStory };
  }

  it("leaves the scope, then focuses the heading the story pane shows", () => {
    vi.useFakeTimers();
    const { exitChangesScope, jump, showStory } = renderInChanges(false);

    act(() => {
      jump();
    });
    expect(exitChangesScope).toHaveBeenCalledWith({ replace: false });
    const { section } = mountStoryGroup();
    const heading = mountHeading(section);
    act(() => {
      showStory();
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(document.activeElement).toBe(heading);
    expect(section.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("scrolls to the first chunk in focus mode, where no heading shows", () => {
    vi.useFakeTimers();
    const { exitChangesScope, jump, showStory } = renderInChanges(true);

    act(() => {
      jump();
    });
    expect(exitChangesScope).toHaveBeenCalledWith({ replace: false });
    const { section, chunk } = mountStoryGroup();
    act(() => {
      showStory();
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(chunk.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(section.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("useReadingSession large chunk jumps", () => {
  const LARGE_CHUNK_ID = "chunk-b";
  const SMALL_CHUNK_ID = "chunk-a";
  const largeBrief: Brief = {
    ...briefFixture,
    chunks: briefFixture.chunks.map((chunk) =>
      chunk.id === LARGE_CHUNK_ID
        ? { ...chunk, loc: { added: 900, deleted: 0 } }
        : chunk,
    ),
  };
  const largeModel = buildBriefViewModel(largeBrief);

  function renderLargeSession(initialFocusMode: boolean) {
    let latest: UseReadingSessionValue | null = null;
    render(
      <ReviewSessionProvider briefId="fixture-brief" model={largeModel}>
        <SessionHost
          brief={largeBrief}
          initialFocusMode={initialFocusMode}
          onRender={() => {}}
          onSession={(value) => {
            latest = value;
          }}
          position={createReadingPositionStore()}
          viewModel={largeModel}
        />
      </ReviewSessionProvider>,
    );
    return function readSession(): UseReadingSessionValue {
      if (!latest) {
        throw new Error("session not captured");
      }
      return latest;
    };
  }

  it("opens a large chunk that a wayfinding jump targets", () => {
    vi.useFakeTimers();
    const readSession = renderLargeSession(false);
    expect(readSession().openChunks.has(LARGE_CHUNK_ID)).toBe(false);

    act(() => {
      readSession().jumpToChunk(LARGE_CHUNK_ID);
    });

    expect(readSession().openChunks.has(LARGE_CHUNK_ID)).toBe(true);
  });

  it("keeps a card the reader closed shut on a wayfinding jump", () => {
    vi.useFakeTimers();
    const readSession = renderLargeSession(false);

    act(() => {
      readSession().toggleChunk(SMALL_CHUNK_ID);
    });
    act(() => {
      readSession().jumpToChunk(SMALL_CHUNK_ID);
    });

    expect(readSession().openChunks.has(SMALL_CHUNK_ID)).toBe(false);
  });

  it("opens a large next chunk when focus mode marks one reviewed", () => {
    vi.useFakeTimers();
    const readSession = renderLargeSession(true);

    act(() => {
      readSession().markReviewed(SMALL_CHUNK_ID);
    });

    expect(readSession().openChunks.has(LARGE_CHUNK_ID)).toBe(true);
  });
});
