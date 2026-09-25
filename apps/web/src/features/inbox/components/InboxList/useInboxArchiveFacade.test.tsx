// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { InboxArchivedFilters, InboxReviewStates } from "types/inbox";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INBOX_QUERY_ROOT } from "../../consts";
import type { InboxItem } from "../../types";
import { useInboxArchiveFacade } from "./useInboxArchiveFacade";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    repoId: "424242",
    repoSlug: "acme/payments",
    prNumber: 7,
    title: "t",
    state: "open",
    draft: false,
    source: "installation",
    installationId: "10",
    viewerIsAuthor: false,
    viewerCanDelete: false,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
    generation: null,
    latestBriefAt: null,
    githubUpdatedAt: null,
    stack: null,
    ...overrides,
  };
}

function readRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function answerByPull(failing: readonly number[]): void {
  fetchMock.mockImplementation(async (input) => {
    const url = readRequestUrl(input);
    const failed = failing.some((number) =>
      url.includes(`/pulls/${String(number)}/archive`),
    );
    return new Response(JSON.stringify(failed ? {} : { ok: true }), {
      status: failed ? 500 : 200,
    });
  });
}

function renderFacade() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const announce = vi.fn();
  const onRemoved = vi.fn();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  const { result } = renderHook(
    () => useInboxArchiveFacade({ announce, onRemoved }),
    { wrapper },
  );
  return { result, announce, onRemoved, invalidate };
}

const ROWS = [
  makeItem({ prNumber: 1 }),
  makeItem({ prNumber: 2 }),
  makeItem({ prNumber: 3 }),
];

describe("useInboxArchiveFacade", () => {
  it("archives every row, announces the tally once and answers them", async () => {
    answerByPull([]);
    const { result, announce, onRemoved, invalidate } = renderFacade();

    let gone: readonly InboxItem[] = [];
    await act(async () => {
      gone = await result.current.archiveMany(ROWS, InboxArchivedFilters.HIDE);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("PUT");
    expect(announce).toHaveBeenCalledWith("Archived 3");
    expect(onRemoved).toHaveBeenCalledWith(ROWS);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [INBOX_QUERY_ROOT] });
    expect(gone.map((row) => row.prNumber)).toEqual([1, 2, 3]);
    expect(result.current.busy).toBe(false);
  });

  it("a partial failure tallies both sides and answers the rows that went", async () => {
    answerByPull([2]);
    const { result, announce } = renderFacade();

    let gone: readonly InboxItem[] = [];
    await act(async () => {
      gone = await result.current.archiveMany(ROWS, InboxArchivedFilters.HIDE);
    });

    expect(announce).toHaveBeenCalledWith("Archived 2 of 3; 1 failed");
    expect(gone.map((row) => row.prNumber)).toEqual([1, 3]);
  });

  it("unarchives in the archived view", async () => {
    answerByPull([]);
    const { result, announce } = renderFacade();

    await act(async () => {
      await result.current.archiveMany(
        ROWS.slice(0, 1),
        InboxArchivedFilters.ONLY,
      );
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("DELETE");
    expect(announce).toHaveBeenCalledWith("Unarchived 1");
  });

  it("a thrown transport counts as failed; nothing going skips the re-read", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result, announce, onRemoved, invalidate } = renderFacade();

    let gone: readonly InboxItem[] = [];
    await act(async () => {
      gone = await result.current.archiveMany(ROWS, InboxArchivedFilters.HIDE);
    });

    expect(announce).toHaveBeenCalledWith("Archived 0 of 3; 3 failed");
    expect(onRemoved).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(gone).toEqual([]);
  });
});
