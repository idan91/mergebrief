import { describe, expect, it } from "vitest";
import {
  isLinearPrStack,
  isSamePrStack,
  mergeStackHistory,
  resolvePrStack,
  attachPrStack,
  type OpenPullRequest,
  type PrStackSelf,
  type RepoIdentity,
} from "../src/pr-stack";

const UPSTREAM: RepoIdentity = { owner: "upstream", repo: "app" };
const FORK: RepoIdentity = { owner: "contributor", repo: "fork" };

function pr(
  number: number,
  title: string,
  headRef: string,
  baseRef: string,
  headRepo: RepoIdentity = UPSTREAM,
  baseRepo: RepoIdentity = UPSTREAM,
): OpenPullRequest {
  return { number, title, headRef, baseRef, headRepo, baseRepo };
}

const ROOT = pr(12, "Bottom", "feature/a", "main");
const MIDDLE = pr(13, "Middle", "feature/b", "feature/a");
const TIP = pr(14, "Tip", "feature/c", "feature/b");
const SIBLING = pr(15, "Fork sibling", "feature/d", "feature/b");

describe("resolvePrStack", () => {
  it("places the middle of a three-deep linear chain at 2 of 3", () => {
    const stack = resolvePrStack(MIDDLE, [ROOT, MIDDLE, TIP]);
    expect(stack).toEqual({
      members: [
        { number: 12, title: "Bottom" },
        { number: 13, title: "Middle" },
        { number: 14, title: "Tip" },
      ],
      index: 2,
    });
  });

  it("returns undefined when no parent or children connect", () => {
    expect(resolvePrStack(MIDDLE, [pr(99, "Solo", "other", "main")])).toBe(
      undefined,
    );
  });

  it("returns undefined when the parent is gone and there are no children", () => {
    expect(resolvePrStack(MIDDLE, [MIDDLE])).toBe(undefined);
  });

  it("returns a fork of parent plus every child without numbers", () => {
    const stack = resolvePrStack(MIDDLE, [ROOT, MIDDLE, TIP, SIBLING]);
    expect(stack).toEqual({
      parent: { number: 12, title: "Bottom" },
      children: [
        { number: 14, title: "Tip" },
        { number: 15, title: "Fork sibling" },
      ],
    });
    expect(stack !== undefined && isLinearPrStack(stack)).toBe(false);
  });

  it("does not duplicate self when it also appears in the open list", () => {
    const stack = resolvePrStack(MIDDLE, [ROOT, MIDDLE, TIP]);
    expect(stack !== undefined && isLinearPrStack(stack)).toBe(true);
    if (stack === undefined || !isLinearPrStack(stack)) {
      return;
    }
    const numbers = stack.members.map((member) => member.number);
    expect(numbers).toEqual([12, 13, 14]);
  });

  it("indexes a parent-only chain as 2 of 2", () => {
    const stack = resolvePrStack(MIDDLE, [ROOT, MIDDLE]);
    expect(stack).toEqual({
      members: [
        { number: 12, title: "Bottom" },
        { number: 13, title: "Middle" },
      ],
      index: 2,
    });
  });

  it("indexes a child-only chain as 1 of 2", () => {
    const stack = resolvePrStack(MIDDLE, [MIDDLE, TIP]);
    expect(stack).toEqual({
      members: [
        { number: 13, title: "Middle" },
        { number: 14, title: "Tip" },
      ],
      index: 1,
    });
  });

  it("does not stack a fork main onto an unrelated upstream main", () => {
    const fromFork = pr(10, "Contributor", "main", "main", FORK, UPSTREAM);
    const unrelated = pr(11, "Feature", "feature", "main");
    expect(resolvePrStack(fromFork, [fromFork, unrelated])).toBe(undefined);
    expect(resolvePrStack(unrelated, [fromFork, unrelated])).toBe(undefined);
  });

  it("does not invent a fork from unrelated PRs sharing a base name", () => {
    const fromFork = pr(10, "Contributor", "main", "main", FORK, UPSTREAM);
    const first = pr(11, "One", "feature-a", "main");
    const second = pr(12, "Two", "feature-b", "main");
    expect(resolvePrStack(fromFork, [fromFork, first, second])).toBe(undefined);
  });

  it("omits parent on a fork whose parent is not in the open list", () => {
    const stack = resolvePrStack(MIDDLE, [MIDDLE, TIP, SIBLING]);
    expect(stack).toEqual({
      children: [
        { number: 14, title: "Tip" },
        { number: 15, title: "Fork sibling" },
      ],
    });
    expect(stack !== undefined && "parent" in stack).toBe(false);
  });
});

describe("PrStackSelf without a baseRef", () => {
  it("still finds children from headRef alone", () => {
    const self: PrStackSelf = {
      number: 13,
      title: "Middle",
      headRef: "feature/b",
      headRepo: UPSTREAM,
    };
    const stack = resolvePrStack(self, [TIP]);
    expect(stack).toEqual({
      members: [
        { number: 13, title: "Middle" },
        { number: 14, title: "Tip" },
      ],
      index: 1,
    });
  });
});

describe("attachPrStack", () => {
  it("assigns stack when the open list connects this PR", () => {
    const meta = {
      title: MIDDLE.title,
      headRef: MIDDLE.headRef,
      baseRef: MIDDLE.baseRef,
      headRepo: UPSTREAM,
      baseRepo: UPSTREAM,
    };
    attachPrStack(meta, MIDDLE.number, [ROOT, MIDDLE, TIP]);
    expect(meta.stack).toEqual({
      members: [
        { number: 12, title: "Bottom" },
        { number: 13, title: "Middle" },
        { number: 14, title: "Tip" },
      ],
      index: 2,
    });
  });

  it("leaves stack absent when the open list does not connect", () => {
    const meta = { title: "Solo", headRef: "feature/solo", baseRef: "main" };
    attachPrStack(meta, 7, []);
    expect("stack" in meta).toBe(false);
  });
});

describe("mergeStackHistory", () => {
  const three = {
    members: [
      { number: 12, title: "Bottom" },
      { number: 13, title: "Middle" },
      { number: 14, title: "Tip" },
    ],
    index: 2,
  };

  it("grafts the stored ancestors back onto a resolve that lost them", () => {
    const shrunk = { members: three.members.slice(1), index: 1 };
    expect(mergeStackHistory(three, shrunk)).toEqual(three);
    expect(mergeStackHistory(three, three)).toEqual(three);
  });

  it("keeps the ancestors when the shrunk chain also grew at the tip", () => {
    const grown = {
      members: [...three.members.slice(1), { number: 15, title: "Newer" }],
      index: 1,
    };
    expect(mergeStackHistory(three, grown)).toEqual({
      members: [...three.members, { number: 15, title: "Newer" }],
      index: 2,
    });
  });

  it("takes the resolve's titles for the members it still holds", () => {
    const renamed = {
      members: [
        { number: 13, title: "Middle, renamed" },
        { number: 14, title: "Tip" },
      ],
      index: 1,
    };
    expect(mergeStackHistory(three, renamed)).toEqual({
      members: [
        { number: 12, title: "Bottom" },
        { number: 13, title: "Middle, renamed" },
        { number: 14, title: "Tip" },
      ],
      index: 2,
    });
  });

  it("takes the resolve as is when it lost its tip, reordered or gapped", () => {
    const lostTip = { members: three.members.slice(0, 2), index: 2 };
    expect(mergeStackHistory(three, lostTip)).toEqual(lostTip);
    const swapped = {
      members: [three.members[1], three.members[0], three.members[2]],
      index: 1,
    };
    expect(mergeStackHistory(three, swapped)).toEqual(swapped);
    const gapped = { members: [three.members[0], three.members[2]], index: 1 };
    expect(mergeStackHistory(three, gapped)).toEqual(gapped);
    const other = {
      members: [
        { number: 20, title: "x" },
        { number: 21, title: "y" },
      ],
      index: 1,
    };
    expect(mergeStackHistory(three, other)).toEqual(other);
  });

  it("keeps a fork's stored parent when the resolve lost it", () => {
    const parent = { number: 12, title: "Bottom" };
    const children = [
      { number: 14, title: "Tip" },
      { number: 15, title: "Sibling" },
    ];
    expect(mergeStackHistory({ parent, children }, { children })).toEqual({
      parent,
      children,
    });
    const newParent = { number: 11, title: "Other" };
    expect(
      mergeStackHistory({ parent, children }, { parent: newParent, children }),
    ).toEqual({ parent: newParent, children });
    expect(mergeStackHistory(three, { children })).toEqual({ children });
    expect(mergeStackHistory({ children }, three)).toEqual(three);
  });
});

describe("isSamePrStack", () => {
  it("compares numbers, titles and place", () => {
    const chain = {
      members: [
        { number: 1, title: "a" },
        { number: 2, title: "b" },
      ],
      index: 1,
    };
    expect(isSamePrStack(chain, { ...chain })).toBe(true);
    expect(isSamePrStack(chain, { ...chain, index: 2 })).toBe(false);
    expect(
      isSamePrStack(chain, {
        ...chain,
        members: [
          { number: 1, title: "A" },
          { number: 2, title: "b" },
        ],
      }),
    ).toBe(false);
    expect(isSamePrStack(chain, { children: chain.members })).toBe(false);
  });
});
