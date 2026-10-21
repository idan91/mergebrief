// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeChunk } from "@web/features/brief/test-utils";
import { makeConversation } from "@web/features/conversation/test-utils";
import type { PrConversation } from "@web/features/conversation/types";
import { parseConversationFilter } from "@web/features/conversation/utils";
import {
  deriveConversationByChunk,
  deriveConversationFilterFacets,
  deriveHiddenThreadsByFile,
  deriveLineThreadsByFile,
  deriveUnfilteredDigestInput,
  focusConversationHeading,
} from "./utils";

const CHUNKS = [makeChunk()];

function makeOffChunkConversation(): PrConversation {
  const conversation = makeConversation(["alice"]);
  return {
    ...conversation,
    threads: conversation.threads.map((thread) => ({ ...thread, line: 99 })),
  };
}

function stubRowsInput(conversationData: PrConversation | undefined) {
  return {
    conversationData,
    conversationFilter: undefined,
    readingOrderedChunks: CHUNKS,
    submittedReviewIds: [77],
    briefGeneratedAt: undefined,
  };
}

let frames: FrameRequestCallback[] = [];

function runFrames(count: number) {
  for (let ran = 0; ran < count; ran += 1) {
    const frame = frames.shift();
    if (frame === undefined) {
      return;
    }
    frame(0);
  }
}

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => {
    frames.push(frame);
    return frames.length;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("focusConversationHeading", () => {
  it("scrolls to and focuses the heading a frame later", () => {
    const heading = document.createElement("h2");
    heading.id = "conversation-heading";
    heading.tabIndex = -1;
    heading.scrollIntoView = vi.fn();
    document.body.append(heading);

    focusConversationHeading();
    expect(document.activeElement).not.toBe(heading);
    runFrames(1);

    expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(document.activeElement).toBe(heading);
  });
});

describe("deriveConversationByChunk", () => {
  it("is absent until the conversation resolves", () => {
    expect(deriveConversationByChunk(stubRowsInput(undefined))).toBeUndefined();
  });
});

describe("deriveUnfilteredDigestInput", () => {
  it("is absent until the conversation resolves", () => {
    expect(
      deriveUnfilteredDigestInput(stubRowsInput(undefined)),
    ).toBeUndefined();
  });
});

describe("deriveHiddenThreadsByFile", () => {
  it("is absent without a digest input", () => {
    expect(deriveHiddenThreadsByFile(undefined)).toBeUndefined();
  });

  it("lists a thread on a line no chunk renders under its file", () => {
    const input = deriveUnfilteredDigestInput(
      stubRowsInput(makeOffChunkConversation()),
    );

    expect(deriveHiddenThreadsByFile(input)?.get("src/a.ts")).toHaveLength(1);
  });

  it("leaves out a thread a chunk already renders", () => {
    const input = deriveUnfilteredDigestInput(
      stubRowsInput(makeConversation(["alice"])),
    );

    expect(deriveHiddenThreadsByFile(input)?.get("src/a.ts")).toBeUndefined();
  });
});

describe("deriveLineThreadsByFile", () => {
  it("is absent without a digest input", () => {
    expect(deriveLineThreadsByFile(undefined)).toBeUndefined();
  });
});

describe("deriveConversationFilterFacets", () => {
  it("is absent until the conversation resolves", () => {
    expect(
      deriveConversationFilterFacets(stubRowsInput(undefined)),
    ).toBeUndefined();
  });

  it("drops reviewers the conversation does not name from the filter", () => {
    const facets = deriveConversationFilterFacets({
      ...stubRowsInput(makeConversation(["alice", "bob"])),
      conversationFilter: parseConversationFilter({ reviewers: "ghost,alice" }),
    });

    expect([...(facets?.applied.reviewers ?? [])]).toEqual(["alice"]);
  });

  it("counts the inline threads the filter hides", () => {
    const facets = deriveConversationFilterFacets({
      ...stubRowsInput(makeConversation(["alice", "bob"])),
      conversationFilter: parseConversationFilter({ reviewers: "alice" }),
    });

    expect(facets?.reviewers.map((facet) => facet.login)).toEqual([
      "alice",
      "bob",
    ]);
    expect(facets?.hiddenInlineThreads).toBe(1);
  });
});
