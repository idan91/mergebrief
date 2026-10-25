// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { omitFields } from "@web/test/fields";
import type { PrSummary } from "../../../../../types";
import { useBehindNoticeFacade } from "./useBehindNoticeFacade";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

function makeMeta(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "t",
    state: "open",
    baseSha: "base-1",
    headSha: "head-1",
    briefAvailable: true,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: false,
    viewerCanPush: false,
    appInstalled: false,
    updatedAt: "2026-09-20T10:00:00.000Z",
    behind: true,
    ...overrides,
  };
}

function renderNotice(meta: PrSummary) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(
    (current: PrSummary) => useBehindNoticeFacade(current, "424242", 7),
    { wrapper, initialProps: meta },
  );
  return { ...rendered, invalidate };
}

function answerWith(status: number, body: unknown): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("useBehindNoticeFacade", () => {
  it("offers no notice while the latest brief is current", () => {
    const { result } = renderNotice(makeMeta({ behind: false }));

    expect(result.current.notice).toBeUndefined();
    expect(result.current.announcement).toBe("");
  });

  it("regenerates with the pull request's URL and re-reads the meta", async () => {
    answerWith(202, { repoId: "424242", prNumber: 7 });
    const { result, invalidate } = renderNotice(makeMeta());

    act(() => result.current.notice?.onRegenerate?.());

    await waitFor(() => expect(result.current.notice?.pending).toBe(false));
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = init?.body;
    expect(typeof body === "string" ? JSON.parse(body) : undefined).toEqual({
      url: "https://github.com/octo/hello/pull/7",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["pr-meta", "424242", 7],
    });
    await waitFor(() =>
      expect(result.current.announcement).toBe("Regenerate queued"),
    );
    expect(result.current.notice?.failure).toBeUndefined();
  });

  it("announces the arrival of the brief it asked for", async () => {
    answerWith(202, { repoId: "424242", prNumber: 7 });
    const { result, rerender } = renderNotice(makeMeta());
    act(() => result.current.notice?.onRegenerate?.());
    await waitFor(() =>
      expect(result.current.announcement).toBe("Regenerate queued"),
    );

    rerender(makeMeta({ behind: false }));

    await waitFor(() =>
      expect(result.current.announcement).toBe("The new brief is ready."),
    );
    expect(result.current.notice).toBeUndefined();
  });

  it("stays quiet when the brief arrives unasked", () => {
    const { result, rerender } = renderNotice(makeMeta());

    rerender(makeMeta({ behind: false }));

    expect(result.current.announcement).toBe("");
  });

  it("reports queued while a generation runs and the curated refusal", async () => {
    const queued = renderNotice(
      makeMeta({
        generation: {
          status: "pending",
          attempts: 0,
          updatedAt: "2026-09-20T10:00:00.000Z",
        },
      }),
    );
    expect(queued.result.current.notice?.queued).toBe(true);

    answerWith(401, { code: "unauthorized" });
    const refused = renderNotice(makeMeta());
    act(() => refused.result.current.notice?.onRegenerate?.());
    await waitFor(() =>
      expect(refused.result.current.notice?.failure).toContain("Sign in"),
    );
    await waitFor(() =>
      expect(refused.result.current.announcement).toContain("Sign in"),
    );
    expect(refused.invalidate).toHaveBeenCalledTimes(1);
  });

  it("carries the draft window while the author's regeneration is queued", () => {
    const pending = {
      status: "pending" as const,
      attempts: 0,
      updatedAt: "2026-09-20T10:00:00.000Z",
    };
    const ownDraft = renderNotice(
      makeMeta({
        draft: true,
        viewerIsAuthor: true,
        draftPolicy: { generate: true, debounceSeconds: 900 },
        generation: pending,
      }),
    );
    const otherViewer = renderNotice(
      makeMeta({
        draft: true,
        draftPolicy: { generate: true, debounceSeconds: 900 },
        generation: pending,
      }),
    );

    expect(ownDraft.result.current.notice?.queuedNotice).toContain(
      "15 minutes",
    );
    expect(otherViewer.result.current.notice?.queuedNotice).toBeUndefined();
  });

  it("shows an installation row's notice without a button", () => {
    const { result } = renderNotice(makeMeta({ appInstalled: true }));

    expect(result.current.notice).toBeDefined();
    expect(result.current.notice?.onRegenerate).toBeUndefined();
  });

  it("offers no button while the repository name is unknown", () => {
    const { result } = renderNotice(omitFields(makeMeta(), "repoSlug"));

    expect(result.current.notice?.onRegenerate).toBeUndefined();
  });

  it.each(["diff-too-large", "output-secret", "provider-refusal"] as const)(
    "offers no repeat paste of a head that failed as %s",
    (errorCode) => {
      const failed = makeMeta({
        generation: {
          status: "failed",
          attempts: 0,
          errorCode,
          updatedAt: "2026-09-20T10:00:00.000Z",
        },
      });
      const { result } = renderNotice(failed);

      expect(result.current.notice).toBeDefined();
      expect(result.current.notice?.onRegenerate).toBeUndefined();
    },
  );

  it.each(["provider-timeout", "provider-auth"] as const)(
    "keeps the paste after a %s failure",
    (errorCode) => {
      const failed = makeMeta({
        generation: {
          status: "failed",
          attempts: 0,
          errorCode,
          updatedAt: "2026-09-20T10:00:00.000Z",
        },
      });
      const { result } = renderNotice(failed);

      expect(result.current.notice?.onRegenerate).toBeDefined();
    },
  );
});
