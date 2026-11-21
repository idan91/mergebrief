// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { InboxArchivedFilters, InboxReviewStates } from "types/inbox";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INBOX_QUERY_ROOT } from "../../consts";
import type { InboxItem } from "../../types";
import { ArchiveScopes, type ArchiveScope } from "./types";
import { useInboxArchive } from "./useInboxArchive";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

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
    viewerCanPush: false,
    generateEveryPush: false,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
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
      url.includes(`/pulls/${String(number)}/`),
    );
    if (failed) {
      return new Response(JSON.stringify({}), { status: 500 });
    }
    return new Response(null, { status: 204 });
  });
}

function renderArchive(scope: ArchiveScope = ArchiveScopes.SELECTION) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const announce = vi.fn();
  const onRemoved = vi.fn();
  const announceRestoreFailed = vi.fn();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  const { result } = renderHook(
    () =>
      useInboxArchive({ scope, announce, announceRestoreFailed, onRemoved }),
    { wrapper },
  );
  return { result, announce, announceRestoreFailed, onRemoved, invalidate };
}

function stubHeldReread(
  invalidate: ReturnType<typeof renderArchive>["invalidate"],
): () => void {
  let release: () => void = () => undefined;
  invalidate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  return () => release();
}

function stubQueuedRereads(
  invalidate: ReturnType<typeof renderArchive>["invalidate"],
): Array<() => void> {
  const releases: Array<() => void> = [];
  invalidate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      }),
  );
  return releases;
}

function stubHeldFetches(): Array<() => void> {
  const answers: Array<() => void> = [];
  fetchMock.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        answers.push(() => resolve(new Response(null, { status: 204 })));
      }),
  );
  return answers;
}

const ROWS = [
  makeItem({ prNumber: 1 }),
  makeItem({ prNumber: 2 }),
  makeItem({ prNumber: 3 }),
];

describe("useInboxArchive over a selection", () => {
  it("archives every row, announces the tally once and answers them", async () => {
    answerByPull([]);
    const { result, announce, onRemoved, invalidate } = renderArchive();

    let gone: readonly InboxItem[] = [];
    await act(async () => {
      gone = await result.current.archive(ROWS, InboxArchivedFilters.HIDE);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/pulls\/1\/archive$/);
    expect(init?.method).toBe("POST");
    expect(announce).toHaveBeenCalledWith("Archived 3");
    expect(onRemoved).toHaveBeenCalledWith(ROWS);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [INBOX_QUERY_ROOT] });
    expect(gone.map((row) => row.prNumber)).toEqual([1, 2, 3]);
    expect(result.current.pending).toBe(false);
  });

  it("a partial failure tallies both sides and answers the rows that went", async () => {
    answerByPull([2]);
    const { result, announce } = renderArchive();

    let gone: readonly InboxItem[] = [];
    await act(async () => {
      gone = await result.current.archive(ROWS, InboxArchivedFilters.HIDE);
    });

    expect(announce).toHaveBeenCalledWith("Archived 2 of 3; 1 failed");
    expect(gone.map((row) => row.prNumber)).toEqual([1, 3]);
  });

  it("unarchives in the archived view and reads one row as a sentence", async () => {
    answerByPull([]);
    const { result, announce } = renderArchive();

    await act(async () => {
      await result.current.archive(ROWS.slice(0, 1), InboxArchivedFilters.ONLY);
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/pulls\/1\/unarchive$/);
    expect(init?.method).toBe("POST");
    expect(announce).toHaveBeenCalledWith("Back in your Inbox");
  });

  it("a thrown transport is unconfirmed and re-reads the list", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result, announce, onRemoved, invalidate } = renderArchive();

    let gone: readonly InboxItem[] = [];
    await act(async () => {
      gone = await result.current.archive(ROWS, InboxArchivedFilters.HIDE);
    });

    expect(announce).toHaveBeenCalledWith(
      "Archived 0 of 3; we could not confirm the rest",
    );
    expect(onRemoved).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
    expect(gone).toEqual([]);
  });

  it("a refused write says failed and skips the re-read", async () => {
    answerByPull([1, 2, 3]);
    const { result, announce, invalidate } = renderArchive();
    const rows = [
      makeItem({ prNumber: 1 }),
      makeItem({ prNumber: 2 }),
      makeItem({ prNumber: 3 }),
    ];

    await act(async () => {
      await result.current.archive(rows, InboxArchivedFilters.HIDE);
    });

    expect(announce).toHaveBeenCalledWith("Archived 0 of 3; 3 failed");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("frees the selection bar before the re-read lands", async () => {
    answerByPull([]);
    const { result, invalidate } = renderArchive();
    const release = stubHeldReread(invalidate);

    let run: Promise<readonly InboxItem[]> = Promise.resolve([]);
    await act(async () => {
      run = result.current.archive(ROWS, InboxArchivedFilters.HIDE);
      await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    });

    expect(result.current.pending).toBe(false);
    await act(async () => {
      release();
      await run;
    });
  });

  it("a stale run's re-read never frees the run after it", async () => {
    answerByPull([]);
    const { result, invalidate } = renderArchive();
    const rereads = stubQueuedRereads(invalidate);

    let first: Promise<readonly InboxItem[]> = Promise.resolve([]);
    await act(async () => {
      first = result.current.archive(ROWS, InboxArchivedFilters.HIDE);
      await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    });
    const answers = stubHeldFetches();
    let second: Promise<readonly InboxItem[]> = Promise.resolve([]);
    await act(async () => {
      second = result.current.archive(ROWS, InboxArchivedFilters.HIDE);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
      rereads[0]?.();
      await first;
    });

    expect(result.current.pending).toBe(true);
    let third: readonly InboxItem[] = ROWS;
    await act(async () => {
      third = await result.current.archive(ROWS, InboxArchivedFilters.HIDE);
    });
    expect(third).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    await act(async () => {
      answers.forEach((answer) => answer());
      await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
      rereads[1]?.();
      await second;
    });
    expect(result.current.pending).toBe(false);
  });

  it("refuses a second run while the first is in flight", async () => {
    answerByPull([]);
    const { result, announce } = renderArchive();

    let second: readonly InboxItem[] = ROWS;
    await act(async () => {
      const first = result.current.archive(ROWS, InboxArchivedFilters.HIDE);
      second = await result.current.archive(ROWS, InboxArchivedFilters.HIDE);
      await first;
    });

    expect(second).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(announce).toHaveBeenCalledTimes(1);
  });
});

describe("useInboxArchive when an answer goes wrong", () => {
  it("offers a restore's failed rows back, not the ones that went", async () => {
    answerByPull([2, 3]);
    const { result, announce, announceRestoreFailed } = renderArchive();
    const items = [
      makeItem({ prNumber: 1 }),
      makeItem({ prNumber: 2 }),
      makeItem({ prNumber: 3 }),
    ];

    await act(async () => {
      await result.current.archive(items, InboxArchivedFilters.ONLY);
    });

    expect(announce).not.toHaveBeenCalled();
    expect(announceRestoreFailed).toHaveBeenCalledWith(
      "Unarchived 1 of 3; 2 failed",
      [items[1], items[2]],
    );
  });

  it("offers a wholly failed restore back with the row's own words", async () => {
    answerByPull([1]);
    const { result, announceRestoreFailed } = renderArchive();
    const item = makeItem({ prNumber: 1 });

    await act(async () => {
      await result.current.archive([item], InboxArchivedFilters.ONLY);
    });

    expect(announceRestoreFailed).toHaveBeenCalledWith(
      "Unarchive failed; the row is still archived",
      [item],
    );
  });

  it("offers no restore back for a row the server no longer has", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "x", code: "not-found" }), {
        status: 404,
      }),
    );
    const { result, announce, announceRestoreFailed } = renderArchive();

    await act(async () => {
      await result.current.archive(
        [makeItem({ prNumber: 1 })],
        InboxArchivedFilters.ONLY,
      );
    });

    expect(announceRestoreFailed).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(
      "Unarchive failed; the row is still archived",
    );
  });

  it("offers back only the failed rows a second try could restore", async () => {
    fetchMock.mockImplementation(async (input) => {
      if (readRequestUrl(input).includes("/pulls/1/")) {
        return new Response(JSON.stringify({ error: "x", code: "not-found" }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });
    const { result, announceRestoreFailed } = renderArchive();
    const items = [makeItem({ prNumber: 1 }), makeItem({ prNumber: 2 })];

    await act(async () => {
      await result.current.archive(items, InboxArchivedFilters.ONLY);
    });

    expect(announceRestoreFailed).toHaveBeenCalledWith(
      "Unarchived 0 of 2; 2 failed",
      [items[1]],
    );
  });

  it("will not claim a row stayed put when the write got no answer", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));
    const { result, announceRestoreFailed, invalidate } = renderArchive();
    const item = makeItem({ prNumber: 1 });

    await act(async () => {
      await result.current.archive([item], InboxArchivedFilters.ONLY);
    });

    expect(announceRestoreFailed).toHaveBeenCalledWith(
      "We could not confirm this row came back. Refresh to check.",
      [item],
    );
    expect(invalidate).toHaveBeenCalled();
  });

  it("says the same of an archive that got no answer", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));
    const { result, announce } = renderArchive();

    await act(async () => {
      await result.current.archive(
        [makeItem({ prNumber: 1 }), makeItem({ prNumber: 2 })],
        InboxArchivedFilters.HIDE,
      );
    });

    expect(announce).toHaveBeenCalledWith(
      "Archived 0 of 2; we could not confirm the rest",
    );
  });
});

describe("useInboxArchive over one row", () => {
  const [ROW] = ROWS;
  if (ROW === undefined) {
    throw new Error("unreachable");
  }

  it("holds the row's action until the re-read lands", async () => {
    answerByPull([]);
    const { result, invalidate } = renderArchive(ArchiveScopes.ROW);
    const release = stubHeldReread(invalidate);

    let run: Promise<readonly InboxItem[]> = Promise.resolve([]);
    await act(async () => {
      run = result.current.archive([ROW], InboxArchivedFilters.HIDE);
      await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    });

    expect(result.current.pending).toBe(true);
    await act(async () => {
      release();
      await run;
    });
    expect(result.current.pending).toBe(false);
  });
});
