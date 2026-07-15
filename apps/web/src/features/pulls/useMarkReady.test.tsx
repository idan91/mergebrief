// @vitest-environment jsdom
// The mark-ready facade hook (BRIEF-43 PR 3): owns pending/copy state for the
// own-draft terminal action. Success stays QUIET about state — the own-draft
// affordances vanish only when the refreshed PrView lands (the injected
// action awaits the pr-view invalidation); the hook never clears anything
// optimistically. Failures re-enable the CTA and announce toast copy.
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MarkReadyResult } from "./markReady";
import { MARK_READY_COPY, useMarkReady } from "./useMarkReady";

afterEach(cleanup);

interface Deferred {
  resolve: (result: MarkReadyResult) => void;
  reject: (error: unknown) => void;
  promise: Promise<MarkReadyResult>;
}

function deferred(): Deferred {
  let resolve!: (result: MarkReadyResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<MarkReadyResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

describe("useMarkReady", () => {
  it("is a no-op without an action (not own-draft / local path)", () => {
    const announce = vi.fn();
    const { result } = renderHook(() =>
      useMarkReady({ action: undefined, announce }),
    );
    act(() => result.current.markReady());
    expect(result.current.pending).toBe(false);
    expect(announce).toHaveBeenCalledTimes(0);
  });

  it("runs the action, holds pending until it settles, and announces success", async () => {
    const gate = deferred();
    const action = vi.fn(() => gate.promise);
    const announce = vi.fn();
    const { result } = renderHook(() => useMarkReady({ action, announce }));

    act(() => result.current.markReady());
    expect(result.current.pending).toBe(true);
    // A second click while in flight must not double-POST.
    act(() => result.current.markReady());
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve({ kind: "ready" });
      await gate.promise;
    });
    expect(result.current.pending).toBe(false);
    expect(announce).toHaveBeenCalledWith(MARK_READY_COPY.ready);
  });

  it("announces failure copy per kind and re-enables the CTA", async () => {
    for (const [kind, copy] of [
      ["unauthorized", MARK_READY_COPY.unauthorized],
      ["not-found", MARK_READY_COPY.notFound],
      ["upstream", MARK_READY_COPY.upstream],
    ] as const) {
      const announce = vi.fn();
      const action = vi.fn(() => Promise.resolve<MarkReadyResult>({ kind }));
      const { result, unmount } = renderHook(() =>
        useMarkReady({ action, announce }),
      );
      await act(async () => {
        result.current.markReady();
      });
      expect(result.current.pending).toBe(false);
      expect(announce).toHaveBeenCalledWith(copy);
      unmount();
    }
  });

  it("maps a thrown transport error to the retry-safe failure copy", async () => {
    const announce = vi.fn();
    const action = vi.fn(() => Promise.reject(new Error("network")));
    const { result } = renderHook(() => useMarkReady({ action, announce }));
    await act(async () => {
      result.current.markReady();
    });
    expect(result.current.pending).toBe(false);
    expect(announce).toHaveBeenCalledWith(MARK_READY_COPY.failed);
  });
});
