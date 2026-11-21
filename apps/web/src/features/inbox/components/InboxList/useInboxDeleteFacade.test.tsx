// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { InboxReviewStates } from "types/inbox";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INBOX_QUERY_ROOT } from "../../consts";
import type { InboxItem } from "../../types";
import { ArchiveScopes } from "./types";
import { useInboxDeleteFacade } from "./useInboxDeleteFacade";

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
    viewerCanDelete: true,
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

function answerWith(status: number, body: unknown): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function renderFacade() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const announce = vi.fn();
  const onDeleted = vi.fn();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  const { result } = renderHook(
    () => useInboxDeleteFacade({ announce, onDeleted }),
    { wrapper },
  );
  return { result, announce, onDeleted, invalidate };
}

describe("useInboxDeleteFacade", () => {
  it("confirming deletes the row, announces, moves focus and re-reads", async () => {
    answerWith(200, { ok: true });
    const { result, announce, onDeleted, invalidate } = renderFacade();
    act(() => result.current.requestDelete([makeItem()], ArchiveScopes.ROW));

    await act(async () => {
      await result.current.confirm();
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toMatch(/\/api\/repos\/424242\/pulls\/7$/);
    expect(init?.method).toBe("DELETE");
    expect(announce).toHaveBeenCalledWith("Deleted");
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [INBOX_QUERY_ROOT] });
    expect(result.current.pending).toBeUndefined();
  });

  it("a pasted row goes through the owner-only purge, not the gate", async () => {
    answerWith(200, { ok: true });
    const { result } = renderFacade();
    act(() =>
      result.current.requestDelete(
        [makeItem({ source: "url" })],
        ArchiveScopes.ROW,
      ),
    );

    await act(async () => {
      await result.current.confirm();
    });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(readRequestUrl(url ?? "")).toMatch(/\/api\/inbox\/424242\/7$/);
  });

  it("a repo-admin-only refusal announces the admin copy and keeps the row", async () => {
    answerWith(403, { error: "x", code: "repo-admin-only" });
    const { result, announce, onDeleted, invalidate } = renderFacade();
    act(() => result.current.requestDelete([makeItem()], ArchiveScopes.ROW));

    await act(async () => {
      await result.current.confirm();
    });

    expect(announce).toHaveBeenCalledWith(
      "Only a repository admin can delete this pull request's briefs",
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(result.current.pending).toBeUndefined();
  });

  it("a dropped connection announces the failure and frees the modal", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result, announce } = renderFacade();
    act(() => result.current.requestDelete([makeItem()], ArchiveScopes.ROW));

    await act(async () => {
      await result.current.confirm();
    });

    expect(announce).toHaveBeenCalledWith(
      "Delete failed; the row is still here",
    );
    expect(result.current.busy).toBe(false);
    expect(result.current.pending).toBeUndefined();
  });

  it("a multi-row confirm fans out, tallies and answers the rows that went", async () => {
    const rows = [
      makeItem({ prNumber: 1 }),
      makeItem({ prNumber: 2 }),
      makeItem({ prNumber: 3 }),
      makeItem({ prNumber: 4 }),
    ];
    fetchMock.mockImplementation(async (input) => {
      const url = readRequestUrl(input);
      const status = url.endsWith("/pulls/3") ? 500 : 200;
      return new Response(JSON.stringify(status === 200 ? { ok: true } : {}), {
        status,
      });
    });
    const { result, announce, onDeleted, invalidate } = renderFacade();
    act(() => result.current.requestDelete(rows, ArchiveScopes.SELECTION));

    let gone: readonly InboxItem[] = [];
    await act(async () => {
      gone = await result.current.confirm();
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(announce).toHaveBeenCalledWith("Deleted 3 of 4; 1 failed");
    expect(onDeleted).toHaveBeenCalledWith(
      [rows[0], rows[1], rows[3]],
      ArchiveScopes.SELECTION,
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(gone.map((row) => row.prNumber)).toEqual([1, 2, 4]);
  });

  it("closes the modal before the re-read lands", async () => {
    answerWith(200, { ok: true });
    const { result, invalidate, onDeleted } = renderFacade();
    invalidate.mockReturnValue(new Promise(() => {}));
    act(() => result.current.requestDelete([makeItem()], ArchiveScopes.ROW));

    let confirmed: Promise<readonly InboxItem[]> = Promise.resolve([]);
    await act(async () => {
      confirmed = result.current.confirm();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.pending).toBeUndefined();
    });
    expect(result.current.busy).toBe(false);
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    void confirmed;
  });

  it("a finished bulk read never replaces an open row delete", () => {
    const { result, announce } = renderFacade();
    const row = makeItem({ prNumber: 1 });
    act(() => result.current.requestDelete([row], ArchiveScopes.ROW));

    act(() =>
      result.current.requestDelete(
        [makeItem({ prNumber: 2 }), makeItem({ prNumber: 3 })],
        ArchiveScopes.SELECTION,
      ),
    );

    expect(result.current.pending?.items).toEqual([row]);
    expect(result.current.pending?.scope).toBe(ArchiveScopes.ROW);
    expect(announce).toHaveBeenCalledWith(
      "A delete is already waiting for your answer. Finish it first.",
    );
  });

  it("a row delete settles as a row even after a bulk request", async () => {
    answerWith(200, { ok: true });
    const { result, onDeleted } = renderFacade();
    const row = makeItem({ prNumber: 1 });
    act(() => result.current.requestDelete([row], ArchiveScopes.ROW));
    act(() =>
      result.current.requestDelete(
        [makeItem({ prNumber: 2 })],
        ArchiveScopes.SELECTION,
      ),
    );

    await act(async () => {
      await result.current.confirm();
    });

    expect(onDeleted).toHaveBeenCalledWith([row], ArchiveScopes.ROW);
  });

  it("is busy while the delete is in flight", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderFacade();
    act(() => result.current.requestDelete([makeItem()], ArchiveScopes.ROW));

    let confirmed: Promise<readonly InboxItem[]> = Promise.resolve([]);
    act(() => {
      confirmed = result.current.confirm();
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      release(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await confirmed;
    });
    expect(result.current.busy).toBe(false);
  });
});
