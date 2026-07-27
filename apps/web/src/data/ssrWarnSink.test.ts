// `getSsrWarnSink` is a `createIsomorphicFn` (REQUIRED — see the module
// comment: import-protection denies the server-only edge in the client graph
// statically). vitest shares the app's vite config, so the plugin picks the
// branch per test ENVIRONMENT: this file is the default node env and gets the
// server branch; `ssrWarnSink.client.test.ts` carries the jsdom pragma and
// gets the client one.
import { describe, expect, it } from "vitest";

import { getSsrWarnSink } from "./ssrWarnSink";

describe("getSsrWarnSink — server", () => {
  it("resolves the process logger when there is no window (SSR/loader)", async () => {
    expect(typeof window).toBe("undefined");
    const sink = await getSsrWarnSink();
    expect(sink).toBeDefined();
    expect(typeof sink?.warn).toBe("function");
  });

  it("returns the SAME logger across calls (the process has one)", async () => {
    expect(await getSsrWarnSink()).toBe(await getSsrWarnSink());
  });
});
