// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { InboxSorts } from "types/inbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  archivePull,
  buildInboxQueryOptions,
  cancelInboxReadWhenSuperseded,
  deleteOwnPull,
  deletePull,
  purgeAttachments,
  unarchivePull,
} from "./queries";
import { wireInboxPageFixture as WIRE_PAGE } from "./test-utils";
import { InboxStates } from "./types";

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });
});

afterEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function answerWith(status: number, body: unknown): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function answerEmpty(): void {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
}

function readCall(): { url: unknown; method: string | undefined } {
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  return { url, method: init?.method };
}

function readInbox(params = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return client.fetchQuery(buildInboxQueryOptions(params));
}

describe("buildInboxQueryOptions", () => {
  it("reads and parses one page from the Inbox route", async () => {
    answerWith(200, WIRE_PAGE);

    const state = await readInbox({ sort: InboxSorts.GENERATED, page: 2 });

    expect(state.kind).toBe(InboxStates.READY);
    if (state.kind !== InboxStates.READY) {
      return;
    }
    expect(state.page.items[0]?.stack).toEqual({ index: 2, size: 4 });
    expect(state.page.counts.new).toBe(1);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(
      /\/api\/inbox\?page=2&sort=generated$/,
    );
  });

  it("a 401 is the signed-out state", async () => {
    answerWith(401, { error: "refused", code: "unauthorized" });

    await expect(readInbox()).resolves.toEqual({
      kind: InboxStates.SIGNED_OUT,
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("a malformed page throws typed, never renders", async () => {
    answerWith(200, { ...WIRE_PAGE, counts: { new: "one" } });

    await expect(readInbox()).rejects.toMatchObject({ code: "malformed" });
  });

  it("a refusal is the failed state carrying its wire code", async () => {
    answerWith(502, { error: "refused", code: "github-unavailable" });

    await expect(readInbox()).resolves.toEqual({
      kind: InboxStates.FAILED,
      code: "github-unavailable",
    });
  });

  it("a codeless 5xx is the server's failure, never GitHub's", async () => {
    fetchMock.mockResolvedValue(
      new Response("service unavailable", { status: 503 }),
    );
    await expect(readInbox()).resolves.toEqual({
      kind: InboxStates.FAILED,
      code: "internal-error",
    });

    answerWith(504, { error: "service unavailable" });
    await expect(readInbox()).resolves.toEqual({
      kind: InboxStates.FAILED,
      code: "internal-error",
    });
  });

  it("a failed answer is stale at once, so a focus re-reads it", async () => {
    answerWith(503, { code: "internal-error" });
    const options = buildInboxQueryOptions({});
    const staleTime = options.staleTime;
    if (typeof staleTime !== "function") {
      throw new Error("staleTime is fixed");
    }
    const query = { state: { data: await readInbox() } };

    expect(staleTime(query as never)).toBe(0);
  });
});

describe("the inbox list poll", () => {
  const options = buildInboxQueryOptions({});
  const MALFORMED_PAGE = { ...WIRE_PAGE, counts: { new: "one" } };

  function makeClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
  }

  async function fetchFresh(client: QueryClient): Promise<void> {
    await client.fetchQuery({ ...options, staleTime: 0 }).catch(() => {});
  }

  function readPollMs(client: QueryClient): number | false | undefined {
    const query = client.getQueryCache().find({ queryKey: options.queryKey });
    const interval = options.refetchInterval;
    if (typeof interval !== "function" || query === undefined) {
      throw new Error("the list has no poll pace to read");
    }
    return interval(query as never);
  }

  it("polls a ready list every thirty seconds", async () => {
    const client = makeClient();
    answerWith(200, WIRE_PAGE);
    await fetchFresh(client);

    expect(readPollMs(client)).toBe(30_000);
  });

  it("stops polling a signed-out list", async () => {
    const client = makeClient();
    answerWith(401, { code: "unauthorized" });
    await fetchFresh(client);

    expect(readPollMs(client)).toBe(false);
  });

  it("stops polling a failed list", async () => {
    const client = makeClient();
    answerWith(503, { code: "internal-error" });
    await fetchFresh(client);

    expect(readPollMs(client)).toBe(false);
  });

  it("keeps a ready page when a re-read over it fails", async () => {
    const client = makeClient();
    answerWith(200, WIRE_PAGE);
    await fetchFresh(client);
    answerWith(503, { code: "internal-error" });
    await fetchFresh(client);

    const state = client.getQueryState(options.queryKey);
    expect(state?.data?.kind).toBe(InboxStates.READY);
    expect(state?.error).toMatchObject({ code: "internal-error" });
    expect(readPollMs(client)).toBe(false);
  });

  it("stops polling once a re-read throws over a ready page", async () => {
    const client = makeClient();
    answerWith(200, WIRE_PAGE);
    await fetchFresh(client);
    answerWith(200, MALFORMED_PAGE);
    await fetchFresh(client);

    expect(readPollMs(client)).toBe(false);
  });
});

describe("deleteOwnPull", () => {
  it("DELETEs the inbox path and reads a 204 as deleted", async () => {
    answerEmpty();

    expect(await deleteOwnPull("424242", 7)).toEqual({ kind: "deleted" });
    const { url, method } = readCall();
    expect(url).toMatch(/\/api\/inbox\/424242\/7$/);
    expect(method).toBe("DELETE");
  });

  it("maps a 404 to not-found and a refusal to forbidden", async () => {
    answerWith(404, { error: "x", code: "not-found" });
    expect(await deleteOwnPull("424242", 7)).toEqual({ kind: "not-found" });
    answerWith(403, { error: "x", code: "human-only" });
    expect(await deleteOwnPull("424242", 7)).toEqual({ kind: "forbidden" });
  });

  it("a 401 stays on the page as the unauthorized kind", async () => {
    answerWith(401, { error: "x", code: "unauthorized" });

    expect(await deleteOwnPull("424242", 7)).toEqual({
      kind: "unauthorized",
    });
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("deletePull", () => {
  it("calls the gated delete and reads a 204 as the row gone", async () => {
    answerEmpty();

    const result = await deletePull("424242", 7);

    const { url, method } = readCall();
    expect(url).toMatch(/\/api\/repos\/424242\/pulls\/7$/);
    expect(method).toBe("DELETE");
    expect(result).toEqual({ kind: "deleted" });
  });

  it("a repo-admin-only refusal is the forbidden kind", async () => {
    answerWith(403, { error: "x", code: "repo-admin-only" });
    expect(await deletePull("424242", 7)).toEqual({ kind: "forbidden" });
  });

  it("a codeless 5xx is the failed kind", async () => {
    answerWith(502, {});
    expect(await deletePull("424242", 7)).toEqual({ kind: "failed" });
  });

  it("a 401 sends the viewer to sign in", async () => {
    answerWith(401, { error: "x", code: "unauthorized" });

    expect(await deletePull("424242", 7)).toEqual({ kind: "unauthorized" });
    expect(assign).toHaveBeenCalledWith("/api/auth/github");
  });
});

describe("purgeAttachments", () => {
  it("DELETEs the repository's attachments and reads a 204 as purged", async () => {
    answerEmpty();

    const result = await purgeAttachments("424242");

    const { url, method } = readCall();
    expect(url).toMatch(/\/api\/repos\/424242\/attachments$/);
    expect(method).toBe("DELETE");
    expect(result).toEqual({ kind: "purged" });
  });

  it.each([
    ["repo-admin-only", 403, "forbidden"],
    ["not-found", 404, "not-found"],
    ["github-unavailable", 502, "failed"],
  ])("maps %s to the %s kind", async (code, status, kind) => {
    answerWith(status, { error: "x", code });
    expect(await purgeAttachments("424242")).toEqual({ kind });
  });

  it("a 401 sends the viewer to sign in", async () => {
    answerWith(401, { error: "x", code: "unauthorized" });

    expect(await purgeAttachments("424242")).toEqual({ kind: "unauthorized" });
    expect(assign).toHaveBeenCalledWith("/api/auth/github");
  });
});

describe("archivePull and unarchivePull", () => {
  it("archives through POST on the row's archive path", async () => {
    answerEmpty();

    const result = await archivePull("424242", 7);

    const { url, method } = readCall();
    expect(url).toMatch(/\/api\/repos\/424242\/pulls\/7\/archive$/);
    expect(method).toBe("POST");
    expect(result).toEqual({ kind: "archived" });
  });

  it("unarchives through POST on the row's unarchive path", async () => {
    answerEmpty();

    const result = await unarchivePull("424242", 7);

    const { url, method } = readCall();
    expect(url).toMatch(/\/api\/repos\/424242\/pulls\/7\/unarchive$/);
    expect(method).toBe("POST");
    expect(result).toEqual({ kind: "unarchived" });
  });

  it("a 404 is not-found and anything else failed", async () => {
    answerWith(404, { error: "x", code: "not-found" });
    expect(await archivePull("424242", 7)).toEqual({ kind: "not-found" });
    answerWith(502, {});
    expect(await unarchivePull("424242", 7)).toEqual({ kind: "failed" });
  });

  it("a refusal folds into the failed kind", async () => {
    answerWith(403, { error: "x", code: "scope-exceeded" });
    expect(await archivePull("424242", 7)).toEqual({ kind: "failed" });
  });

  it("a 401 sends the viewer to sign in", async () => {
    answerWith(401, { error: "x", code: "unauthorized" });

    expect(await unarchivePull("424242", 7)).toEqual({ kind: "unauthorized" });
    expect(assign).toHaveBeenCalledWith("/api/auth/github");
  });
});

describe("cancelInboxReadWhenSuperseded", () => {
  function hangFetchUntilAborted(): void {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
  }

  it("aborts the request once a newer navigation supersedes it", async () => {
    hangFetchUntilAborted();
    const client = new QueryClient();
    const params = { q: "anc" };
    const superseded = new AbortController();
    const read = client.fetchQuery(buildInboxQueryOptions(params));
    const outcome = read.then(
      () => "settled",
      () => "cancelled",
    );
    cancelInboxReadWhenSuperseded(client, params, read, superseded.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    superseded.abort();

    expect(await outcome).toBe("cancelled");
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("leaves a read that already settled alone", async () => {
    answerWith(200, WIRE_PAGE);
    const client = new QueryClient();
    const params = { q: "anc" };
    const superseded = new AbortController();
    const read = client.fetchQuery(buildInboxQueryOptions(params));
    cancelInboxReadWhenSuperseded(client, params, read, superseded.signal);
    await read;
    const cancelQueries = vi.spyOn(client, "cancelQueries");

    superseded.abort();

    expect(cancelQueries).not.toHaveBeenCalled();
  });
});
