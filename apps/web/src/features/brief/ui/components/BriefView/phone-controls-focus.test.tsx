// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_QUERY } from "@web/hooks/useMobileViewport";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import type { Brief } from "../../../model/types";
import { buildLocalComparisonPlan } from "../../../model/comparison/local-plan";
import { briefFixture, mountBriefView } from "@web/features/brief/test-utils";

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  setMediaQueryMatches(MOBILE_QUERY, true);
});

afterEach(() => {
  cleanup();
  resetMediaQueries();
  window.sessionStorage.clear();
});

const PREVIOUS_BRIEF_PLAN = buildLocalComparisonPlan({
  previousBrief: {
    marksId: "marks-a",
    baselineSha: "0".repeat(40),
    baselineIndex: 0,
  },
});

async function focusBriefControls(): Promise<HTMLElement> {
  const phoneBar = await screen.findByTestId("phone-bar");
  const controls = within(phoneBar).getByRole("button", {
    name: "Brief controls",
  });
  controls.focus();
  return controls;
}

function readMainContent(): HTMLElement | null {
  return document.getElementById("main-content");
}

describe("focus when focus mode hides the phone bar", () => {
  it("lands on the main landmark after a read-through from Brief controls", async () => {
    await mountBriefView({ briefId: "brief-a" });
    fireEvent.click(await focusBriefControls());
    const sheet = await screen.findByTestId("brief-controls-sheet");

    fireEvent.click(
      within(sheet).getByRole("button", { name: "Start read-through" }),
    );

    await waitFor(() => expect(screen.queryByTestId("phone-bar")).toBeNull());
    expect(document.activeElement).toBe(readMainContent());
  });

  it("lands on the main landmark when Z enters focus from Changes only", async () => {
    await mountBriefView({
      briefId: "brief-a",
      comparisonPlan: PREVIOUS_BRIEF_PLAN,
      searchParams: { view: "changes", compare: "previous-brief" },
    });
    const controls = await focusBriefControls();

    fireEvent.keyDown(controls, { key: "z" });

    await waitFor(() => expect(screen.queryByTestId("phone-bar")).toBeNull());
    expect(document.activeElement).toBe(readMainContent());
  });
});

const NEXT_BRIEF: Brief = {
  ...briefFixture,
  pr: { ...briefFixture.pr, sha: "b".repeat(40) },
};

describe("phone sheets over a brief switch", () => {
  it("closes Brief controls and lands focus on its button", async () => {
    const view = await mountBriefView({ briefId: "brief-a" });
    fireEvent.click(await focusBriefControls());
    await screen.findByTestId("brief-controls-sheet");

    view.rerender({ briefId: "brief-b", brief: NEXT_BRIEF });

    expect(screen.queryByTestId("brief-controls-sheet")).toBeNull();
    const phoneBar = screen.getByTestId("phone-bar");
    expect(document.activeElement).toBe(
      within(phoneBar).getByRole("button", { name: "Brief controls" }),
    );
  });
});
