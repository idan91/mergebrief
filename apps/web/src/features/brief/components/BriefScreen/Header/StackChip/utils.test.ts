import { describe, expect, it } from "vitest";

import { isLinearPrStack, rewritePullUrl } from "./utils";

describe("rewritePullUrl", () => {
  it("replaces the pull number and keeps the rest of the URL", () => {
    expect(rewritePullUrl("https://github.com/acme/widgets/pull/7", 12)).toBe(
      "https://github.com/acme/widgets/pull/12",
    );
  });

  it("returns undefined when the URL has no pull number", () => {
    expect(rewritePullUrl("https://github.com/acme/widgets", 12)).toBe(
      undefined,
    );
  });
});

describe("isLinearPrStack", () => {
  it("is true only for a members-and-index stack", () => {
    expect(
      isLinearPrStack({
        members: [
          { number: 1, title: "a" },
          { number: 2, title: "b" },
        ],
        index: 1,
      }),
    ).toBe(true);
    expect(
      isLinearPrStack({
        children: [
          { number: 3, title: "c" },
          { number: 4, title: "d" },
        ],
      }),
    ).toBe(false);
  });
});
