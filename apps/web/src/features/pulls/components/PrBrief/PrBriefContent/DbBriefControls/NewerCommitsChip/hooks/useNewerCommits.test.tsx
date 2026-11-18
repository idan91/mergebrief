// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationStatus } from "types";

import { I18nProvider } from "../../../../../../../../i18n/I18nProvider";
import type { PrSummary } from "../../../../../../types";
import { deriveBriefRouteState } from "../../../../../../utils/briefRouteState";
import {
  arrivedAnnouncement,
  countAnnouncements,
  makeGeneration,
  makeGenerationFields,
  makeMeta,
  queuedAnnouncement,
  settlePoll,
} from "../test-utils";
import { NewerCommitsStates } from "../types";
import { useNewerCommits } from "./useNewerCommits";

const fetchMock = vi.fn<typeof fetch>();
const AWAITING = makeGeneration({ status: "awaiting-trigger" });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </I18nProvider>
    );
  };
}

function renderNewerCommits(meta: PrSummary, staleHead = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const rendered = renderHook(
    () => useNewerCommits({ meta, repoId: "424242", prNumber: 7, staleHead }),
    { wrapper: makeWrapper(client) },
  );
  return { ...rendered, invalidate };
}

/** The hook over a meta the test swaps, as a poll would, keeping every region text it rendered. */
function renderOverMetas(first: PrSummary, staleHead = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const announcements: string[] = [];
  const view = renderHook(
    ({ meta }: { meta: PrSummary }) => {
      const chip = useNewerCommits({
        meta,
        repoId: "424242",
        prNumber: 7,
        staleHead,
      });
      announcements.push(chip.announcement);
      return chip;
    },
    { wrapper: makeWrapper(client), initialProps: { meta: first } },
  );
  return { ...view, announcements };
}

function readRequestUrl(): string {
  const [url] = fetchMock.mock.calls[0] ?? [];
  return typeof url === "string" ? url : "";
}

describe("useNewerCommits", () => {
  it("shows no chip while the brief on screen covers the head", () => {
    const meta = makeMeta({ briefAvailable: true, behind: false });
    const { result } = renderNewerCommits(meta, false);

    expect(result.current.status).toBeUndefined();
    expect(result.current.announcement).toBe("");
  });

  it("retries a failed latest push through the regenerate route", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const { result, invalidate } = renderNewerCommits(makeMeta());
    expect(result.current.status?.state).toBe(NewerCommitsStates.FAILED);

    act(() => result.current.status?.action?.onTrigger());

    await waitFor(() =>
      expect(result.current.announcement).toBe(queuedAnnouncement),
    );
    expect(readRequestUrl()).toContain("/api/repos/424242/pulls/7/regenerate");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["pr-meta", "424242", 7],
    });
  });

  it("generates an awaiting latest push and says it is queued", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const { result } = renderNewerCommits(makeMeta({ generation: AWAITING }));

    act(() => result.current.status?.action?.onTrigger());

    await waitFor(() =>
      expect(result.current.announcement).toBe(queuedAnnouncement),
    );
    expect(readRequestUrl()).toContain("/api/repos/424242/pulls/7/regenerate");
  });

  it("announces the route's refusal of a Generate in its own words", async () => {
    const refusal = JSON.stringify({
      error: "Not regenerable.",
      code: "generation-not-regenerable",
    });
    fetchMock.mockResolvedValue(
      new Response(refusal, {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    const { result } = renderNewerCommits(makeMeta({ generation: AWAITING }));

    act(() => result.current.status?.action?.onTrigger());

    await waitFor(() =>
      expect(result.current.announcement).toBe(
        "This brief no longer waits for a click.",
      ),
    );
  });

  it("switches the action label while the retry is in flight", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    const { result } = renderNewerCommits(makeMeta());

    act(() => result.current.status?.action?.onTrigger());

    await waitFor(() =>
      expect(result.current.status?.action?.label).toBe("Retrying…"),
    );
    expect(result.current.status?.action?.pending).toBe(true);
  });

  it("announces a url row's paste in the one region", async () => {
    const queued = JSON.stringify({ repoId: "424242", prNumber: 7 });
    fetchMock.mockResolvedValue(
      new Response(queued, {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    const meta = makeMeta({
      appInstalled: false,
      briefAvailable: true,
      generation: makeGeneration({ status: "succeeded" }),
    });
    const { result } = renderNewerCommits(meta, false);
    expect(result.current.status?.action?.label).toBe("Generate new brief");

    act(() => result.current.status?.action?.onTrigger());

    await waitFor(() =>
      expect(result.current.announcement).toBe(queuedAnnouncement),
    );
    expect(readRequestUrl()).not.toContain("/regenerate");
  });

  it("announces the brief a Retry asked for once it lands", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const view = renderOverMetas(makeMeta());

    act(() => view.result.current.status?.action?.onTrigger());
    await waitFor(() =>
      expect(view.result.current.announcement).toBe(queuedAnnouncement),
    );
    view.rerender({
      meta: makeMeta(makeGenerationFields({ status: "pending" })),
    });
    await settlePoll();
    expect(view.result.current.status?.state).toBe(
      NewerCommitsStates.GENERATING,
    );
    expect(countAnnouncements(view.announcements, arrivedAnnouncement)).toBe(0);
    const briefed = makeMeta({
      briefAvailable: true,
      headBriefStored: true,
      behind: false,
      generation: makeGeneration({ status: "succeeded" }),
    });
    view.rerender({ meta: briefed });

    await waitFor(() =>
      expect(view.result.current.announcement).toBe(arrivedAnnouncement),
    );
    view.rerender({ meta: { ...briefed } });
    await settlePoll();
    expect(countAnnouncements(view.announcements, arrivedAnnouncement)).toBe(1);
  });

  it("stays quiet over a brief no Retry here asked for", async () => {
    const view = renderOverMetas(makeMeta());
    const briefed = makeMeta({
      briefAvailable: true,
      headBriefStored: true,
      behind: false,
      generation: makeGeneration({ status: "succeeded" }),
    });

    view.rerender({ meta: briefed });

    await settlePoll();
    expect(countAnnouncements(view.announcements, arrivedAnnouncement)).toBe(0);
  });
});

/** The head is briefed only on the base the PR left; the meta's base is that brief's. */
function makeRetargetedMeta(status: GenerationStatus): PrSummary {
  return makeMeta({
    baseSha: "base-1",
    behind: false,
    briefAvailable: false,
    headBriefStored: true,
    ...makeGenerationFields({ status }),
  });
}

/** The same head's brief on the PR's new base has landed. */
const NEW_BASE_BRIEFED = makeMeta({
  baseSha: "base-2",
  behind: false,
  briefAvailable: true,
  headBriefStored: true,
  ...makeGenerationFields({ status: "succeeded" }),
});

describe("useNewerCommits on a base-only retarget", () => {
  it("announces no ready while a new-base Retry is pending", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const view = renderOverMetas(makeRetargetedMeta("failed"), false);

    act(() => view.result.current.status?.action?.onTrigger());
    await waitFor(() =>
      expect(view.result.current.announcement).toBe(queuedAnnouncement),
    );
    view.rerender({ meta: makeRetargetedMeta("pending") });
    await settlePoll();

    expect(view.result.current.announcement).not.toBe(arrivedAnnouncement);
  });

  it.each([
    ["Retry", "failed", NewerCommitsStates.FAILED],
    ["Generate", "awaiting-trigger", NewerCommitsStates.ON_DEMAND],
  ] as const)(
    "announces a new-base %s once, when its brief lands",
    async (_action, status, state) => {
      fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
      const view = renderOverMetas(makeRetargetedMeta(status), false);
      expect(view.result.current.status?.state).toBe(state);
      expect(view.result.current.status?.label).toBe("New base");

      act(() => view.result.current.status?.action?.onTrigger());
      await waitFor(() =>
        expect(view.result.current.announcement).toBe(queuedAnnouncement),
      );
      for (const polled of ["pending", "running"] as const) {
        const meta = makeRetargetedMeta(polled);
        view.rerender({ meta });
        await settlePoll();
        expect(view.result.current.status).toBeUndefined();
        expect(deriveBriefRouteState(meta, undefined).kind).toBe("render");
      }
      expect(countAnnouncements(view.announcements, arrivedAnnouncement)).toBe(
        0,
      );

      view.rerender({ meta: NEW_BASE_BRIEFED });
      await waitFor(() =>
        expect(view.result.current.announcement).toBe(arrivedAnnouncement),
      );
      view.rerender({ meta: { ...NEW_BASE_BRIEFED } });
      await settlePoll();

      expect(view.result.current.status).toBeUndefined();
      expect(countAnnouncements(view.announcements, arrivedAnnouncement)).toBe(
        1,
      );
    },
  );

  it("stays quiet when a newer push's brief lands after the Retry", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const view = renderOverMetas(makeRetargetedMeta("failed"), false);

    act(() => view.result.current.status?.action?.onTrigger());
    await waitFor(() =>
      expect(view.result.current.announcement).toBe(queuedAnnouncement),
    );
    view.rerender({ meta: { ...NEW_BASE_BRIEFED, headSha: "head-3" } });
    await settlePoll();

    expect(countAnnouncements(view.announcements, arrivedAnnouncement)).toBe(0);
  });

  it("stays quiet when the head moves before the Retry is answered", async () => {
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );
    const view = renderOverMetas(makeRetargetedMeta("failed"), false);

    act(() => view.result.current.status?.action?.onTrigger());
    view.rerender({
      meta: { ...makeRetargetedMeta("pending"), headSha: "head-3" },
    });
    await act(async () => {
      answer(new Response(null, { status: 202 }));
    });
    await waitFor(() =>
      expect(view.result.current.announcement).toBe(queuedAnnouncement),
    );
    view.rerender({ meta: { ...NEW_BASE_BRIEFED, headSha: "head-3" } });
    await settlePoll();

    expect(countAnnouncements(view.announcements, arrivedAnnouncement)).toBe(0);
  });
});
