import { describe, expect, it } from "vitest";

import { getRouter } from "./router";

describe("getRouter", () => {
  it("turns query retries off for every read", () => {
    const { queryClient } = getRouter().options.context;

    expect(queryClient.getDefaultOptions().queries?.retry).toBe(false);
  });
});
