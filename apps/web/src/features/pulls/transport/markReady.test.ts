// Mark-ready mutation behavior: every failure maps to a typed result kind the
// own-draft flow renders as toast copy. The route has NO deterministic 400
// reachable from a valid UI state (400 = malformed prNumber only), so there is
// no recoverable-copy mirror to keep in lockstep; a 400 collapses into
// upstream. The request's own fetch boundary is mocked, so the kind table is
// exercised end to end over realistic wire bodies.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../data/apiFetch";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../data/apiFetch";
import { createMarkReadyAction, markPrReady } from "./markReady";
import type { MarkReadyResult } from "@web/features/brief/model";

const apiFetchMock = vi.mocked(apiFetch);

function run(): ReturnType<typeof markPrReady> {
  return markPrReady("424242", 7);
}

describe("markPrReady", () => {
  it("posts to the ready route and reads its 204 as ready", async () => {
    apiFetchMock.mockResolvedValue(new Response(null, { status: 204 }));
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

  it("maps a 403 for missing contents write to github-permission", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "github-permission" }), {
        status: 403,
      }),
    );
    await expect(run()).resolves.toEqual({ kind: "github-permission" });
  });

  it("maps the wire github-permission code to the same kind", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "github-permission",
          code: "github-permission",
        }),
        { status: 403 },
      ),
    );
    await expect(run()).resolves.toEqual({ kind: "github-permission" });
  });

  it("maps a thrown fetch to the indeterminate kind", async () => {
    apiFetchMock.mockRejectedValue(new TypeError("network down"));
    await expect(run()).resolves.toEqual({ kind: "indeterminate" });
  });

  it("maps the proxy's 504 to the indeterminate kind", async () => {
    apiFetchMock.mockResolvedValue(new Response("<html>", { status: 504 }));
    await expect(run()).resolves.toEqual({ kind: "indeterminate" });
  });

  it("maps a 502 and the unreachable 400 to the upstream kind", async () => {
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

  it("maps every previously-swallowed coded failure deliberately", async () => {
    for (const [code, kind] of [
      ["forbidden", "github-permission"],
      ["invalid-request", "upstream"],
      ["scope-exceeded", "upstream"],
      ["human-only", "upstream"],
      ["github-unavailable", "upstream"],
      ["internal-error", "upstream"],
    ] as const) {
      apiFetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: "refused", code }), {
          status: 502,
        }),
      );
      await expect(run()).resolves.toEqual({ kind });
    }
  });

  it("maps an unreadable 2xx body to the indeterminate kind", async () => {
    apiFetchMock.mockResolvedValue(new Response("not-json", { status: 200 }));
    await expect(run()).resolves.toEqual({ kind: "indeterminate" });
  });
});

// The route-injected action pins the ORDERING contract the no-flicker rule
// depends on: a success resolves only AFTER the pr-meta invalidation settles,
// and failure kinds never touch the cache.
async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe("createMarkReadyAction", () => {
  it("resolves success only after the pr-meta invalidation settles", async () => {
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

  it("resolves failure kinds without invalidating anything", async () => {
    for (const kind of [
      "unauthorized",
      "not-found",
      "github-permission",
      "upstream",
      "indeterminate",
    ] as const) {
      const invalidateQueries = vi.fn(() => Promise.resolve());
      const action = createMarkReadyAction(
        { invalidateQueries },
        "424242",
        7,
        () => Promise.resolve<MarkReadyResult>({ kind }),
      );
      await expect(action()).resolves.toEqual({ kind });
      expect(invalidateQueries).not.toHaveBeenCalled();
    }
  });
});
