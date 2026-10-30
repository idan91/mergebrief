// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createI18n } from "i18n";

import {
  centreCurrentRow,
  deriveChainRows,
  deriveForkRows,
  isLinearPrStack,
  isSameStack,
  resolveCentredScrollTop,
  resolveMemberStateVariant,
  resolveNeighbourTarget,
  resolveStackArrow,
  resolveStackMemberLabel,
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

describe("deriveChainRows", () => {
  it("lists the tip first and numbers each row from the base", () => {
    expect(deriveChainRows(STACK.members, 2)).toEqual([
      { member: { number: 3, title: "c" }, position: 3, current: false },
      { member: { number: 2, title: "b" }, position: 2, current: true },
      { member: { number: 1, title: "a" }, position: 1, current: false },
    ]);
  });

  it("marks no row current for a PR outside the chain", () => {
    const rows = deriveChainRows(STACK.members, 9);
    expect(rows.every((row) => !row.current)).toBe(true);
  });
});

describe("deriveForkRows", () => {
  it("keeps the given order and numbers nothing", () => {
    expect(deriveForkRows(fork.children, 4)).toEqual([
      { member: { number: 3, title: "c" }, current: false },
      { member: { number: 4, title: "d" }, current: true },
    ]);
  });
});

describe("resolveMemberStateVariant", () => {
  it("maps open and draft to their glyphs and draws nothing otherwise", () => {
    expect(resolveMemberStateVariant("open")).toBe("open");
    expect(resolveMemberStateVariant("draft")).toBe("draft");
    expect(resolveMemberStateVariant("unknown")).toBeUndefined();
    expect(resolveMemberStateVariant(undefined)).toBeUndefined();
  });
});

describe("resolveStackMemberLabel", () => {
  const member = { number: 8, title: "Tip" };

  it("is number and title when the live read adds nothing", () => {
    expect(resolveStackMemberLabel(t, member)).toBe("#8 Tip");
  });

  it("adds the state, then the branch, when the live read knows them", () => {
    const live = { ...member, state: "draft" as const, headRef: "f/tip" };
    expect(resolveStackMemberLabel(t, live)).toBe("#8 Tip, Draft, f/tip");
  });

  it("leaves out a state this bundle predates", () => {
    const live = { ...member, state: "unknown" as const };
    expect(resolveStackMemberLabel(t, live)).toBe("#8 Tip");
  });
});

describe("resolveCentredScrollTop", () => {
  it("puts the row in the middle of the viewport", () => {
    expect(resolveCentredScrollTop(560, 56, 364)).toBe(406);
  });

  it("never scrolls above the top", () => {
    expect(resolveCentredScrollTop(56, 56, 364)).toBe(0);
    expect(resolveCentredScrollTop(0, 56, 364)).toBe(0);
  });

  it("is zero when the viewport holds the row without scrolling", () => {
    expect(resolveCentredScrollTop(154, 56, 364)).toBe(0);
  });
});

const ROW_HEIGHT = 56;
const VIEWPORT_HEIGHT = 364;

function stubLayout(element: HTMLElement, property: string, value: number) {
  Object.defineProperty(element, property, { configurable: true, value });
}

function makeScroller(rowCount: number, currentIndex: number): HTMLElement {
  const scroller = document.createElement("ol");
  stubLayout(scroller, "clientHeight", VIEWPORT_HEIGHT);
  for (let index = 0; index < rowCount; index += 1) {
    const row = document.createElement("li");
    const link = document.createElement("a");
    if (index === currentIndex) {
      link.setAttribute("aria-current", "page");
    }
    row.append(link);
    stubLayout(row, "offsetHeight", ROW_HEIGHT);
    stubLayout(row, "offsetTop", 0);
    scroller.append(row);
  }
  return scroller;
}

describe("centreCurrentRow", () => {
  it("measures the rows above, not the stuck row's own offset", () => {
    const scroller = makeScroller(10, 7);

    centreCurrentRow(scroller);

    expect(scroller.scrollTop).toBe(238);
  });

  it("leaves a list with no current row where it is", () => {
    const scroller = makeScroller(10, -1);
    scroller.scrollTop = 40;

    centreCurrentRow(scroller);

    expect(scroller.scrollTop).toBe(40);
  });
});
