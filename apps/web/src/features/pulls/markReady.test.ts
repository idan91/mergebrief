// Mark-ready mutation behavior (BRIEF-43 PR 3): expected failure statuses map
// to typed result kinds the own-draft flow renders as toast copy; only a
// malformed 2xx throws (contract violation). The route has NO deterministic
// 400 reachable from a valid UI state (400 = malformed prNumber only), so
// there is no recoverable-copy mirror to keep in lockstep here — a 400 is
// collapsed into the generic upstream kind.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../data/apiFetch";

vi.mock("../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from "../../data/apiFetch";
import {
  createMarkReadyAction,
  markPrReady,
  type MarkReadyResult,
} from "./markReady";

const apiFetchMock = vi.mocked(apiFetch);

function run(): ReturnType<typeof markPrReady> {
  return markPrReady("424242", 7);
}

describe("markPrReady", () => {
  it("POSTs to the ready route and parses the 200 (fresh flip or converged — indistinguishable)", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draft: false }), { status: 200 }),
    );
    await expect(run()).resolves.toEqual({ kind: "ready" });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/424242/pulls/7/ready",
      {
        method: "POST",
      },
    );
  });

  it("maps a 401 to the re-login kind", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    await expect(run()).resolves.toEqual({ kind: "unauthorized" });
  });

  it("maps a 404 to the not-found kind", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    await expect(run()).resolves.toEqual({ kind: "not-found" });
  });

  it("maps 502 (and the UI-unreachable 400) to the upstream kind", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "upstream error" }), {
        status: 502,
      }),
    );
    await expect(run()).resolves.toEqual({ kind: "upstream" });
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid request" }), {
        status: 400,
      }),
    );
    await expect(run()).resolves.toEqual({ kind: "upstream" });
  });

  it("throws a typed malformed error on a 200 whose body is not { draft: false }", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draft: true }), { status: 200 }),
    );
    await expect(run()).rejects.toBeInstanceOf(ApiError);
    apiFetchMock.mockResolvedValue(new Response("not-json", { status: 200 }));
    await expect(run()).rejects.toBeInstanceOf(ApiError);
  });
});

// The route-injected action (BRIEF-43 review round 1): pins the ORDERING
// contract the no-flicker rule depends on — a success resolves only AFTER
// the pr-meta invalidation settles (pending holds until the refreshed PrView
// landed), and failure kinds never touch the cache.
async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential flush is the point
    await Promise.resolve();
  }
}

describe("createMarkReadyAction", () => {
  it("success: invalidates the pr-meta key and resolves only after the invalidation settles", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invalidateQueries = vi.fn(async (_filters: { queryKey: unknown }) => {
      order.push("invalidate-start");
      await gate;
      order.push("invalidate-settled");
    });
    const action = createMarkReadyAction(
      { invalidateQueries },
      "424242",
      7,
      () => Promise.resolve<MarkReadyResult>({ kind: "ready" }),
    );

    let resolved = false;
    const pending = action().then((result) => {
      order.push("action-resolved");
      resolved = true;
      return result;
    });
    await flushMicrotasks();
    // The invalidation targets exactly the pr-meta descriptor's key…
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["pr-meta", "424242", 7],
    });
    // …and the action is STILL pending while the refetch is in flight.
    expect(resolved).toBe(false);

    release();
    await expect(pending).resolves.toEqual({ kind: "ready" });
    expect(order).toEqual([
      "invalidate-start",
      "invalidate-settled",
      "action-resolved",
    ]);
  });

  it("failure kinds resolve without invalidating anything (stay in-state)", async () => {
    for (const kind of ["unauthorized", "not-found", "upstream"] as const) {
      const invalidateQueries = vi.fn(() => Promise.resolve());
      const action = createMarkReadyAction(
        { invalidateQueries },
        "424242",
        7,
        () => Promise.resolve<MarkReadyResult>({ kind }),
      );
      // eslint-disable-next-line no-await-in-loop -- three sequential cases
      await expect(action()).resolves.toEqual({ kind });
      expect(invalidateQueries).not.toHaveBeenCalled();
    }
  });
});
