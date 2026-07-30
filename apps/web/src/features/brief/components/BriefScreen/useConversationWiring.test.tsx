// @vitest-environment jsdom
// The INLINE (at-chunk) conversation wiring: this hook builds the composer the
// diff-embedded thread rows get, so a dropped field here silently removes an
// affordance from the chunk view while the section keeps it (BRIEF-93). Pins
// the resolution pass-through and its refetch target.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { ConversationPlan } from "@web/features/conversation";
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

function plan(resolution?: ConversationPlan["resolution"]): ConversationPlan {
  const descriptor = {
    queryKey: QUERY_KEY,
    queryFn: async () => ({ kind: "unavailable" }) as const,
    retry: false,
  };
  return {
    // Structural stand-in for the real descriptor (test-only escape hatch).
    queryOptions: descriptor as unknown as ConversationPlan["queryOptions"],
    postReply: vi.fn(),
    ...(resolution === undefined ? {} : { resolution }),
  };
}

function renderWiring(conversation: ConversationPlan | undefined) {
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
        jumpToChunk: vi.fn(),
        model: buildBriefViewModel(brief),
        readingOrderedChunks: [chunk()],
        submittedReviewIds: [],
      }),
    { wrapper },
  );
  return { result, invalidate };
}

describe("useConversationWiring — resolution (BRIEF-93)", () => {
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
