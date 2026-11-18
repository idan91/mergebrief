// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createI18n } from "i18n";
import type { GenerationStatus } from "types";

import { omitFields } from "@web/test/fields";
import type { PrSummary } from "../../../../../../types";
import {
  arrivedAnnouncement,
  countAnnouncements,
  makeGenerationFields,
  makeUrlMeta,
  queuedAnnouncement,
  settlePoll,
} from "../test-utils";
import { NewerCommitsStates } from "../types";
import { deriveNewerCommitsStatus } from "../utils";
import { usePasteRegenerate } from "./usePasteRegenerate";

const fetchMock = vi.fn<typeof fetch>();
const { t } = createI18n();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

function makePastedMeta(overrides: Partial<PrSummary> = {}): PrSummary {
  return makeUrlMeta({
    briefAvailable: true,
    headBriefStored: true,
    ...overrides,
  });
}

function renderPaste(meta: PrSummary) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const announcements: string[] = [];
  const rendered = renderHook(
    (current: PrSummary) => {
      const paste = usePasteRegenerate(current, "424242", 7);
      announcements.push(paste.announcement);
      return paste;
    },
    { wrapper, initialProps: meta },
  );
  return { ...rendered, invalidate, announcements };
}

function answerWith(status: number, body: unknown): void {
  const json = JSON.stringify(body);
  fetchMock.mockResolvedValue(
    new Response(json, {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("usePasteRegenerate", () => {
  it("stays quiet and idle before any paste", () => {
    const { result } = renderPaste(makePastedMeta());

    expect(result.current.announcement).toBe("");
    expect(result.current.pending).toBe(false);
    expect(result.current.failure).toBeUndefined();
  });

  it("regenerates with the pull request's URL and re-reads the meta", async () => {
    answerWith(202, { repoId: "424242", prNumber: 7 });
    const { result, invalidate } = renderPaste(makePastedMeta());

    act(() => result.current.trigger?.());

    await waitFor(() => expect(result.current.pending).toBe(false));
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = init?.body;
    expect(typeof body === "string" ? JSON.parse(body) : undefined).toEqual({
      url: "https://github.com/octo/hello/pull/7",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["pr-meta", "424242", 7],
    });
    await waitFor(() =>
      expect(result.current.announcement).toBe(queuedAnnouncement),
    );
    expect(result.current.failure).toBeUndefined();
  });

  it("reports the request in flight until it settles", async () => {
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );
    const { result } = renderPaste(makePastedMeta());

    act(() => result.current.trigger?.());

    await waitFor(() => expect(result.current.pending).toBe(true));
    const queued = JSON.stringify({ repoId: "424242", prNumber: 7 });
    answer(new Response(queued));
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it("announces the arrival of the brief it asked for", async () => {
    answerWith(202, { repoId: "424242", prNumber: 7 });
    const { result, rerender } = renderPaste(makePastedMeta());
    act(() => result.current.trigger?.());
    await waitFor(() =>
      expect(result.current.announcement).toBe(queuedAnnouncement),
    );

    rerender(makePastedMeta({ behind: false }));

    await waitFor(() =>
      expect(result.current.announcement).toBe(arrivedAnnouncement),
    );
  });

  it("stays quiet when the brief arrives unasked", async () => {
    const { rerender, announcements } = renderPaste(makePastedMeta());

    rerender(makePastedMeta({ behind: false }));

    await settlePoll();
    expect(countAnnouncements(announcements, arrivedAnnouncement)).toBe(0);
  });

  it("shows and announces the curated refusal", async () => {
    answerWith(401, { code: "unauthorized" });
    const { result, invalidate } = renderPaste(makePastedMeta());

    act(() => result.current.trigger?.());

    await waitFor(() => expect(result.current.failure).toContain("Sign in"));
    await waitFor(() =>
      expect(result.current.announcement).toContain("Sign in"),
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("offers an installation row no paste", () => {
    const { result } = renderPaste(makePastedMeta({ appInstalled: true }));

    expect(result.current.trigger).toBeUndefined();
  });

  it("offers no paste while the repository name is unknown", () => {
    const slugless = omitFields(makePastedMeta(), "repoSlug");
    const { result } = renderPaste(slugless);

    expect(result.current.trigger).toBeUndefined();
  });
});

/** A url row whose head is briefed only on the base the PR left. */
function makeRetargetedUrlMeta(status: GenerationStatus): PrSummary {
  return makeUrlMeta({
    baseSha: "base-1",
    behind: false,
    briefAvailable: false,
    headBriefStored: true,
    ...makeGenerationFields({ status }),
  });
}

describe("usePasteRegenerate across a run", () => {
  it("announces a new-base paste's brief while behind stays false", async () => {
    answerWith(202, { repoId: "424242", prNumber: 7 });
    const view = renderPaste(makeRetargetedUrlMeta("failed"));

    act(() => view.result.current.trigger?.());
    await waitFor(() =>
      expect(view.result.current.announcement).toBe(queuedAnnouncement),
    );
    for (const polled of ["pending", "running"] as const) {
      const meta = makeRetargetedUrlMeta(polled);
      view.rerender(meta);
      await settlePoll();
      const chip = deriveNewerCommitsStatus(t, {
        meta,
        staleHead: false,
        latestRun: { pending: false, trigger: vi.fn() },
        pasteRun: view.result.current,
      });
      expect(chip).toBeUndefined();
    }
    expect(countAnnouncements(view.announcements, arrivedAnnouncement)).toBe(0);

    const briefed = makeUrlMeta({
      baseSha: "base-2",
      behind: false,
      briefAvailable: true,
      headBriefStored: true,
      ...makeGenerationFields({ status: "succeeded" }),
    });
    view.rerender(briefed);
    await waitFor(() =>
      expect(view.result.current.announcement).toBe(arrivedAnnouncement),
    );
    view.rerender({ ...briefed });
    await settlePoll();

    expect(countAnnouncements(view.announcements, arrivedAnnouncement)).toBe(1);
  });

  it("announces a new-head paste's brief once, not while it runs", async () => {
    answerWith(202, { repoId: "424242", prNumber: 7 });
    const view = renderPaste(makePastedMeta());

    act(() => view.result.current.trigger?.());
    await waitFor(() =>
      expect(view.result.current.announcement).toBe(queuedAnnouncement),
    );
    const generating = makePastedMeta({
      headSha: "head-3",
      briefAvailable: false,
      headBriefStored: false,
      ...makeGenerationFields({ status: "pending" }),
    });
    view.rerender(generating);
    await settlePoll();
    const chip = deriveNewerCommitsStatus(t, {
      meta: generating,
      staleHead: true,
      latestRun: { pending: false, trigger: vi.fn() },
      pasteRun: view.result.current,
    });
    expect(chip?.state).toBe(NewerCommitsStates.GENERATING);
    expect(countAnnouncements(view.announcements, arrivedAnnouncement)).toBe(0);

    view.rerender(
      makePastedMeta({
        headSha: "head-3",
        behind: false,
        ...makeGenerationFields({ status: "succeeded" }),
      }),
    );
    await settlePoll();

    expect(countAnnouncements(view.announcements, arrivedAnnouncement)).toBe(1);
  });
});
