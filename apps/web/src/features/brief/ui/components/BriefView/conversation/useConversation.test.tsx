// @vitest-environment jsdom
// Inline composers must retain the section composer's resolution affordance and refetch target.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { makeChunk } from "@web/features/brief/test-utils";
import type { ConversationPlan } from "@web/features/conversation";
import { makeConversation } from "@web/features/conversation/test-utils";
import type { PrConversation } from "@web/features/conversation/types";
import {
  parseConversationFilter,
  type ConversationFilter,
} from "@web/features/conversation/utils";
import type { Brief } from "../../../../model/types";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import { useScrollToTarget } from "../scroll-to-target";
import { SCROLL_FLASH_ATTR } from "../scroll-to-target/consts";
import { WATCH_FRAMES } from "../scroll-to-target/engine/consts";
import { useConversation } from "./useConversation";
import type { Mutable } from "types/utils";

/** vitest's faked requestAnimationFrame fires every 16ms. */
const FAKE_FRAME_MS = 16;
/** Outlasts every frame the scroll watch polls before it lets go. */
const SCROLL_WATCH_MS = (WATCH_FRAMES + 1) * FAKE_FRAME_MS;

const brief: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 7,
    title: "t",
    url: "https://example.com/pr/7",
    sha: "head1234",
    description: "",
  },
  summary: "s",
  changeGroups: [
    {
      id: "g1",
      title: "g",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [makeChunk()],
  concernView: [],
};

const QUERY_KEY = ["conversation", "42", 7] as const;

function plan(
  resolution?: ConversationPlan["resolution"],
  conversation?: PrConversation,
  mentionRepoId?: string,
): ConversationPlan {
  const descriptor = {
    queryKey: QUERY_KEY,
    queryFn: async () =>
      conversation === undefined
        ? ({ kind: "unavailable" } as const)
        : ({ kind: "ready", conversation } as const),
    retry: false,
  };
  const conversationPlan: Mutable<ConversationPlan> = {
    // Structural stand-in for the real descriptor (test-only escape hatch).
    queryOptions: descriptor as unknown as ConversationPlan["queryOptions"],
    postReply: vi.fn(),
  };

  if (resolution !== undefined) {
    conversationPlan.resolution = resolution;
  }
  if (mentionRepoId !== undefined) {
    conversationPlan.mentionRepoId = mentionRepoId;
  }

  return conversationPlan;
}

const NO_SUBMITS: number[] = [];

function renderWiring(
  conversation: ConversationPlan | undefined,
  conversationFilter?: ConversationFilter,
  submittedReviewIds: number[] = NO_SUBMITS,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  const openChunk = vi.fn();
  const setActiveChunk = vi.fn();
  const recordSubmittedReview = vi.fn();
  const capability =
    conversation === undefined
      ? undefined
      : {
          plan: conversation,
          filter: conversationFilter,
          onFilterChange: vi.fn(),
        };
  const { result } = renderHook(
    () => {
      const { scrollToTarget } = useScrollToTarget({
        briefId: "db:42:7:base:head",
        chunkWindows: undefined,
        openChunk,
        inChangesScope: false,
        exitChangesScope: undefined,
      });
      const conversationState = useConversation({
        conversation: capability,
        model: buildBriefViewModel(brief),
        session: {
          actions: { recordSubmittedReview },
          scrollToTarget,
          setActiveChunk,
          readingOrderedChunks: [makeChunk()],
          submittedReviewIds,
        },
      });
      return conversationState.conversationWiring;
    },
    { wrapper },
  );
  return {
    result,
    invalidate,
    openChunk,
    setActiveChunk,
  };
}

describe("useConversation, resolution", () => {
  it("passes the plan's resolution to the inline composer", () => {
    const setResolved = vi.fn();
    const refetchCapability = vi.fn();
    const { result, invalidate } = renderWiring(
      plan({ canResolve: true, setResolved, refetchCapability }),
    );
    const resolution = result.current.conversationComposer?.resolution;
    expect(resolution?.canResolve).toBe(true);
    expect(resolution?.setResolved).toBe(setResolved);
    expect(resolution?.refetchCapability).toBe(refetchCapability);
    // The inline refetch targets the SHARED conversation key, the section and
    // the at-chunk rows read the same query.
    resolution?.refetchConversation();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: QUERY_KEY });
  });

  it("carries no resolution on the local path", () => {
    expect(
      renderWiring(plan()).result.current.conversationComposer?.resolution,
    ).toBeUndefined();
    expect(
      renderWiring(undefined).result.current.conversationComposer,
    ).toBeUndefined();
  });
});

// The filter reaches the DIFF, not just the digest. Nothing else in the suite
// would notice if this memo stopped filtering (or dropped its filter dep),
// the section's own tests would stay green while the diff quietly kept every
// thread.
describe("useConversation, inline filtering", () => {
  async function inlineRows(filter?: ConversationFilter) {
    const { result } = renderWiring(
      plan(undefined, makeConversation(["alice", "bob"])),
      filter,
    );
    await waitFor(() =>
      expect(result.current.conversationByChunk).toBeDefined(),
    );
    return result.current.conversationByChunk?.get("c1") ?? [];
  }

  it("keeps every inline thread when no filter is set", async () => {
    expect(await inlineRows()).toHaveLength(2);
  });

  it("drops the threads a reviewer selection excludes", async () => {
    const rows = await inlineRows(
      parseConversationFilter({ reviewers: "bob" }),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.kind).toBe("thread");
    expect(
      row?.kind === "thread" ? row.thread.comments[0]?.author.login : undefined,
    ).toBe("bob");
  });

  it("loosens rather than empties when the selection names nobody here", async () => {
    // Same degrade-to-looser rule the section applies: a stale shared link
    // must not blank the diff.
    const rows = await inlineRows(
      parseConversationFilter({ reviewers: "departed-colleague" }),
    );
    expect(rows).toHaveLength(2);
  });
});

describe("useConversation, mention source", () => {
  it("hands inline composers the plan's repo and the participants", async () => {
    const { result } = renderWiring(
      plan(undefined, makeConversation(["cara", "dan"]), "42"),
    );

    await waitFor(() => {
      const source = result.current.conversationComposer?.mentionSource;
      expect(source?.repoId).toBe("42");
      expect(source?.participants.map((user) => user.login)).toEqual([
        "cara",
        "dan",
      ]);
    });
  });
});

describe("useConversation, own submits", () => {
  it("stamps the recorded review ids on every row under the diff", async () => {
    const { result } = renderWiring(
      plan(undefined, makeConversation(["alice"])),
      undefined,
      [77],
    );
    await waitFor(() =>
      expect(result.current.conversationByChunk).toBeDefined(),
    );

    const inline = result.current.conversationByChunk?.get("c1") ?? [];
    const byLine = result.current.lineThreadsByFile?.get("src/a.ts") ?? [];
    const rows = [...inline, ...byLine];
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.kind === "thread" ? row.ownReviewIds?.has(77) : false).toBe(
        true,
      );
    }
  });
});

// The Filter disclosure renders in the toolbar ABOVE the section, outside
// its disclosure body, so this hook, not the section, owns the facets it
// draws.
describe("useConversation, filter facets", () => {
  it("removes ghost reviewers from the filter exposed to the receipt", async () => {
    // `?reviewers=ghost` filters nothing (degrade-to-looser), so the
    // trigger receipt must not count it: `applied` is what the disclosure
    // renders, pressed states and All/None/Clear included.
    const { result } = renderWiring(
      plan(undefined, makeConversation(["alice", "bob"])),
      parseConversationFilter({ reviewers: "ghost,alice" }),
    );
    await waitFor(() =>
      expect(result.current.conversationFilterFacets).toBeDefined(),
    );
    expect([
      ...(result.current.conversationFilterFacets?.applied.reviewers ?? []),
    ]).toEqual(["alice"]);
  });

  it("exposes verdict/reviewer facets and the hidden-inline count", async () => {
    const { result } = renderWiring(
      plan(undefined, makeConversation(["alice", "bob"])),
      parseConversationFilter({ reviewers: "alice" }),
    );
    await waitFor(() =>
      expect(result.current.conversationFilterFacets).toBeDefined(),
    );
    const facets = result.current.conversationFilterFacets;
    expect(facets?.reviewers.map((facet) => facet.login)).toEqual([
      "alice",
      "bob",
    ]);
    // Bob's thread is the one the diff loses, the pill must say so.
    expect(facets?.hiddenInlineThreads).toBe(1);
  });

  it("has no facets before the conversation resolves", () => {
    const { result } = renderWiring(plan());
    expect(result.current.conversationFilterFacets).toBeUndefined();
  });
});

const THREAD_ROW_HEIGHT_PX = 44;

function mountThreadCard(rowTop: number): void {
  const card = document.createElement("section");
  card.id = "c1";
  card.innerHTML =
    '<table><tbody><tr data-conversation-thread="7"><td><button>open</button></td></tr></tbody></table>';
  document.body.append(card);
  const row = card.querySelector("tr")!;
  row.getBoundingClientRect = () =>
    ({ top: rowTop, bottom: rowTop + THREAD_ROW_HEIGHT_PX }) as DOMRect;
}

// The stub pins the viewport at 1000; under a 190px stack the band runs 190 to 1000.
describe("useConversation, thread scroll holds the row", () => {
  const scrollBy = vi.fn();
  const nativeScrollBy = window.scrollBy;
  const nativeScrollIntoView = Element.prototype.scrollIntoView;
  const nativeScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");

  function jumpToThread(result: ReturnType<typeof renderWiring>["result"]) {
    act(() => {
      result.current.jumpToChunkFromConversation("c1", {
        rowId: "c1:0",
        threadId: 7,
      });
    });
  }

  afterEach(() => {
    for (const card of document.body.querySelectorAll("section")) {
      card.remove();
    }
    vi.useRealTimers();
    document.documentElement.style.removeProperty("--sticky-stack-h");
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 768,
    });
    scrollBy.mockReset();
    window.scrollBy = nativeScrollBy;
    Element.prototype.scrollIntoView = nativeScrollIntoView;
    if (nativeScrollY !== undefined) {
      Object.defineProperty(window, "scrollY", nativeScrollY);
    }
  });

  function stubScrolling() {
    Element.prototype.scrollIntoView = vi.fn();
    window.scrollBy = scrollBy;
    document.documentElement.style.setProperty("--sticky-stack-h", "190px");
    // The band is 190 to 1000, a third of the way down 460.
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 1000,
    });
  }

  it("scrolls to a far card on one line, watched once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubScrolling();
    const card = document.createElement("section");
    card.id = "c1";
    card.tabIndex = -1;
    card.getBoundingClientRect = () => ({ top: 9000, bottom: 9300 }) as DOMRect;
    document.body.append(card);
    const { result } = renderWiring(plan());
    act(() => {
      result.current.jumpToChunkFromConversation("c1");
    });

    await waitFor(() =>
      expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", top: 8770 }),
    );
    await act(() => vi.advanceTimersByTimeAsync(SCROLL_WATCH_MS));
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(card);
  });

  it("moves a row that settled under the sticky stack a third down", () => {
    vi.useFakeTimers();
    stubScrolling();
    mountThreadCard(140);
    const { result } = renderWiring(plan());
    jumpToThread(result);

    act(() => {
      vi.advanceTimersByTime(SCROLL_WATCH_MS);
    });
    expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", top: -320 });
  });

  it("waits out a smooth scroll that starts late before correcting", () => {
    vi.useFakeTimers();
    stubScrolling();
    mountThreadCard(140);
    // One read per polled frame: still for 6, moving for 5, then still.
    let reads = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => {
        reads += 1;
        if (reads <= 6) {
          return 0;
        }
        return Math.min(reads, 11) * 10;
      },
    });
    let readsAtCorrection = 0;
    scrollBy.mockImplementation(() => {
      readsAtCorrection = reads;
    });
    const { result } = renderWiring(plan());
    jumpToThread(result);

    act(() => {
      vi.advanceTimersByTime(SCROLL_WATCH_MS);
    });
    expect(scrollBy).toHaveBeenCalled();
    expect(readsAtCorrection).toBeGreaterThan(11);
  });
});

describe("useConversation, line scroll", () => {
  afterEach(() => {
    for (const card of document.body.querySelectorAll("section")) {
      card.remove();
    }
  });

  it("scrolls to the owner card's row for the line and moves focus there", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const card = document.createElement("section");
    card.id = "c1";
    // The production row shape: focusable, with the revision rail's button
    // inside its gutter cell.
    card.innerHTML =
      '<table><tbody><tr data-line-kind="add" tabindex="0"><td><button>rail</button></td>' +
      '<td data-line-number=""></td><td data-line-number="" data-line-new="10">10</td><td>b</td></tr></tbody></table>';
    document.body.append(card);
    const { result, openChunk, setActiveChunk } = renderWiring(plan());
    act(() => {
      result.current.jumpToChunkFromConversation("c1", {
        side: "new",
        line: 10,
      });
    });
    const row = card.querySelector("tr")!;

    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.querySelector("button")?.hasAttribute("tabindex")).toBe(false);
    await waitFor(() => expect(row.hasAttribute(SCROLL_FLASH_ATTR)).toBe(true));
    expect(openChunk).toHaveBeenCalledWith("c1");
    expect(setActiveChunk).toHaveBeenCalledWith("c1");
  });

  it("scrolls to a thread target inside its own card, not a span copy", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const copy = document.createElement("section");
    copy.id = "c0";
    copy.innerHTML =
      '<table><tbody><tr data-conversation-thread="7"><td>copy</td></tr></tbody></table>';
    const card = document.createElement("section");
    card.id = "c1";
    card.innerHTML =
      '<table><tbody><tr data-conversation-thread="7"><td><button>open</button></td></tr></tbody></table>';
    document.body.append(copy, card);
    const { result } = renderWiring(plan());
    act(() => {
      result.current.jumpToChunkFromConversation("c1", {
        rowId: "c1:0",
        threadId: 7,
      });
    });
    const disclosure = card.querySelector("button")!;

    await waitFor(() => expect(document.activeElement).toBe(disclosure));
    expect(disclosure.hasAttribute("tabindex")).toBe(false);
  });

  it("gives a row without a tab stop one only for the scroll", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const card = document.createElement("section");
    card.id = "c1";
    card.innerHTML =
      '<table><tbody><tr data-line-kind="add"><td data-line-number=""></td>' +
      '<td data-line-number="" data-line-new="10">10</td><td>b</td></tr></tbody></table>';
    document.body.append(card);
    const { result } = renderWiring(plan());
    act(() => {
      result.current.jumpToChunkFromConversation("c1", {
        side: "new",
        line: 10,
      });
    });
    const row = card.querySelector("tr")!;

    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(row.getAttribute("tabindex")).toBe("-1");
  });
});
