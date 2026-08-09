// @vitest-environment jsdom
// The INLINE (at-chunk) conversation wiring: this hook builds the composer the
// diff-embedded thread rows get, so a dropped field here silently removes an
// affordance from the chunk view while the section keeps it. Pins
// the resolution pass-through and its refetch target.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { ConversationPlan } from "@web/features/conversation";
import type { PrConversation } from "@web/features/conversation/types";
import {
  parseConversationFilter,
  type ConversationFilter,
} from "@web/features/conversation/utils/filter";
import type { Brief, BriefChunk } from "../../types";
import { buildBriefViewModel } from "../../utils";
import { useConversationWiring } from "./useConversationWiring";

afterEach(cleanup);

function chunk(): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "carrier",
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
  return {
    // Structural stand-in for the real descriptor (test-only escape hatch).
    queryOptions: descriptor as unknown as ConversationPlan["queryOptions"],
    postReply: vi.fn(),
    ...(resolution === undefined ? {} : { resolution }),
  };
}

function renderWiring(
  conversation: ConversationPlan | undefined,
  conversationFilter?: ConversationFilter,
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
  const { result } = renderHook(
    () =>
      useConversationWiring({
        briefId: "db:42:7:base:head",
        conversation,
        conversationFocusThreadId: undefined,
        conversationFilter,
        jumpToChunk: vi.fn(),
        model: buildBriefViewModel(brief),
        readingOrderedChunks: [chunk()],
        submittedReviewIds: [],
      }),
    { wrapper },
  );
  return { result, invalidate };
}

describe("useConversationWiring — resolution", () => {
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
    // The inline refetch targets the SHARED conversation key — the section and
    // the at-chunk rows read the same query.
    resolution?.refetchConversation();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: QUERY_KEY });
  });

  it("carries no resolution when the plan has none (local path)", () => {
    expect(
      renderWiring(plan()).result.current.conversationComposer?.resolution,
    ).toBeUndefined();
    expect(
      renderWiring(undefined).result.current.conversationComposer,
    ).toBeUndefined();
  });
});

// The filter reaches the DIFF, not just the digest. Nothing else in the suite
// would notice if this memo stopped filtering (or dropped its filter dep) —
// the section's own tests would stay green while the diff quietly kept every
// thread.
describe("useConversationWiring — inline filtering", () => {
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

// The Filter disclosure renders in the toolbar ABOVE the section, outside
// its disclosure body, so this hook — not the section — owns the facets it
// draws.
describe("useConversationWiring — filter facets", () => {
  it("exposes the RECONCILED filter — a ghost selection never reaches the receipt", async () => {
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
    // Bob's thread is the one the diff loses — the pill must say so.
    expect(facets?.hiddenInlineThreads).toBe(1);
  });

  it("has no facets before the conversation resolves", () => {
    const { result } = renderWiring(plan());
    expect(result.current.conversationFilterFacets).toBeUndefined();
  });
});
