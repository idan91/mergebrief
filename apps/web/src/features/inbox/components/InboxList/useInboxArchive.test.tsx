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
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  const { result } = renderHook(
    () => useInboxArchive({ scope, announce, onRemoved }),
    { wrapper },
  );
  return { result, announce, onRemoved, invalidate };
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

  it("unarchives in the archived view and tallies a single row", async () => {
    answerByPull([]);
    const { result, announce } = renderArchive();

    await act(async () => {
      await result.current.archive(ROWS.slice(0, 1), InboxArchivedFilters.ONLY);
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/pulls\/1\/unarchive$/);
    expect(init?.method).toBe("POST");
    expect(announce).toHaveBeenCalledWith("Unarchived 1");
  });

  it("a thrown transport counts as failed; nothing going skips the re-read", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result, announce, onRemoved, invalidate } = renderArchive();

    let gone: readonly InboxItem[] = [];
    await act(async () => {
      gone = await result.current.archive(ROWS, InboxArchivedFilters.HIDE);
    });

    expect(announce).toHaveBeenCalledWith("Archived 0 of 3; 3 failed");
    expect(onRemoved).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(gone).toEqual([]);
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

describe("useInboxArchive over one row", () => {
  const [ROW] = ROWS;
  if (ROW === undefined) {
    throw new Error("unreachable");
  }

  it("announces the row's own archive line and frees it", async () => {
    answerByPull([]);
    const { result, announce, onRemoved, invalidate } = renderArchive(
      ArchiveScopes.ROW,
    );

    await act(async () => {
      await result.current.archive([ROW], InboxArchivedFilters.HIDE);
    });

    expect(announce).toHaveBeenCalledWith(
      "Archived; it comes back when a new brief lands",
    );
    expect(onRemoved).toHaveBeenCalledWith([ROW]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [INBOX_QUERY_ROOT] });
  });

  it("announces the row's own unarchive line", async () => {
    answerByPull([]);
    const { result, announce } = renderArchive(ArchiveScopes.ROW);

    await act(async () => {
      await result.current.archive([ROW], InboxArchivedFilters.ONLY);
    });

    expect(announce).toHaveBeenCalledWith("Back in your Inbox");
  });

  it.each([
    [InboxArchivedFilters.HIDE, "Archive failed; the row is still here"],
    [InboxArchivedFilters.ONLY, "Unarchive failed; the row is still archived"],
  ])("a failure in the %s view keeps the row", async (view, line) => {
    answerByPull([1]);
    const { result, announce, onRemoved } = renderArchive(ArchiveScopes.ROW);

    await act(async () => {
      await result.current.archive([ROW], view);
    });

    expect(announce).toHaveBeenCalledWith(line);
    expect(onRemoved).not.toHaveBeenCalled();
  });

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
