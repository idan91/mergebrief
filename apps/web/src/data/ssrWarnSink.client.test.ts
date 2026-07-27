// @vitest-environment jsdom
// The browser half of `getSsrWarnSink`: silent, and — just as important — it
// must never reach for the `server-only` logger module. The jsdom pragma is
// load-bearing: it is what makes the plugin resolve the CLIENT branch here.
// This test guards the runtime contract; the bundler contract (no server-only
// edge in the client graph at all) is guarded by `pnpm -C apps/web build`.
import { describe, expect, it } from "vitest";

import { getSsrWarnSink } from "./ssrWarnSink";

describe("getSsrWarnSink — client", () => {
  it("resolves undefined in the browser, leaving parsers silent", async () => {
    expect(typeof window).toBe("object");
    await expect(getSsrWarnSink()).resolves.toBeUndefined();
  });
});
