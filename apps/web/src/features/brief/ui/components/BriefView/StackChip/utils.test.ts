import { describe, expect, it } from "vitest";
import { createI18n } from "i18n";

import {
  isLinearPrStack,
  isSameStack,
  resolveNeighbourTarget,
  resolveStackArrow,
  resolveStackNeighbours,
  resolveStackView,
} from "./utils";

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
  const AS_OF = "2026-09-19T12:00:00.000Z";

  it("shows the snapshot until the live stack is read", () => {
    expect(resolveStackView(chain, undefined, "open")).toEqual({
      stack: chain,
    });
    expect(resolveStackView(undefined, undefined, "open")).toBeUndefined();
  });

  it("hides the chip when GitHub reports no stack for an open PR", () => {
    expect(resolveStackView(chain, {}, "open")).toBeUndefined();
    expect(resolveStackView(chain, {}, undefined)).toBeUndefined();
  });

  it("falls back to the snapshot for a merged PR with no live stack", () => {
    expect(resolveStackView(chain, {}, "merged")).toEqual({
      stack: chain,
      atGeneration: true,
    });
    expect(resolveStackView(chain, {}, "closed")).toEqual({
      stack: chain,
      atGeneration: true,
    });
    expect(resolveStackView(undefined, {}, "merged")).toBeUndefined();
  });

  it("carries the recorded stack's read time", () => {
    expect(
      resolveStackView(chain, { stack: chain, asOf: AS_OF }, "merged"),
    ).toEqual({ stack: chain, asOf: AS_OF });
  });

  it("carries the snapshot only when the live stack differs", () => {
    const grown = {
      ...chain,
      members: [...chain.members, { number: 3, title: "c" }],
    };
    expect(resolveStackView(chain, { stack: chain }, "open")).toEqual({
      stack: chain,
    });
    expect(resolveStackView(chain, { stack: grown }, "open")).toEqual({
      stack: grown,
      snapshot: chain,
    });
    expect(resolveStackView(undefined, { stack: grown }, "open")).toEqual({
      stack: grown,
    });
  });
});

const REPO_SLUG = "acme/widgets";
const STACK = {
  members: [
    { number: 1, title: "a" },
    { number: 2, title: "b" },
    { number: 3, title: "c" },
  ],
  index: 2,
};
const t = createI18n().t;

describe("resolveStackNeighbours", () => {
  it("answers both neighbours in the middle of a linear stack", () => {
    expect(resolveStackNeighbours(STACK, 2)).toEqual({
      previous: { number: 1, title: "a" },
      next: { number: 3, title: "c" },
    });
  });

  it("leaves the missing side absent at either end", () => {
    expect(resolveStackNeighbours(STACK, 1)).toEqual({
      next: { number: 2, title: "b" },
    });
    expect(resolveStackNeighbours(STACK, 3)).toEqual({
      previous: { number: 2, title: "b" },
    });
  });

  it("answers nothing for a fork or a PR outside the stack", () => {
    const forkStack = { children: [{ number: 2, title: "b" }] };
    expect(resolveStackNeighbours(forkStack, 2)).toBeUndefined();
    expect(resolveStackNeighbours(STACK, 9)).toBeUndefined();
  });
});

describe("resolveNeighbourTarget", () => {
  const member = { number: 3, title: "c" };

  it("prefers the app route, landing on the full brief", () => {
    expect(resolveNeighbourTarget(member, "42", REPO_SLUG)).toEqual({
      kind: "route",
      params: { repoId: "42", prNumber: "3" },
      search: { view: "full" },
    });
  });

  it("falls back to the member's page on GitHub", () => {
    expect(resolveNeighbourTarget(member, undefined, REPO_SLUG)).toEqual({
      kind: "github",
      href: "https://github.com/acme/widgets/pull/3",
    });
  });
});

describe("resolveStackArrow", () => {
  it("names an end of the stack as having no neighbour", () => {
    expect(resolveStackArrow(t, "next", undefined, "42", REPO_SLUG)).toEqual({
      label: "No next PR in stack",
      target: { kind: "none" },
      disabled: true,
    });
  });

  it("names the neighbour and flags a new tab for GitHub", () => {
    const view = resolveStackArrow(
      t,
      "previous",
      { number: 1, title: "a" },
      undefined,
      REPO_SLUG,
    );
    expect(view.label).toBe("Previous PR in stack, #1: a (opens in a new tab)");
  });
});
