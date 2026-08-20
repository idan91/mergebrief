// @vitest-environment jsdom
// The thread row's two renderings: the full disclosure row, and the slim
// "resolved" line a settled thread collapses to. Pins which state picks which
// variant (outdated wins over resolved), that the slim row stays the SAME
// single-button disclosure, and that its accessible name still carries who
// said what — "resolved" alone would name every settled row identically.
import { appI18n } from "../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Brief, BriefChunk } from "@web/features/brief/types";
import { buildBriefViewModel } from "@web/features/brief/utils";
import {
  createReviewFlowStore,
  ReviewSessionProvider,
  ReviewFlowProvider,
} from "@web/features/review/session";
import type { DigestThreadRow } from "../../utils/digest";
import type { ConversationThread } from "../../types";
import type { ThreadComposerWiring } from "../../wiring";
import { ThreadRowView } from "./ThreadRowView";

const BRIEF_ID = "db:42:7:base:head";

// One ordered hook: cleanup() unmounts the ReviewSessionProvider, whose
// teardown FLUSHES a pending snapshot write — the storage clear must run
// after it, or one test's drafts hydrate into the next (every test shares a
// briefId).
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

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
    diff: [
      { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
      { kind: "add", content: "b", newLine: 10 },
    ],
  } as BriefChunk;
}

const providerBrief: Brief = {
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

const DIGEST_LINE = "The guard clause landed.";

interface RowOverrides {
  isResolved?: boolean;
  isOutdated?: boolean;
  isOwn?: boolean;
  comments?: number;
  anchorLabel?: string;
}

function threadRow(overrides: RowOverrides = {}): DigestThreadRow {
  const count = overrides.comments ?? 1;
  const thread: ConversationThread = {
    rootCommentId: 9001,
    path: "src/a.ts",
    line: 10,
    side: "RIGHT",
    subjectType: "LINE",
    isResolved: overrides.isResolved ?? false,
    isOutdated: overrides.isOutdated ?? false,
    comments: Array.from({ length: count }, (_, index) => ({
      commentId: 9001 + index,
      author: {
        login: index === 0 ? "alice" : "bob",
        isBot: false,
        avatarUrl: `https://avatars.example/${index === 0 ? "alice" : "bob"}.png`,
      },
      body: index === 0 ? DIGEST_LINE : "and a follow-up",
      createdAt: "2026-07-01T10:00:00Z",
      url: `https://example.test/c/${String(9001 + index)}`,
    })),
    hasMoreComments: false,
  };
  return {
    kind: "thread",
    thread,
    digestLine: DIGEST_LINE,
    placement: { kind: "chunk", chunkId: "c1", rowId: "c1:1" },
    isOwn: overrides.isOwn ?? false,
    ...(overrides.anchorLabel === undefined
      ? {}
      : { anchorLabel: overrides.anchorLabel }),
  };
}

function composer(): ThreadComposerWiring {
  return {
    post: vi.fn(async () => ({ kind: "posted", commentId: 1 }) as const),
    onPosted: vi.fn(),
  };
}

function renderRow(row: DigestThreadRow, expanded = false) {
  // The reply composer inside an expanded detail reads the session stores.
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
    },
    {
      composerDisabledReason: undefined,
      flagsReadOnly: false,
      postingCommentIds: new Set(),
      postBlockedExternally: undefined,
      postComment: undefined,
    },
    appI18n.t,
  );
  const toggle = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider
        briefId={BRIEF_ID}
        model={buildBriefViewModel(providerBrief)}
      >
        <ReviewFlowProvider store={flowStore}>
          <ul>
            <ThreadRowView
              composer={composer()}
              expanded={expanded}
              jumpToChunk={vi.fn()}
              row={row}
              toggle={toggle}
            />
          </ul>
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>,
  );
  return { view, toggle };
}

describe("ThreadRowView — slim resolved rows", () => {
  it("renders a collapsed resolved thread as the slim variant", () => {
    const { view } = renderRow(threadRow({ isResolved: true, isOwn: true }));
    const row = screen.getByTestId("thread-row");
    expect(row.getAttribute("data-density")).toBe("slim");
    // The faint literal label, NOT the chip component (chips carry data-state).
    expect(view.container.querySelector("[data-state]")).toBeNull();
    // No own-tag and no revision label crowd the settled line.
    expect(screen.queryByText("yours")).toBeNull();
    expect(screen.queryByText(/^at /)).toBeNull();
    // The excerpt is the row's digest line.
    expect(row.textContent).toContain(DIGEST_LINE);
  });

  it("keeps an outdated resolved thread on the full row (outdated wins)", () => {
    renderRow(
      threadRow({ isResolved: true, isOutdated: true, anchorLabel: "abc1234" }),
    );
    const row = screen.getByTestId("thread-row");
    expect(row.getAttribute("data-density")).toBe("full");
    // threadStateChip truth is untouched: the chip reads outdated.
    expect(screen.getByText("outdated").getAttribute("data-state")).toBe(
      "outdated",
    );
    expect(screen.getByText("at abc1234")).toBeDefined();
  });

  it("keeps an unresolved thread on the full row", () => {
    renderRow(threadRow({ isOwn: true }));
    const row = screen.getByTestId("thread-row");
    expect(row.getAttribute("data-density")).toBe("full");
    expect(screen.getByText("open").getAttribute("data-state")).toBe("open");
    expect(screen.getByText("yours")).toBeDefined();
  });

  it("restores the full row and detail when a resolved thread is expanded", () => {
    renderRow(threadRow({ isResolved: true }), true);
    const row = screen.getByTestId("thread-row");
    expect(row.getAttribute("data-density")).toBe("full");
    expect(row.getAttribute("aria-expanded")).toBe("true");
    // The full ThreadDetail renders as it does for any expanded thread.
    expect(screen.getByLabelText(/Reply \(posts to GitHub/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Jump to comment" }),
    ).toBeDefined();
  });

  it("stays one aria-expanded disclosure: the slim row is the only control", () => {
    const { toggle } = renderRow(threadRow({ isResolved: true }));
    const row = screen.getByTestId("thread-row");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    // Rendering only — no resolve/unresolve actions ride the collapsed row.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(row);
    expect(toggle).toHaveBeenCalledWith(9001);
  });

  it("names the slim row by author and excerpt, not just “resolved”", () => {
    renderRow(threadRow({ isResolved: true, comments: 3 }));
    // Every settled row would otherwise share one name.
    expect(screen.queryByRole("button", { name: "resolved" })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: /^resolved\s*@alice\s*The guard clause landed\.\s*3 comments$/,
      }),
    ).toBeDefined();
  });

  it("shows the comment count only above one comment (today's rule)", () => {
    renderRow(threadRow({ isResolved: true }));
    expect(screen.getByTestId("thread-row").textContent).not.toMatch(
      /\d+ comments/,
    );
  });

  it("keeps the jump-to-thread landing attribute on a slim row", () => {
    const { view } = renderRow(threadRow({ isResolved: true }));
    expect(
      view.container.querySelector('[data-conversation-section-thread="9001"]'),
    ).not.toBeNull();
  });

  it("drops the landing attribute on inline (hideJump) renders, slim included", () => {
    const flowStore = createReviewFlowStore(
      {
        saveComment: vi.fn(),
        updateComment: vi.fn(),
        deleteComment: vi.fn(),
        toggleComment: vi.fn(),
      },
      {
        composerDisabledReason: undefined,
        flagsReadOnly: false,
        postingCommentIds: new Set(),
        postBlockedExternally: undefined,
        postComment: undefined,
      },
      appI18n.t,
    );
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ReviewSessionProvider
          briefId={BRIEF_ID}
          model={buildBriefViewModel(providerBrief)}
        >
          <ReviewFlowProvider store={flowStore}>
            <ul>
              <ThreadRowView
                composer={composer()}
                expanded={false}
                hideJump
                jumpToChunk={vi.fn()}
                row={threadRow({ isResolved: true })}
                toggle={vi.fn()}
              />
            </ul>
          </ReviewFlowProvider>
        </ReviewSessionProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("thread-row").getAttribute("data-density")).toBe(
      "slim",
    );
    expect(
      container.querySelector("[data-conversation-section-thread]"),
    ).toBeNull();
  });
});

describe("ThreadRowView — author avatars", () => {
  it("shows the root author's avatar on the full row", () => {
    renderRow(threadRow({}));
    const row = screen.getByTestId("thread-row");
    expect(row.querySelector("img")?.getAttribute("src")).toBe(
      "https://avatars.example/alice.png",
    );
    // Decorative — the login text carries the identity.
    expect(row.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("keeps the slim resolved row text-only (no avatar)", () => {
    renderRow(threadRow({ isResolved: true }));
    expect(screen.getByTestId("thread-row").querySelector("img")).toBeNull();
  });

  it("shows per-comment avatars in the expanded detail", () => {
    renderRow(threadRow({ comments: 2 }), true);
    const detailAvatars = [...document.querySelectorAll("article img")].map(
      (img) => img.getAttribute("src"),
    );
    expect(detailAvatars).toEqual([
      "https://avatars.example/alice.png",
      "https://avatars.example/bob.png",
    ]);
  });
});
