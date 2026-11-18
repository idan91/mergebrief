import type { OpenPullRequest } from "brief-core/pr-stack";
import { describe, expect, it } from "vitest";
import { shapeLiveStack } from "./live-stack";

const REPO = { owner: "o", repo: "r" };

function stubOpen(
  number: number,
  head: string,
  base: string,
  draft = false,
): OpenPullRequest {
  return {
    number,
    title: `PR ${String(number)}`,
    draft,
    headRef: head,
    baseRef: base,
    headRepo: REPO,
    baseRepo: REPO,
  };
}

const BOTTOM = stubOpen(6, "feature/base", "main");
const MIDDLE = stubOpen(7, "feature/mid", "feature/base");
const TIP = stubOpen(8, "feature/tip", "feature/mid", true);
const SIBLING = stubOpen(9, "feature/side", "feature/mid");
const OPEN = [BOTTOM, MIDDLE, TIP, SIBLING];

function makeMember(number: number) {
  return { number, title: `PR ${String(number)}` };
}

describe("shapeLiveStack", () => {
  it("decorates a chain with each member's state and branch and the base", () => {
    const chain = {
      members: [makeMember(6), makeMember(7), makeMember(8)],
      index: 2,
    };

    expect(shapeLiveStack(chain, MIDDLE, OPEN)).toEqual({
      stack: {
        members: [
          { number: 6, title: "PR 6", state: "open", headRef: "feature/base" },
          { number: 7, title: "PR 7", state: "open", headRef: "feature/mid" },
          { number: 8, title: "PR 8", state: "draft", headRef: "feature/tip" },
        ],
        index: 2,
        baseRef: "main",
      },
    });
  });

  it("takes a fork's base from its parent", () => {
    const fork = {
      parent: makeMember(6),
      children: [makeMember(8), makeMember(9)],
    };

    expect(shapeLiveStack(fork, MIDDLE, OPEN)).toEqual({
      stack: {
        parent: {
          number: 6,
          title: "PR 6",
          state: "open",
          headRef: "feature/base",
        },
        children: [
          { number: 8, title: "PR 8", state: "draft", headRef: "feature/tip" },
          { number: 9, title: "PR 9", state: "open", headRef: "feature/side" },
        ],
        baseRef: "main",
      },
    });
  });

  it("takes a parentless fork's base from the PR itself", () => {
    const fork = { children: [makeMember(8), makeMember(9)] };

    expect(shapeLiveStack(fork, MIDDLE, OPEN)).toEqual({
      stack: {
        children: [
          { number: 8, title: "PR 8", state: "draft", headRef: "feature/tip" },
          { number: 9, title: "PR 9", state: "open", headRef: "feature/side" },
        ],
        baseRef: "feature/base",
      },
    });
  });

  it("leaves a member the open list lacks and an empty base undecorated", () => {
    const chain = { members: [makeMember(6), makeMember(7)], index: 1 };
    const unbased = stubOpen(6, "feature/base", "");

    expect(shapeLiveStack(chain, unbased, [unbased, MIDDLE])).toEqual({
      stack: {
        members: [
          { number: 6, title: "PR 6", state: "open", headRef: "feature/base" },
          { number: 7, title: "PR 7", state: "open", headRef: "feature/mid" },
        ],
        index: 1,
      },
    });
    expect(shapeLiveStack(chain, unbased, [unbased])).toEqual({
      stack: {
        members: [
          { number: 6, title: "PR 6", state: "open", headRef: "feature/base" },
          { number: 7, title: "PR 7" },
        ],
        index: 1,
      },
    });
  });

  it("decorates the PR from its own fetch when the open list predates it", () => {
    const chain = { members: [makeMember(6), makeMember(7)], index: 1 };
    const fetched = {
      number: 6,
      draft: true,
      headRef: "feature/base",
      baseRef: "main",
    };

    expect(shapeLiveStack(chain, fetched, [MIDDLE])).toEqual({
      stack: {
        members: [
          { number: 6, title: "PR 6", state: "draft", headRef: "feature/base" },
          { number: 7, title: "PR 7", state: "open", headRef: "feature/mid" },
        ],
        index: 1,
        baseRef: "main",
      },
    });
  });
});
