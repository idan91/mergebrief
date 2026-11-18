import { afterEach, describe, expect, it, vi } from "vitest";
import { makeHangingFetch } from "../../../../../../test/hanging-fetch";
import { fetchWithHeadersDeadline } from "./fetch-upstream";

const DEADLINE_MS = 15_000;
const URL_TEXT = "https://private-user-images.githubusercontent.com/1/2-a.mp4";

describe("fetchWithHeadersDeadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the request when headers take past the deadline", async () => {
    vi.useFakeTimers();
    const upstream = makeHangingFetch();

    const pending = fetchWithHeadersDeadline(upstream.fetchImpl, URL_TEXT, {
      init: { method: "GET" },
      signal: new AbortController().signal,
      timeoutMs: DEADLINE_MS,
    });
    const outcome = pending.then(
      () => "answered",
      () => "aborted",
    );
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);

    expect(await outcome).toBe("aborted");
    expect(upstream.readSignal()?.aborted).toBe(true);
  });

  it("cancels the request when the client disconnects", async () => {
    const upstream = makeHangingFetch();
    const client = new AbortController();

    const pending = fetchWithHeadersDeadline(upstream.fetchImpl, URL_TEXT, {
      init: { method: "GET" },
      signal: client.signal,
      timeoutMs: DEADLINE_MS,
    });
    client.abort();

    await expect(pending).rejects.toBeDefined();
    expect(upstream.readSignal()?.aborted).toBe(true);
  });

  it("stops the deadline once headers arrive so the body keeps streaming", async () => {
    vi.useFakeTimers();
    const upstream = makeHangingFetch();
    const client = new AbortController();

    const pending = fetchWithHeadersDeadline(upstream.fetchImpl, URL_TEXT, {
      init: { method: "GET" },
      signal: client.signal,
      timeoutMs: DEADLINE_MS,
    });
    upstream.answer(new Response("bytes"));
    await pending;
    await vi.advanceTimersByTimeAsync(DEADLINE_MS * 2);

    expect(upstream.readSignal()?.aborted).toBe(false);
    client.abort();
    expect(upstream.readSignal()?.aborted).toBe(true);
  });
});
