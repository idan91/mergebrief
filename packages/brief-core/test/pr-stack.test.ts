import { describe, expect, it } from "vitest";
import {
  isLinearPrStack,
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
    if (stack === undefined || !isLinearPrStack(stack)) return;
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
