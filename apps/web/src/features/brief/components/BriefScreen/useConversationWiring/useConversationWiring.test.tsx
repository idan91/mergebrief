// @vitest-environment jsdom
// Inline composers must retain the section composer's resolution affordance and refetch target.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { ConversationPlan } from "@web/features/conversation";
import type { PrConversation } from "@web/features/conversation/types";
import {
  parseConversationFilter,
  type ConversationFilter,
} from "@web/features/conversation/utils";
import type { Brief, BriefChunk } from "../../../types";
import { buildBriefViewModel } from "../../../utils";
import { useConversationWiring } from "./index";
import type { Mutable } from "types/utils";

afterEach(cleanup);

function chunk(): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "core",
    loc: { added: 1, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [{ kind: "add", content: "b", newLine: 10 }],
  } as BriefChunk;
}

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
  chunks: [chunk()],
  concernView: [],
};

const QUERY_KEY = ["conversation", "42", 7] as const;

function conversationWith(authors: readonly string[]): PrConversation {
  return {
    threads: authors.map((login, index) => ({
      rootCommentId: 9000 + index,
      path: "src/a.ts",
      line: 10,
      side: "RIGHT" as const,
      subjectType: "LINE" as const,
      isResolved: false,
      isOutdated: false,
      comments: [
        {
          commentId: 9000 + index,
          author: { login, isBot: false },
          body: `note from ${login}`,
          createdAt: "2026-08-01T00:00:00Z",
          url: `https://example.test/c/${9000 + index}`,
        },
      ],
      hasMoreComments: false,
    })),
    reviews: [],
    prComments: [],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

function plan(
  resolution?: ConversationPlan["resolution"],
  conversation?: PrConversation,
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
  const jumpToChunk = vi.fn();
  const cancelChunkScroll = vi.fn();
  const ensureChunkOpen = vi.fn();
  const { result } = renderHook(
    () =>
      useConversationWiring({
        briefId: "db:42:7:base:head",
        conversation,
        conversationFocusThreadId: undefined,
        conversationFilter,
        jumpToChunk,
        cancelChunkScroll,
        ensureChunkOpen,
        model: buildBriefViewModel(brief),
        readingOrderedChunks: [chunk()],
        submittedReviewIds,
      }),
    { wrapper },
  );
  return {
    result,
    invalidate,
    jumpToChunk,
    cancelChunkScroll,
    ensureChunkOpen,
  };
}

describe("useConversationWiring, resolution", () => {
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
describe("useConversationWiring, inline filtering", () => {
  async function inlineRows(filter?: ConversationFilter) {
    const { result } = renderWiring(
      plan(undefined, conversationWith(["alice", "bob"])),
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

describe("useConversationWiring, own submits", () => {
  it("stamps the recorded review ids on every row under the diff", async () => {
    const { result } = renderWiring(
      plan(undefined, conversationWith(["alice"])),
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
describe("useConversationWiring, filter facets", () => {
  it("removes ghost reviewers from the filter exposed to the receipt", async () => {
    // `?reviewers=ghost` filters nothing (degrade-to-looser), so the
    // trigger receipt must not count it: `applied` is what the disclosure
    // renders, pressed states and All/None/Clear included.
    const { result } = renderWiring(
      plan(undefined, conversationWith(["alice", "bob"])),
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
      plan(undefined, conversationWith(["alice", "bob"])),
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

interface MountedThreadRow {
  row: HTMLElement;
  measure: ReturnType<typeof vi.fn>;
}

function mountThreadCard(rowTop: number, rowHeight = 44): MountedThreadRow {
  const card = document.createElement("section");
  card.id = "c1";
  card.innerHTML =
    '<table><tbody><tr data-conversation-thread="7"><td><button>open</button></td></tr></tbody></table>';
  document.body.append(card);
  const row = card.querySelector("tr")!;
  const measure = vi.fn(
    () => ({ top: rowTop, bottom: rowTop + rowHeight }) as DOMRect,
  );
  row.getBoundingClientRect = measure;
  return { row, measure };
}

// The stub pins the viewport at 1000; under a 190px stack the band runs 190 to 1000.
describe("useConversationWiring, thread landing holds the row", () => {
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

  it("cancels the chunk scroll once the thread row is found", async () => {
    stubScrolling();
    mountThreadCard(400);
    const { result, cancelChunkScroll } = renderWiring(plan());
    jumpToThread(result);

    await waitFor(() => expect(cancelChunkScroll).toHaveBeenCalled());
  });

  it("moves a row that settled under the sticky stack a third down", async () => {
    stubScrolling();
    mountThreadCard(140);
    const { result } = renderWiring(plan());
    jumpToThread(result);

    await waitFor(() =>
      expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", top: -320 }),
    );
  });

  it("waits out a smooth scroll that starts late before correcting", async () => {
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

    await waitFor(() => expect(scrollBy).toHaveBeenCalled());
    expect(readsAtCorrection).toBeGreaterThan(11);
  });

  it("leaves a row that settled in view where it is", async () => {
    stubScrolling();
    const { measure } = mountThreadCard(400);
    const { result } = renderWiring(plan());
    jumpToThread(result);

    await waitFor(() => expect(measure).toHaveBeenCalled());
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("puts an expanded thread's head under the stack, not its middle", async () => {
    stubScrolling();
    mountThreadCard(40, 900);
    const { result } = renderWiring(plan());
    jumpToThread(result);

    await waitFor(() =>
      expect(scrollBy).toHaveBeenCalledWith({ behavior: "instant", top: -166 }),
    );
  });

  it("leaves an expanded thread whose head is already readable", async () => {
    stubScrolling();
    const { measure } = mountThreadCard(200, 900);
    const { result } = renderWiring(plan());
    jumpToThread(result);

    await waitFor(() => expect(measure).toHaveBeenCalled());
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe("useConversationWiring, line landing", () => {
  afterEach(() => {
    for (const card of document.body.querySelectorAll("section")) {
      card.remove();
    }
  });

  it("lands on the owner card's row for the line and moves focus there", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const card = document.createElement("section");
    card.id = "c1";
    // The production row shape: focusable, with the revision rail's button
    // inside its gutter cell.
    card.innerHTML =
      '<table><tbody><tr data-line-kind="add" tabindex="0"><td><button>rail</button></td>' +
      '<td data-line-number=""></td><td data-line-number="" data-line-new="10">10</td><td>b</td></tr></tbody></table>';
    document.body.append(card);
    const { result, jumpToChunk, ensureChunkOpen } = renderWiring(plan());
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
    await waitFor(() =>
      expect(row.hasAttribute("data-conversation-flash")).toBe(true),
    );
    expect(ensureChunkOpen).toHaveBeenCalledWith("c1");
    expect(jumpToChunk).toHaveBeenCalledWith("c1", "auto");
  });

  it("lands a thread target inside its own card, not a span copy", async () => {
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

  it("gives a row without a tab stop one only for the landing", async () => {
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
