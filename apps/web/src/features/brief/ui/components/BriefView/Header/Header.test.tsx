// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Brief } from "../../../../model/types";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import {
  renderInRouter,
  renderStageInRouter,
} from "../../../../../../test/router";
import { intersectionObservers } from "../../../../../../test/setup";
import { CONTENT_START_ATTR } from "../utils";
import { Header, type HeaderProps } from ".";

afterEach(cleanup);

const brief: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 7,
    title: "Tighten the cross-param leak",
    url: "https://example.com/pr/7",
    sha: "headabc1234",
    description: "",
  },
  summary: "s",
  index: 3,
  commitRange: { base: "basebase", head: "headhead", commitCount: 2 },
  generation: { provider: "anthropic", model: "m-1", effort: "high" },
  changeGroups: [
    {
      id: "g1",
      title: "g",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "chunk-a",
      changeGroupId: "g1",
      file: "src/a.ts",
      concern: "implementation",
      role: "core",
      loc: { added: 3, deleted: 1 },
      addedRanges: [],
      removedRanges: [],
      riskSurface: [],
      diff: [{ kind: "add", content: "a();", newLine: 11 }],
    },
  ],
  concernView: [],
};

/** A full prop set keyed on the own-draft state, for the stage-based tests. */
function headerProps(ownDraft: HeaderProps["ownDraft"]): HeaderProps {
  return {
    brief,
    briefId: "test-brief",
    model: buildBriefViewModel(brief),
    totals: {
      reviewed: 1,
      chunkTotal: 2,
      flagsResolved: 0,
      flagTotal: 1,
    },
    progress: 50,
    openSubmit: vi.fn(),
    draftCommentCount: 0,
    availability: { previousBrief: false, lastReview: false },
    compareState: { view: "full", compare: "off" },
    ownDraft,
    jumpToGroup: vi.fn(),
    jumpToGroupHeading: vi.fn(),
    toggleShortcuts: vi.fn(),
    focusMode: false,
    largeTitle: null,
  };
}

const HEADER_STUB_PATHS = ["/repos/$repoId/pulls/$prNumber"] as const;

async function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const openSubmit = vi.fn();
  const props: HeaderProps = {
    brief,
    briefId: "test-brief",
    model: buildBriefViewModel(brief),
    totals: {
      reviewed: 1,
      chunkTotal: 2,
      flagsResolved: 0,
      flagTotal: 1,
    },
    progress: 50,
    openSubmit,
    draftCommentCount: 0,
    availability: { previousBrief: false, lastReview: false },
    compareState: { view: "full", compare: "off" },
    controlsSlot: <div data-testid="controls-slot" />,
    jumpToGroup: vi.fn(),
    jumpToGroupHeading: vi.fn(),
    toggleShortcuts: vi.fn(),
    focusMode: false,
    largeTitle: null,
    ...overrides,
  };
  await renderInRouter(<Header {...props} />, undefined, HEADER_STUB_PATHS);
  return { openSubmit };
}

describe("Header identity row", () => {
  it("renders wordmark, title, repo and PR link on one line", async () => {
    await renderHeader();
    const wordmark = screen.getByRole("link", { name: "MergeBrief" });
    expect(wordmark.getAttribute("href")).toBe("/");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Tighten the cross-param leak",
    );
    expect(screen.getByText("acme/widgets")).toBeTruthy();
    const link = screen.getByRole("link", { name: /#7/ });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/widgets/pull/7",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    // Artifact identity lives in the Revisions tab, the rest in the details
    // panel.
    expect(screen.queryByText(/local brief @/)).toBeNull();
    expect(screen.queryByText(/brief _3/)).toBeNull();
    expect(screen.queryByText(/basebase\.\.headhead/)).toBeNull();
  });

  it("builds the PR link from repo and number, never the stored url", async () => {
    const pr = { ...brief.pr, url: "javascript:alert(1)" };

    await renderHeader({ brief: { ...brief, pr } });

    const link = screen.getByRole("link", { name: /#7/ });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/widgets/pull/7",
    );
  });

  it("leads the meta line with the PR author", async () => {
    await renderHeader({ authorLogin: "mira-k" });

    const chip = screen.getByTestId("author-chip");
    expect(chip.getAttribute("href")).toBe("https://github.com/mira-k");
    expect(chip.parentElement?.firstElementChild).toBe(chip);
  });

  it("renders no author chip without a login", async () => {
    await renderHeader();
    expect(screen.queryByTestId("author-chip")).toBeNull();
  });

  it("marks itself in focus mode so its styles can quiet it", async () => {
    await renderHeader({ focusMode: true });
    expect(document.querySelector("header")?.hasAttribute("data-focus")).toBe(
      true,
    );
  });

  /** A crossing at `top`, against a root edge at `lineTop`. Built out in full
   * rather than cast: the header reads boundingClientRect and rootBounds. */
  function crossingEntry(
    top: number,
    lineTop: number,
    target: Element,
  ): IntersectionObserverEntry {
    return {
      boundingClientRect: new DOMRect(0, top, 10, 10),
      intersectionRatio: 0,
      intersectionRect: new DOMRect(),
      isIntersecting: top > lineTop,
      rootBounds: new DOMRect(0, lineTop, 100, 100),
      target,
      time: 0,
    };
  }

  it("collapses when the change content reaches the header, and expands back", async () => {
    // The trigger line is the pinned stack's resting height; jsdom computes no
    // stylesheet, so publish one for the header to read.
    document.documentElement.style.setProperty("--sticky-stack-h", "120px");
    const sentinel = document.createElement("div");
    sentinel.setAttribute(CONTENT_START_ATTR, "");
    document.body.append(sentinel);
    intersectionObservers.length = 0;
    try {
      await renderHeader();
      const header = document.querySelector("header");
      await waitFor(() => expect(intersectionObservers.length).toBe(1));
      const observed = intersectionObservers[0];
      expect(observed?.rootMargin).toBe("-120px 0px 0px 0px");

      // Content risen past the line: collapse.
      act(() => {
        observed?.callback([crossingEntry(-1, 0, sentinel)], observed as never);
      });
      expect(header?.hasAttribute("data-collapsed")).toBe(true);

      // Scrolled back below it: expand. Bistable, not one-way.
      act(() => {
        observed?.callback([crossingEntry(40, 0, sentinel)], observed as never);
      });
      expect(header?.hasAttribute("data-collapsed")).toBe(false);
    } finally {
      sentinel.remove();
      document.documentElement.style.removeProperty("--sticky-stack-h");
    }
  });

  it("shows its title once the large title scrolls under the bar", async () => {
    const block = document.createElement("div");
    document.body.append(block);
    intersectionObservers.length = 0;
    try {
      await renderHeader({ largeTitle: block });
      const header = document.querySelector("header");
      await waitFor(() => expect(intersectionObservers.length).toBe(1));
      const observed = intersectionObservers[0];

      act(() => {
        observed?.callback([crossingEntry(-20, 0, block)], observed as never);
      });
      expect(header?.hasAttribute("data-title-out")).toBe(true);

      act(() => {
        observed?.callback([crossingEntry(40, 0, block)], observed as never);
      });
      expect(header?.hasAttribute("data-title-out")).toBe(false);
    } finally {
      block.remove();
    }
  });

  it("splits the block into a source line and a meta line", async () => {
    await renderHeader({ authorLogin: "mira-k" });
    // Fixed membership: the source (title, state, repo, PR link) on the first
    // line, the PR's identity (author, stack, branches) on the second. The
    // block reserves a constant height for exactly this shape, so a member
    // moving between lines is what would break the published --top-bar-h.
    const title = screen.getByRole("heading", { level: 1 });
    const titleLine = title.parentElement;
    const block = titleLine?.parentElement;
    const metaLine = block?.lastElementChild;

    expect(titleLine?.contains(screen.getByText("acme/widgets"))).toBe(true);
    expect(titleLine?.contains(screen.getByRole("link", { name: /#7/ }))).toBe(
      true,
    );
    expect(metaLine?.contains(screen.getByTestId("author-chip"))).toBe(true);
    expect(metaLine?.contains(title)).toBe(false);
    expect(metaLine?.contains(screen.getByText("acme/widgets"))).toBe(false);
  });
});

describe("branch pair", () => {
  function makeBriefWithRefs(refs: {
    baseRef?: string;
    headRef?: string;
  }): Brief {
    return { ...brief, pr: { ...brief.pr, ...refs } };
  }

  it("renders nothing without stamped refs", async () => {
    await renderHeader();
    expect(screen.queryByTestId("branch-pair")).toBeNull();
  });

  it("renders the pair first on the meta line when both refs are stamped", async () => {
    await renderHeader({
      brief: makeBriefWithRefs({ baseRef: "main", headRef: "feature/thing" }),
    });
    const pair = screen.getByTestId("branch-pair");
    const titleLine = screen.getByRole("heading", { level: 1 }).parentElement;
    const metaLine = titleLine?.parentElement?.lastElementChild;
    expect(metaLine?.contains(pair)).toBe(true);
    expect(titleLine?.contains(pair)).toBe(false);
    expect(metaLine?.firstElementChild).toBe(pair);
    expect(pair?.textContent).toContain("main");
    expect(pair?.querySelector('[data-icon="arrow-up"]')).toBeTruthy();
    expect(pair?.textContent).toContain("feature/thing");
  });

  it("renders head-only without an arrow", async () => {
    await renderHeader({
      brief: makeBriefWithRefs({ headRef: "feature/thing" }),
    });
    const pair = screen.getByTestId("branch-pair");
    expect(pair?.textContent).toContain("feature/thing");
    expect(pair.querySelector('[data-icon="arrow-up"]')).toBeNull();
  });

  it("copy clicks write the bare branch name", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await renderHeader({
      brief: makeBriefWithRefs({ baseRef: "main", headRef: "feature/thing" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy base branch" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("main"));
    fireEvent.click(screen.getByRole("button", { name: "Copy head branch" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("feature/thing"),
    );
  });

  it("keeps the pair on the meta line when collapsed", async () => {
    document.documentElement.style.setProperty("--sticky-stack-h", "120px");
    const sentinel = document.createElement("div");
    sentinel.setAttribute(CONTENT_START_ATTR, "");
    document.body.append(sentinel);
    intersectionObservers.length = 0;
    try {
      await renderHeader({
        brief: makeBriefWithRefs({ baseRef: "main", headRef: "feature/thing" }),
      });
      await waitFor(() => expect(intersectionObservers.length).toBe(1));
      const observed = intersectionObservers[0];
      act(() => {
        observed?.callback(
          [
            {
              boundingClientRect: new DOMRect(0, -1, 10, 10),
              intersectionRatio: 0,
              intersectionRect: new DOMRect(),
              isIntersecting: false,
              rootBounds: new DOMRect(0, 0, 100, 100),
              target: sentinel,
              time: 0,
            },
          ],
          observed as never,
        );
      });
      expect(
        document.querySelector("header")?.hasAttribute("data-collapsed"),
      ).toBe(true);
      const pair = screen.getByTestId("branch-pair");
      const titleLine = screen.getByRole("heading", { level: 1 }).parentElement;
      const metaLine = titleLine?.parentElement?.lastElementChild;
      expect(metaLine?.contains(pair)).toBe(true);
    } finally {
      sentinel.remove();
      document.documentElement.style.removeProperty("--sticky-stack-h");
    }
  });
});

describe("stack chip", () => {
  const linear = {
    members: [
      { number: 6, title: "Parent" },
      { number: 7, title: "Tighten the cross-param leak" },
      { number: 8, title: "Child" },
    ],
    index: 2,
  };
  const fork = {
    parent: { number: 6, title: "Parent" },
    children: [
      { number: 8, title: "Child" },
      { number: 9, title: "Other child" },
    ],
  };

  function briefWithStack(
    stack: typeof linear | typeof fork,
    state: "open" | "closed" = "open",
  ): Brief {
    return { ...brief, pr: { ...brief.pr, stack, state } };
  }

  it("renders no chip when stack is absent", async () => {
    await renderHeader();
    expect(screen.queryByTestId("stack-chip")).toBeNull();
  });

  it("prefers the live stack over the generation-time one", async () => {
    const grown = {
      members: [...linear.members, { number: 9, title: "Newest" }],
      index: 2,
    };
    await renderHeader({
      brief: briefWithStack(linear),
      livePrState: { state: "open", draft: false, stack: { stack: grown } },
    });
    expect(screen.getByTestId("stack-chip").textContent).toBe("2/4");
  });

  it("keeps the generation-time stack while the live one is unread", async () => {
    await renderHeader({
      brief: briefWithStack(linear),
      livePrState: { state: "open", draft: false },
    });
    expect(screen.getByTestId("stack-chip").textContent).toBe("2/3");
  });

  it("drops the chip when GitHub reports no stack for an open PR", async () => {
    await renderHeader({
      brief: briefWithStack(linear),
      livePrState: { state: "open", draft: false, stack: { stack: null } },
    });
    expect(screen.queryByTestId("stack-chip")).toBeNull();
  });

  it("keeps the generation-time stack for a merged PR with no live one", async () => {
    await renderHeader({
      brief: briefWithStack(linear),
      livePrState: { state: "merged", draft: false, stack: { stack: null } },
    });
    const chip = screen.getByTestId("stack-chip");
    expect(chip.textContent).toBe("2/3");
    fireEvent.click(chip);
    expect(screen.getByText("At generation time")).toBeTruthy();
  });

  it("dates the recorded stack the read served for a merged PR", async () => {
    await renderHeader({
      brief: briefWithStack(linear),
      livePrState: {
        state: "merged",
        draft: false,
        stack: { stack: linear, asOf: "2026-09-19T12:00:00.000Z" },
      },
    });
    fireEvent.click(screen.getByTestId("stack-chip"));
    expect(screen.getByText("As of Sep 19, 2026")).toBeTruthy();
  });

  it("renders the linear chip first on the meta line", async () => {
    await renderHeader({ brief: briefWithStack(linear) });
    const chip = screen.getByTestId("stack-chip");
    const titleLine = screen.getByRole("heading", { level: 1 }).parentElement;
    const metaLine = titleLine?.parentElement?.lastElementChild;
    expect(chip?.textContent).toBe("2/3");
    expect(titleLine?.contains(chip)).toBe(false);
    expect(metaLine?.contains(chip)).toBe(true);
    expect(metaLine?.firstElementChild?.contains(chip)).toBe(true);
  });

  it("keeps the stack then the branches on the meta line", async () => {
    const stacked = briefWithStack(linear);
    await renderHeader({
      brief: {
        ...stacked,
        pr: {
          ...stacked.pr,
          baseRef: "main",
          headRef: "feature/thing",
        },
      },
    });
    const titleLine = screen.getByRole("heading", { level: 1 }).parentElement;
    const metaLine = titleLine?.parentElement?.lastElementChild;
    const stackBlock = screen.getByTestId("stack-arrows");
    const pair = screen.getByTestId("branch-pair");
    expect(stackBlock.contains(screen.getByTestId("stack-chip"))).toBe(true);
    expect(metaLine?.firstElementChild).toBe(stackBlock);
    expect(stackBlock.nextElementSibling).toBe(pair);
    expect(metaLine?.lastElementChild).toBe(pair);
  });

  it("renders a fork chip without a fraction", async () => {
    await renderHeader({ brief: briefWithStack(fork) });
    const chip = screen.getByTestId("stack-chip");
    expect(chip?.textContent).toBe("Stacked");
    expect(chip?.textContent).not.toMatch(/\d+\/\d+/);
  });

  it("lists neighbour titles in the disclosure", async () => {
    await renderHeader({ brief: briefWithStack(linear) });
    fireEvent.click(
      screen.getByRole("button", { name: "pull request 2 of 3 in the stack" }),
    );
    expect(screen.getByLabelText(/^#6 Parent/)).toBeTruthy();
    expect(
      screen.getByLabelText("#7 Tighten the cross-param leak"),
    ).toBeTruthy();
    expect(screen.getByLabelText(/^#8 Child/)).toBeTruthy();
  });

  it("keeps the current PR from being a link", async () => {
    await renderHeader({ brief: briefWithStack(linear), repoId: "424242" });
    fireEvent.click(
      screen.getByRole("button", { name: "pull request 2 of 3 in the stack" }),
    );
    expect(
      screen.getByLabelText("#7 Tighten the cross-param leak").closest("a"),
    ).toBeNull();
  });

  it("points neighbour links at the in-app repo pull path", async () => {
    await renderHeader({ brief: briefWithStack(linear), repoId: "424242" });
    fireEvent.click(
      screen.getByRole("button", { name: "pull request 2 of 3 in the stack" }),
    );
    expect(
      screen.getByRole("link", { name: "#6 Parent" }).getAttribute("href"),
    ).toBe("/repos/424242/pulls/6");
  });
});

describe("state badge", () => {
  const stamped = (
    state: "open" | "closed",
    draft: boolean,
    merged: boolean,
  ) => ({ ...brief, pr: { ...brief.pr, state, draft, merged } });

  it("renders no badge on a pre-stamping artifact", async () => {
    await renderHeader();
    expect(document.querySelector("[data-state-badge]")).toBeNull();
  });

  it("keeps the self-review chip adjacent to the Draft badge", async () => {
    await renderHeader({
      brief: stamped("open", true, false),
      ownDraft: { markReady: vi.fn(), pending: false },
    });
    const badge = document.querySelector("[data-state-badge]");
    expect(badge?.getAttribute("data-variant")).toBe("draft");
    // The chip must be the badge's immediate DOM sibling.
    expect(badge?.nextElementSibling?.matches("[data-self-review-chip]")).toBe(
      true,
    );
    // Both ride the title's own line, not the meta line under it.
    const titleLine = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(titleLine?.contains(badge!)).toBe(true);
  });

  it.each([
    ["open", false, false, "open", "Open"],
    ["open", true, false, "draft", "Draft"],
    ["closed", false, false, "closed", "Closed"],
    // Draft supersedes OPEN, never closed.
    ["closed", true, false, "closed", "Closed"],
    ["closed", false, true, "merged", "Merged"],
    // Draft flag on a merged snapshot: merged still wins.
    ["closed", true, true, "merged", "Merged"],
  ] as const)(
    "state=%s draft=%s merged=%s → %s badge",
    async (state, draft, merged, variant, label) => {
      await renderHeader({ brief: stamped(state, draft, merged) });
      const badge = document.querySelector("[data-state-badge]");
      expect(badge?.getAttribute("data-variant")).toBe(variant);
      // Visible text is the state word; SR text carries the prefix.
      expect(badge?.textContent).toBe(`pull request ${label}`);
    },
  );

  it("renders from live webhook state on an unstamped artifact", async () => {
    // A DB brief generated before stamping has no pr.state - the badge must
    // come from the live pull-request row there.
    await renderHeader({ livePrState: { state: "open", draft: false } });
    const badge = document.querySelector("[data-state-badge]");
    expect(badge?.getAttribute("data-variant")).toBe("open");
  });

  it.each([
    ["open", false, "open"],
    ["open", true, "draft"],
    ["closed", false, "closed"],
    // The live DB vocabulary folds merged INTO the state.
    ["merged", false, "merged"],
    ["merged", true, "merged"],
  ] as const)(
    "live state=%s draft=%s → %s badge",
    async (state, draft, variant) => {
      await renderHeader({ livePrState: { state, draft } });
      expect(
        document
          .querySelector("[data-state-badge]")
          ?.getAttribute("data-variant"),
      ).toBe(variant);
    },
  );

  it("live state SUPERSEDES a stale artifact stamp", async () => {
    // Artifact stamped open at generation; the PR merged since. The DB
    // route shows live truth - staleness is only accepted on the local
    // file path, where no live source exists.
    await renderHeader({
      brief: stamped("open", false, false),
      livePrState: { state: "merged", draft: false },
    });
    expect(
      document
        .querySelector("[data-state-badge]")
        ?.getAttribute("data-variant"),
    ).toBe("merged");
  });
});

describe("Header menu and stats", () => {
  it("shows progress facts on the comparison row with core-lines LOC", async () => {
    await renderHeader();
    expect(screen.getByText("chunks").textContent).toContain("1/2");
    expect(screen.getByText("flags").textContent).toContain("0/1");
    // The LOC cell is the core-lines disclosure trigger - a real button.
    const loc = screen.getByTestId("core-lines-disclosure");
    expect(loc.textContent).toContain("core lines");
    expect(loc.textContent).toContain("+3");
    expect(loc.textContent).toContain("−1");
    fireEvent.click(loc);
    expect(screen.getByText("all lines")).toBeTruthy();
    expect(screen.getByText(/derived from the diff/)).toBeTruthy();
  });

  it("shows the unattributed stat when a remainder exists", async () => {
    const model = buildBriefViewModel({
      ...brief,
      unattributed: [
        {
          file: "src/orphan.ts",
          addedRanges: [{ start: 1, end: 4 }],
          removedRanges: [{ start: 2, end: 3 }],
        },
      ],
    });
    const jumpToGroup = vi.fn();
    await renderHeader({ jumpToGroup, model });
    const stat = screen.getByTestId("unattributed-disclosure");
    expect(stat.textContent).toContain("unattributed");
    expect(stat.textContent).toContain("+4");
    expect(stat.textContent).toContain("−2");
    fireEvent.click(stat);
    expect(screen.getByText("Unattributed remainder")).toBeTruthy();
    expect(
      screen.getByText("The model did not attribute these lines."),
    ).toBeTruthy();
    expect(
      screen.getByText("They are reviewed as the last change-group."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Jump to group" }), {
      detail: 1,
    });
    expect(jumpToGroup).toHaveBeenCalledWith("unattributed-remainder");
  });

  it("renders no unattributed stat without a remainder", async () => {
    await renderHeader();
    expect(screen.queryByTestId("unattributed-disclosure")).toBeNull();
    await renderHeader({
      model: buildBriefViewModel({ ...brief, unattributed: [] }),
    });
    expect(screen.queryByTestId("unattributed-disclosure")).toBeNull();
  });

  it("offers no more-actions menu on a file brief", async () => {
    await renderHeader();
    expect(screen.queryByRole("button", { name: /more actions/i })).toBeNull();
  });

  it("keeps the accent CTA top-level", async () => {
    const { openSubmit } = await renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(openSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("Header Submit CTA draft count", () => {
  it("shows Submit with no count chip at zero drafts", async () => {
    await renderHeader();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
    expect(screen.queryByTestId("submit-count-chip")).toBeNull();
  });

  it("names the Submit CTA with one draft comment", async () => {
    await renderHeader({ draftCommentCount: 1 });
    const cta = screen.getByRole("button", {
      name: "Submit review, 1 draft comment",
    });
    expect(cta.textContent).toContain("Submit");
    const chip = screen.getByTestId("submit-count-chip");
    expect(chip.textContent).toBe("1");
    expect(chip.getAttribute("aria-hidden")).toBe("true");
  });

  it("names the Submit CTA with many draft comments", async () => {
    await renderHeader({ draftCommentCount: 12 });
    const cta = screen.getByRole("button", {
      name: "Submit review, 12 draft comments",
    });
    expect(cta.textContent).toContain("Submit");
    const chip = screen.getByTestId("submit-count-chip");
    expect(chip.textContent).toBe("12");
    expect(chip.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps Mark ready without a count chip", async () => {
    await renderHeader({
      draftCommentCount: 12,
      ownDraft: { markReady: vi.fn(), pending: false },
    });
    expect(
      screen.getByRole("button", { name: "Mark ready for review" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.queryByTestId("submit-count-chip")).toBeNull();
  });
});

describe("Header own-draft state", () => {
  it("renders no self-review chip outside the own-draft state", async () => {
    await renderHeader();
    expect(screen.queryByText("Self-review — your draft")).toBeNull();
  });

  it("renders the non-dismissible self-review chip with its tooltip", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    const chip = screen.getByText("Self-review — your draft");
    expect(chip).toBeTruthy();
    // Non-dismissible: the chip carries no close affordance.
    expect(
      chip
        .closest("[data-self-review-chip]")
        ?.querySelector("button[aria-label*='close' i]"),
    ).toBeNull();
    const info = screen.getByRole("button", { name: "About self-review" });
    const tooltipId = info.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    const tooltip = document.getElementById(tooltipId ?? "");
    expect(tooltip?.getAttribute("role")).toBe("tooltip");
    expect(tooltip?.textContent).toBe(
      "You're viewing your own draft PR. Review submission and the receipt unlock once it's marked ready for review.",
    );
  });

  it("Escape dismisses a focused tooltip without leaking the key", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    const info = screen.getByRole("button", { name: "About self-review" });
    const wrap = info.parentElement;
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);

    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    fireEvent.focus(info);
    fireEvent.keyDown(info, { key: "Escape" });
    // Dismissed - and the key never reached the page (focus-mode Escape).
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKeyDown);

    // Blur re-arms it for the next focus/hover…
    fireEvent.blur(info);
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);

    // …and so does the pointer leaving after an Escape while hovering.
    if (wrap) {
      fireEvent.mouseEnter(wrap);
    }
    fireEvent.keyDown(document, { key: "Escape" });
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);
    if (wrap) {
      fireEvent.mouseLeave(wrap);
    }
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);
  });

  it("Escape-dismissal sticks while EITHER hover or focus is still active", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    const info = screen.getByRole("button", { name: "About self-review" });
    const wrap = info.parentElement;

    // Both channels active, then Escape.
    if (wrap) {
      fireEvent.mouseEnter(wrap);
    }
    fireEvent.focus(info);
    fireEvent.keyDown(info, { key: "Escape" });
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);

    // Pointer drifts away while focus remains: must STAY dismissed.
    if (wrap) {
      fireEvent.mouseLeave(wrap);
    }
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);

    // The inverse: re-hover, then blur while the pointer stays - still
    // dismissed (focus left, hover holds).
    if (wrap) {
      fireEvent.mouseEnter(wrap);
    }
    fireEvent.blur(info);
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);

    // Only when BOTH channels go idle does the tooltip re-arm.
    if (wrap) {
      fireEvent.mouseLeave(wrap);
    }
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);
  });

  it("Escape dismisses a hovered tooltip without leaking the key", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    const info = screen.getByRole("button", { name: "About self-review" });
    const wrap = info.parentElement;
    expect(document.activeElement).toBe(document.body);

    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    // Pointer hover only - focus never moves off <body>.
    if (wrap) {
      fireEvent.mouseEnter(wrap);
    }
    fireEvent.keyDown(document.body, { key: "Escape" });
    // Dismissed, key claimed: it must NOT fall through to the page's
    // window-level shortcut listener (which would exit focus mode).
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);
    expect(onWindowKeyDown).not.toHaveBeenCalled();

    // Once the tooltip is gone, the claim is released: a second Escape
    // reaches the page as usual.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onWindowKeyDown).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("swaps the terminal-action slot: Mark ready for review replaces Receipt", async () => {
    const markReady = vi.fn();
    const { openSubmit } = await renderHeader({
      ownDraft: { markReady, pending: false },
    });
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(markReady).toHaveBeenCalledTimes(1);
    expect(openSubmit).toHaveBeenCalledTimes(0);
  });

  it("marks the pending CTA aria-disabled so focus survives", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: true } });
    const cta = screen.getByRole("button", { name: /marking ready/i });
    // Hard `disabled` would dump keyboard focus on <body> mid-mutation; the
    // mark-ready flow's in-flight guard already no-ops repeat clicks.
    expect((cta as HTMLButtonElement).disabled).toBe(false);
    expect(cta.getAttribute("aria-disabled")).toBe("true");
    cta.focus();
    expect(document.activeElement).toBe(cta);
  });

  it("keeps the pending CTA click live so the flow can announce", async () => {
    // Caller-owned aria-disabled, not the Button `disabled` prop: a press
    // while pending/unavailable must still reach markReady, whose guard
    // no-ops repeats and announces why.
    const markReady = vi.fn();
    await renderHeader({ ownDraft: { markReady, pending: true } });
    fireEvent.click(screen.getByRole("button", { name: /marking ready/i }));
    expect(markReady).toHaveBeenCalledTimes(1);
  });

  it("moves focus to Receipt when own-draft ends on the focused slot", async () => {
    const { update } = await renderStageInRouter(
      <Header {...headerProps({ markReady: vi.fn(), pending: false })} />,
      HEADER_STUB_PATHS,
    );
    const cta = screen.getByRole("button", { name: "Mark ready for review" });
    cta.focus();

    // The refreshed PrView flips draft=false: the CTA unmounts, Receipt
    // mounts in the terminal-action slot - focus follows the slot instead of
    // dropping to <body>.
    update(<Header {...headerProps(undefined)} />);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Submit" }),
    );
  });

  it("keeps slot focus continuity on the flip into own-draft", async () => {
    const { update } = await renderStageInRouter(
      <Header {...headerProps(undefined)} />,
      HEADER_STUB_PATHS,
    );
    screen.getByRole("button", { name: "Submit" }).focus();

    // The PR converts to draft under focus: Receipt unmounts, the mark-ready
    // CTA mounts in the same slot - focus follows.
    update(<Header {...headerProps({ markReady: vi.fn(), pending: false })} />);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
  });

  it("a consumed slot-focus flag does not steal focus on a later flip", async () => {
    const { update } = await renderStageInRouter(
      <Header {...headerProps(undefined)} />,
      HEADER_STUB_PATHS,
    );
    // Focus Receipt, then flip INTO own-draft (slot continuity moves focus
    // onto the CTA and consumes the flag)…
    screen.getByRole("button", { name: "Submit" }).focus();
    update(<Header {...headerProps({ markReady: vi.fn(), pending: false })} />);
    // …then the user moves on and works elsewhere. Any focusable header
    // control does; the PR link is one that does not depend on a feature
    // flag.
    const elsewhere = screen.getByRole("link", { name: /#7/ });
    elsewhere.focus();

    // A LATER external ready flip must leave the user's focus alone - a
    // stale `true` from the earlier swap would yank it onto Receipt.
    update(<Header {...headerProps(undefined)} />);
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /#7/ }),
    );
  });

  it("does NOT steal focus on the swap when the slot was not focused", async () => {
    const { update } = await renderStageInRouter(
      <Header {...headerProps({ markReady: vi.fn(), pending: false })} />,
      HEADER_STUB_PATHS,
    );
    // Focus never visited the terminal slot in this session.
    update(<Header {...headerProps(undefined)} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("shows a count-only flags stat in own-draft", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    const stat = screen.getByText("flags");
    // No resolved/total fraction - it would sit at a permanent 0/N.
    expect(stat.textContent).toBe("flags1");
    expect(stat.textContent).not.toContain("/");
  });

  it("drops the overflow menu in own-draft", async () => {
    await renderHeader({ ownDraft: { markReady: vi.fn(), pending: false } });
    expect(screen.queryByRole("button", { name: /more actions/i })).toBeNull();
  });
});
