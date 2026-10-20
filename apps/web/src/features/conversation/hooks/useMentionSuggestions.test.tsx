// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MentionCandidateKinds,
  type MentionUserCandidate,
} from "@web/components/MarkdownTextarea/types";
import type { MentionSource } from "../types";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../data/apiFetch";
import { useMentionSuggestions } from "./useMentionSuggestions";

const apiFetchMock = vi.mocked(apiFetch);

const DEBOUNCE_MS = 200;
const QUERY_LENGTH_BOUND = 140;

function makeUser(login: string, name?: string): MentionUserCandidate {
  if (name === undefined) {
    return { kind: MentionCandidateKinds.USER, login };
  }
  return { kind: MentionCandidateKinds.USER, login, name };
}

const PARTICIPANTS = [makeUser("alice"), makeUser("bob")];
const REMOTE_SOURCE: MentionSource = {
  repoId: "42",
  participants: PARTICIPANTS,
};

function stubAnswer(users: readonly { login: string; name?: string }[]) {
  const body = JSON.stringify({ users, teams: [] });
  const answer = new Response(body, { status: 200 });
  return answer;
}

export interface WrapperProps {
  children: ReactNode;
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: WrapperProps) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function renderSuggestions(source: MentionSource | undefined) {
  return renderHook(({ current }) => useMentionSuggestions(current), {
    wrapper: makeWrapper(),
    initialProps: { current: source },
  });
}

type Rendered = ReturnType<typeof renderSuggestions>;

function typeQuery(view: Rendered, query: string | undefined) {
  act(() => {
    view.result.current.onMentionQueryChange?.(query);
  });
}

const SETTLE_ROUNDS = 5;

/** Moves the clock, then lets the fetch and the query's notify batches land. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

function readLogins(view: Rendered): readonly string[] {
  const candidates = view.result.current.mentionSuggestions?.candidates ?? [];
  const logins = candidates.map((candidate) =>
    candidate.kind === MentionCandidateKinds.USER
      ? candidate.login
      : candidate.combinedSlug,
  );
  return logins;
}

describe("useMentionSuggestions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("offers no mention props without a source", () => {
    const view = renderSuggestions(undefined);

    expect(view.result.current).toEqual({
      mentionSuggestions: undefined,
      onMentionQueryChange: undefined,
    });
  });

  it("offers matching participants alone without a repo to search", async () => {
    const view = renderSuggestions({ participants: PARTICIPANTS });

    typeQuery(view, "a");
    await advance(DEBOUNCE_MS);

    expect(view.result.current.mentionSuggestions).toEqual({
      query: "a",
      candidates: [makeUser("alice")],
      pending: false,
    });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("settles a mixed-case query on its lowercased answer", async () => {
    apiFetchMock.mockResolvedValue(stubAnswer([{ login: "alan" }]));
    const view = renderSuggestions(REMOTE_SOURCE);

    typeQuery(view, "Al");
    await advance(DEBOUNCE_MS);

    expect(view.result.current.mentionSuggestions?.query).toBe("Al");
    expect(view.result.current.mentionSuggestions?.pending).toBe(false);
    expect(readLogins(view)).toContain("alan");
  });

  it("settles a mixed-case query when the search fails", async () => {
    apiFetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const view = renderSuggestions(REMOTE_SOURCE);

    typeQuery(view, "Al");
    await advance(DEBOUNCE_MS);

    expect(view.result.current.mentionSuggestions?.pending).toBe(false);
  });

  it("searches once the query holds still for the debounce", async () => {
    apiFetchMock.mockResolvedValue(stubAnswer([{ login: "alan" }]));
    const view = renderSuggestions(REMOTE_SOURCE);

    typeQuery(view, "a");
    await advance(DEBOUNCE_MS - 1);
    typeQuery(view, "al");
    await advance(DEBOUNCE_MS - 1);
    expect(apiFetchMock).not.toHaveBeenCalled();

    await advance(1);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/42/mention-suggestions?q=al",
      { method: "GET" },
    );
  });

  it("stays pending from a query change until its own answer lands", async () => {
    apiFetchMock.mockResolvedValue(stubAnswer([{ login: "alan" }]));
    const view = renderSuggestions(REMOTE_SOURCE);

    typeQuery(view, "al");
    expect(view.result.current.mentionSuggestions?.pending).toBe(true);

    await advance(DEBOUNCE_MS);
    expect(view.result.current.mentionSuggestions).toEqual({
      query: "al",
      candidates: [makeUser("alice"), makeUser("alan")],
      pending: false,
    });
  });

  it("narrows the previous answer while the next one loads", async () => {
    apiFetchMock.mockResolvedValueOnce(
      stubAnswer([{ login: "alan" }, { login: "smith", name: "Alicia Smith" }]),
    );
    const view = renderSuggestions(REMOTE_SOURCE);
    typeQuery(view, "al");
    await advance(DEBOUNCE_MS);

    apiFetchMock.mockReturnValueOnce(new Promise(() => {}));
    typeQuery(view, "ali");
    await advance(DEBOUNCE_MS);

    expect(view.result.current.mentionSuggestions?.pending).toBe(true);
    expect(readLogins(view)).toEqual(["alice", "smith"]);
  });

  it("never searches a query past the length bound", async () => {
    const view = renderSuggestions(REMOTE_SOURCE);

    typeQuery(view, "a".repeat(QUERY_LENGTH_BOUND + 1));
    await advance(DEBOUNCE_MS);

    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(view.result.current.mentionSuggestions?.pending).toBe(false);
  });

  it("falls back to participants when the search is unavailable", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    const view = renderSuggestions(REMOTE_SOURCE);

    typeQuery(view, "");
    await advance(DEBOUNCE_MS);

    expect(view.result.current.mentionSuggestions).toEqual({
      query: "",
      candidates: PARTICIPANTS,
      pending: false,
    });
  });

  it("stops waiting when the search fails outright", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    const view = renderSuggestions(REMOTE_SOURCE);

    typeQuery(view, "b");
    await advance(DEBOUNCE_MS);

    expect(view.result.current.mentionSuggestions).toEqual({
      query: "b",
      candidates: [makeUser("bob")],
      pending: false,
    });
  });

  it("keeps one answer object while its inputs hold", async () => {
    apiFetchMock.mockResolvedValue(stubAnswer([]));
    const view = renderSuggestions(REMOTE_SOURCE);
    typeQuery(view, "a");
    await advance(DEBOUNCE_MS);
    const before = view.result.current.mentionSuggestions;

    view.rerender({ current: REMOTE_SOURCE });

    expect(view.result.current.mentionSuggestions).toBe(before);
  });
});
