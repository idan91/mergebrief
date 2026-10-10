// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import { briefFixture } from "@web/features/brief/fixtures";
import { DIFF_VIEW_STORAGE_KEY } from "../BriefScreen/diffViewStorage";
import type { BriefSearchParams } from "../../comparison/compareState";
import type { LocalBriefSummary } from "../../types";
import { mountBriefView, type BriefViewOverrides } from "../../test-utils";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** Carries a Previous Brief comparison, the Changes lens's precondition. */
const artifactSummaries: LocalBriefSummary[] = [
  {
    id: "brief-a",
    artifactKind: "brief",
    repo: briefFixture.pr.repo,
    number: briefFixture.pr.number,
    title: briefFixture.pr.title,
    sha: briefFixture.pr.sha,
    index: 1,
    comparisons: {
      previousBrief: {
        marksId: "marks-a",
        baselineSha: "0".repeat(40),
        baselineIndex: 0,
      },
    },
  },
];

/** brief-a with its Previous Brief comparison available. */
const COMPARABLE_BRIEF: BriefViewOverrides = {
  artifacts: artifactSummaries,
  briefId: "brief-a",
};

function readStampedView(): string | null {
  const region = document.getElementById("main-content");
  if (region === null) {
    throw new Error("main-content not rendered");
  }
  return region.getAttribute("data-diff-view");
}

function readGroupViews(): string[] {
  return Array.from(document.querySelectorAll("section.story-group")).map(
    (section) => section.getAttribute("data-diff-view") ?? "",
  );
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
  window.localStorage.setItem(DIFF_VIEW_STORAGE_KEY, JSON.stringify(view));
}

describe("the remembered diff view", () => {
  it("renders unified when nothing is stored and no param is set", async () => {
    await mountBriefView(COMPARABLE_BRIEF);
    expect(readStampedView()).toBe(DiffViews.UNIFIED);
  });

  it("picks up the stored view when no param is set", async () => {
    seedStored(DiffViews.SPLIT);
    await mountBriefView(COMPARABLE_BRIEF);
    expect(readStampedView()).toBe(DiffViews.SPLIT);
  });

  it("keeps a group with nothing deleted unified under the split view", async () => {
    seedStored(DiffViews.SPLIT);
    await mountBriefView(COMPARABLE_BRIEF);
    expect(readStampedView()).toBe(DiffViews.SPLIT);
    expect(readGroupViews().length).toBeGreaterThan(0);
    expect(new Set(readGroupViews())).toEqual(new Set([DiffViews.UNIFIED]));
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

  it("names the unified view on the way back", async () => {
    seedStored(DiffViews.SPLIT);
    await mountBriefView(COMPARABLE_BRIEF);

    fireEvent.click(screen.getByTestId("sidebar-diff-view"));

    expect(readStampedView()).toBe(DiffViews.UNIFIED);
    await waitFor(() => expect(readToast()).toBe("Unified view"));
  });
});

describe("the diff view toggle in the Changes lens", () => {
  const changesScope: BriefSearchParams = {
    view: "changes",
    compare: "previous-brief",
  };

  it("keeps the control out of the sidebar", async () => {
    await mountBriefView({ ...COMPARABLE_BRIEF, searchParams: changesScope });
    expect(screen.queryByTestId("sidebar-diff-view")).toBeNull();
  });

  it("leaves D to the browser and announces nothing", async () => {
    await mountBriefView({ ...COMPARABLE_BRIEF, searchParams: changesScope });

    const event = pressD();

    expect(event.defaultPrevented).toBe(false);
    expect(window.localStorage.getItem(DIFF_VIEW_STORAGE_KEY)).toBeNull();
    expect(readToast()).toBe("");
  });
});
