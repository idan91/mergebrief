// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { InboxReviewStates } from "types/inbox";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INBOX_QUERY_ROOT, ROW_POLL_MS } from "../../../consts";
import type { InboxItem } from "../../../types";
import { useRowGeneration } from "./useRowGeneration";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.useRealTimers();
});

function makeItem(
  status: "pending" | "succeeded",
  updatedAt = "2026-09-20T10:00:00Z",
): InboxItem {
  return {
    repoId: "424242",
    repoSlug: "o/r",
    prNumber: 7,
    title: "t",
    state: "open",
    draft: false,
    source: "installation",
    installationId: "10",
    viewerIsAuthor: false,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
    generation: { status, updatedAt },
    latestBriefAt: null,
    githubUpdatedAt: null,
    stack: null,
  };
}

function answerMeta(status: string): void {
  fetchMock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          repoId: "424242",
          repoSlug: "o/r",
          prNumber: 7,
          title: "t",
          state: "open",
          baseSha: null,
          headSha: null,
          briefAvailable: status === "succeeded",
          draft: false,
          viewerIsAuthor: false,
          viewerCanResolve: false,
          behind: false,
          generation: {
            status,
            phase: null,
            attempts: 1,
            errorCode: null,
            errorParams: null,
            updatedAt: "2026-09-20T10:05:00Z",
          },
          updatedAt: "2026-09-20T10:05:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
}

function Probe({ item }: { item: InboxItem }) {
  const generation = useRowGeneration(item);
  return <output>{generation?.status ?? "none"}</output>;
}

function renderProbe(item: InboxItem) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <Probe item={item} />
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

describe("useRowGeneration", () => {
  it("a settled row reads nothing and shows the list's generation", async () => {
    renderProbe(makeItem("succeeded"));

    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("succeeded");
  });

  it("a pending row polls, then re-reads the list once when done", async () => {
    answerMeta("succeeded");
    const { invalidate } = renderProbe(makeItem("pending"));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("succeeded");
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [INBOX_QUERY_ROOT] });
  });

  it("an in-flight row polls every tick until the read settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answerMeta("running");
    const { invalidate } = renderProbe(makeItem("pending"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2.5 * ROW_POLL_MS);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status").textContent).toBe("running");
    expect(invalidate).not.toHaveBeenCalled();

    answerMeta("succeeded");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROW_POLL_MS);
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("a terminal read older than the queued row does not outrank it", async () => {
    answerMeta("failed");
    const { invalidate } = renderProbe(
      makeItem("pending", "2026-09-20T10:10:00Z"),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("pending");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("a failed read ends the poll instead of hitting the API every tick", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "github-unavailable" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    );
    const { client, invalidate } = renderProbe(makeItem("pending"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * ROW_POLL_MS);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const query = client.getQueryCache().findAll({ queryKey: ["pr-meta"] })[0];
    expect(query?.state.status).toBe("error");
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("pending");
  });
});
