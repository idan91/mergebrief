// `getSsrWarnSink` is a `createIsomorphicFn`, required because import
// protection denies the server-only edge in the client graph statically.
// vitest shares the app's vite config, so the plugin picks the branch per test
// ENVIRONMENT: this file is the default node env and gets the server branch;
// `ssrWarnSink.client.test.ts` carries the jsdom pragma and gets the client one.
import { createServerEntry } from "@tanstack/react-start/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getServerLogger } from "../server/logger";
import { stampRequestId } from "../server/request-id";
import { getSsrWarnSink } from "./ssrWarnSink";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getSsrWarnSink on the server", () => {
  it("resolves the process logger outside a render", async () => {
    expect(typeof window).toBe("undefined");
    const sink = await getSsrWarnSink();
    expect(sink).toBeDefined();
    expect(typeof sink?.warn).toBe("function");
  });

  it("returns the same process logger across calls", async () => {
    expect(await getSsrWarnSink()).toBe(await getSsrWarnSink());
  });

  it("binds the rendered request's id as reqId", async () => {
    const child = vi.spyOn(getServerLogger(), "child");
    const { fetch: render } = createServerEntry({
      fetch: async () => {
        await getSsrWarnSink();
        return new Response(null);
      },
    });

    const inbound = new Request("http://localhost/");
    await render(stampRequestId(inbound, "minted-id"), {});

    expect(child).toHaveBeenCalledWith({ reqId: "minted-id" });
  });
});
