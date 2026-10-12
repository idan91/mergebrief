import { QueryClient, hashKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { clearSignedInReads } from "./utils";

const VIEWER_KEY = ["viewer"];
const BRIEF_KEY = ["brief", "42"];
const SETTLE_WAIT_MS = 50;

function makeSettleableRead() {
  let settle: (value: string) => void = () => {};
  const pending = new Promise<string>((resolve) => {
    settle = resolve;
  });
  return { pending, settle: (value: string) => settle(value) };
}

describe("clearSignedInReads", () => {
  it("resets every idle read but the viewer's", () => {
    const client = new QueryClient();
    client.setQueryData(VIEWER_KEY, "signed-out");
    client.setQueryData(BRIEF_KEY, "brief");

    clearSignedInReads(client, hashKey(VIEWER_KEY));

    expect(client.getQueryData(BRIEF_KEY)).toBeUndefined();
    expect(client.getQueryData(VIEWER_KEY)).toBe("signed-out");
  });

  it("resets a read in flight only once it settles", async () => {
    const client = new QueryClient();
    const read = makeSettleableRead();
    const fetching = client.fetchQuery({
      queryKey: BRIEF_KEY,
      queryFn: () => read.pending,
    });

    clearSignedInReads(client, hashKey(VIEWER_KEY));
    read.settle("brief");

    await expect(fetching).resolves.toBe("brief");
    await expect
      .poll(() => client.getQueryData(BRIEF_KEY), { timeout: SETTLE_WAIT_MS })
      .toBeUndefined();
  });

  it("resets a read in flight that a cancel reverted", async () => {
    const client = new QueryClient();
    client.setQueryData(BRIEF_KEY, "signed-in brief");
    const read = makeSettleableRead();
    void client
      .fetchQuery({
        queryKey: BRIEF_KEY,
        queryFn: () => read.pending,
        staleTime: 0,
      })
      .catch(() => undefined);

    clearSignedInReads(client, hashKey(VIEWER_KEY));
    await client.cancelQueries({ queryKey: BRIEF_KEY });

    await expect
      .poll(() => client.getQueryData(BRIEF_KEY), { timeout: SETTLE_WAIT_MS })
      .toBeUndefined();
  });

  it("leaves a settling read alone once stopped", async () => {
    const client = new QueryClient();
    const read = makeSettleableRead();
    const fetching = client.fetchQuery({
      queryKey: BRIEF_KEY,
      queryFn: () => read.pending,
    });

    const stop = clearSignedInReads(client, hashKey(VIEWER_KEY));
    stop();
    read.settle("brief");

    await expect(fetching).resolves.toBe("brief");
    expect(client.getQueryData(BRIEF_KEY)).toBe("brief");
  });
});
