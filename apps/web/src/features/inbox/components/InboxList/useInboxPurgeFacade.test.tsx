// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { InboxReviewStates } from "types/inbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InboxItem } from "../../types";
import { useInboxPurgeFacade } from "./useInboxPurgeFacade";

const INDETERMINATE_COPY =
  "We could not confirm the attachment branch was deleted. Check the repository on GitHub.";

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
  const announce = vi.fn();
  const { result } = renderHook(() => useInboxPurgeFacade({ announce }));
  return { result, announce };
}

describe("useInboxPurgeFacade", () => {
  it("confirming deletes the repository's branch once and announces it", async () => {
    answerWith(200, { ok: true });
    const { result, announce } = renderFacade();
    act(() => result.current.requestPurge(makeItem()));

    await act(async () => {
      await result.current.confirm();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(readRequestUrl(url ?? "")).toMatch(
      /\/api\/repos\/424242\/attachments$/,
    );
    expect(init?.method).toBe("DELETE");
    expect(announce).toHaveBeenCalledWith("Attachment branch deleted");
    expect(result.current.pending).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });

  it("an admin-only refusal announces the admin copy", async () => {
    answerWith(403, { error: "x", code: "attachments-admin-only" });
    const { result, announce } = renderFacade();
    act(() => result.current.requestPurge(makeItem()));

    await act(async () => {
      await result.current.confirm();
    });

    expect(announce).toHaveBeenCalledWith(
      "Only a repository admin can delete this repository's attachment branch",
    );
    expect(result.current.pending).toBeUndefined();
  });

  it("a refused delete names the branch to delete on GitHub", async () => {
    answerWith(403, { error: "x", code: "attachments-disabled" });
    const { result, announce } = renderFacade();
    act(() => result.current.requestPurge(makeItem()));

    await act(async () => {
      await result.current.confirm();
    });

    expect(announce).toHaveBeenCalledWith(
      "This repository does not let the App delete the branch; delete mergebrief/attachments on GitHub",
    );
  });

  it("a permission the App lacks names the branch to delete on GitHub", async () => {
    answerWith(403, { error: "x", code: "github-permission" });
    const { result, announce } = renderFacade();
    act(() => result.current.requestPurge(makeItem()));

    await act(async () => {
      await result.current.confirm();
    });

    expect(announce).toHaveBeenCalledWith(
      "The MergeBrief App may not write to this repository, so the branch stays; delete mergebrief/attachments on GitHub",
    );
  });

  it("a dropped connection says the delete is unconfirmed", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result, announce } = renderFacade();
    act(() => result.current.requestPurge(makeItem()));

    await act(async () => {
      await result.current.confirm();
    });

    expect(announce).toHaveBeenCalledWith(INDETERMINATE_COPY);
    expect(result.current.pending).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });

  it("a bad gateway keeps the failed copy", async () => {
    answerWith(502, { error: "x", code: "github-unavailable" });
    const { result, announce } = renderFacade();
    act(() => result.current.requestPurge(makeItem()));

    await act(async () => {
      await result.current.confirm();
    });

    expect(announce).toHaveBeenCalledWith(
      "Delete failed; the attachment branch is still there",
    );
  });
});
