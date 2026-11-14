// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import { readCookieValue } from "@web/utils/preference-cookie";
import { DIFF_VIEW_COOKIE } from "./diff-view/diff-view-storage";
import type { BriefSearchParams } from "../../../model/comparison/compare-state";
import { buildLocalComparisonPlan } from "../../../model/comparison/local-plan";
import {
  briefFixture,
  mountBriefView,
  type BriefViewOverrides,
} from "@web/features/brief/test-utils";

afterEach(() => {
  cleanup();
  document.cookie = `${DIFF_VIEW_COOKIE}=; Path=/; Max-Age=0`;
});

/** Carries a Previous Brief comparison, the Changes scope's precondition. */
const PREVIOUS_BRIEF_PLAN = buildLocalComparisonPlan({
  previousBrief: {
    marksId: "marks-a",
    baselineSha: "0".repeat(40),
    baselineIndex: 0,
  },
});

/** brief-a with its Previous Brief comparison available. */
const COMPARABLE_BRIEF: BriefViewOverrides = {
  briefId: "brief-a",
  comparisonPlan: PREVIOUS_BRIEF_PLAN,
};

function readStampedView(): string | null {
  const region = document.getElementById("main-content");
  if (region === null) {
    throw new Error("main-content not rendered");
  }
  return region.getAttribute("data-diff-view");
}

function readGroupViews(): string[] {
  return screen
    .queryAllByTestId("story-group")
    .map((section) => section.getAttribute("data-diff-view") ?? "");
}

function readToast(): string {
  return screen.getByTestId("brief-toast").textContent ?? "";
}

function pressD(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "d", cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function seedStored(view: DiffView): void {
  document.cookie = `${DIFF_VIEW_COOKIE}=${view}; Path=/`;
}

describe("the remembered diff view", () => {
  it("keeps a group with nothing deleted unified under the split view", async () => {
    seedStored(DiffViews.SPLIT);
    await mountBriefView(COMPARABLE_BRIEF);
    expect(readStampedView()).toBe(DiffViews.SPLIT);
    expect(readGroupViews().length).toBeGreaterThan(0);
    expect(new Set(readGroupViews())).toEqual(new Set([DiffViews.UNIFIED]));
  });

  it("splits a two-sided group while its code is still pending", async () => {
    const pendingTwoSided = {
      ...briefFixture,
      chunks: briefFixture.chunks.map((chunk) => {
        const { diff: _diff, ...pending } = chunk;
        return { ...pending, removedRanges: [{ start: 10, end: 10 }] };
      }),
    };
    seedStored(DiffViews.SPLIT);
    await mountBriefView({ ...COMPARABLE_BRIEF, brief: pendingTwoSided });
    expect(readGroupViews()).toContain(DiffViews.SPLIT);
  });

  it("lets the deep link override the stored view", async () => {
    seedStored(DiffViews.SPLIT);
    await mountBriefView({
      ...COMPARABLE_BRIEF,
      searchParams: { diff: DiffViews.UNIFIED },
    });
    expect(readStampedView()).toBe(DiffViews.UNIFIED);
  });
});

describe("announcing the diff view", () => {
  it("names the split view in the live region after D", async () => {
    await mountBriefView(COMPARABLE_BRIEF);

    fireEvent(window, new KeyboardEvent("keydown", { key: "d" }));

    expect(readStampedView()).toBe(DiffViews.SPLIT);
    await waitFor(() => expect(readToast()).toBe("Split view"));
  });

  it("names the split view in the live region after a click", async () => {
    await mountBriefView(COMPARABLE_BRIEF);

    fireEvent.click(screen.getByTestId("sidebar-diff-view"));

    expect(readStampedView()).toBe(DiffViews.SPLIT);
    await waitFor(() => expect(readToast()).toBe("Split view"));
  });
});

describe("the diff view toggle in the Changes scope", () => {
  const changesScope: BriefSearchParams = {
    view: "changes",
    compare: "previous-brief",
  };

  it("leaves D to the browser and announces nothing", async () => {
    await mountBriefView({ ...COMPARABLE_BRIEF, searchParams: changesScope });

    const event = pressD();

    expect(event.defaultPrevented).toBe(false);
    expect(readCookieValue(document.cookie, DIFF_VIEW_COOKIE)).toBeUndefined();
    expect(readToast()).toBe("");
  });
});
