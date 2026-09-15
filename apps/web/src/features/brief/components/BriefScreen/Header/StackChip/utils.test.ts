import { describe, expect, it } from "vitest";

import {
  isLinearPrStack,
  isSameStack,
  resolveStackView,
  rewritePullUrl,
} from "./utils";

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

const chain = {
  members: [
    { number: 1, title: "a" },
    { number: 2, title: "b" },
  ],
  index: 1,
};
const fork = {
  parent: { number: 1, title: "a" },
  children: [
    { number: 3, title: "c" },
    { number: 4, title: "d" },
  ],
};

describe("isSameStack", () => {
  it("ignores titles and compares members by number and place", () => {
    const retitled = {
      members: [
        { number: 1, title: "renamed" },
        { number: 2, title: "b" },
      ],
      index: 1,
    };
    expect(isSameStack(chain, retitled)).toBe(true);
    expect(isSameStack(chain, { ...chain, index: 2 })).toBe(false);
    expect(
      isSameStack(chain, { ...chain, members: chain.members.toReversed() }),
    ).toBe(false);
  });

  it("tells a chain from a fork and compares fork parents", () => {
    expect(isSameStack(chain, fork)).toBe(false);
    expect(
      isSameStack(fork, { ...fork, parent: { number: 9, title: "z" } }),
    ).toBe(false);
    expect(isSameStack(fork, { children: fork.children })).toBe(false);
    expect(isSameStack(fork, { ...fork })).toBe(true);
  });
});

describe("resolveStackView", () => {
  it("shows the snapshot until the live stack is read", () => {
    expect(resolveStackView(chain, undefined)).toEqual({ stack: chain });
    expect(resolveStackView(undefined, undefined)).toBeUndefined();
  });

  it("hides the chip when GitHub reports no stack", () => {
    expect(resolveStackView(chain, null)).toBeUndefined();
  });

  it("carries the snapshot only when the live stack differs", () => {
    const grown = {
      ...chain,
      members: [...chain.members, { number: 3, title: "c" }],
    };
    expect(resolveStackView(chain, chain)).toEqual({ stack: chain });
    expect(resolveStackView(chain, grown)).toEqual({
      stack: grown,
      snapshot: chain,
    });
    expect(resolveStackView(undefined, grown)).toEqual({ stack: grown });
  });
});
