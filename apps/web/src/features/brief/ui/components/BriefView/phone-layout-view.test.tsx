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
import type { BriefAddressPort } from "./address/types";
import { buildFileAddress } from "./address/utils";
import { buildLocalComparisonPlan } from "../../../model/comparison/local-plan";
import { useBriefReading } from "../../hooks/useBriefReading";
import {
  briefFixture,
  briefSummaryFixture,
  mountBriefHost,
  mountBriefView,
} from "@web/features/brief/test-utils";
import { BriefView } from ".";

function ignoreWrite(): void {}

const IGNORED_PORT: BriefAddressPort = {
  link: undefined,
  navigateLink: ignoreWrite,
  setFocusParam: ignoreWrite,
  clearDiffParam: ignoreWrite,
  navigateSearch: ignoreWrite,
};

function WideViewportHost() {
  const reading = useBriefReading({
    brief: briefFixture,
    briefId: briefSummaryFixture.id,
  });
  const address = buildFileAddress({
    port: IGNORED_PORT,
    searchParams: {},
    revisionPending: false,
  });

  return <BriefView reading={reading} address={address} />;
}

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

describe("the phone bar before the viewport is read", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("is in the markup a wide read renders, for CSS to show on phones", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefHost(<WideViewportHost />);

    await waitFor(() => expect(screen.getByTestId("phone-bar")).toBeTruthy());
    expect(document.querySelector("[data-phone-bar]")).not.toBeNull();
  });
});

describe("focus when focus mode hides the phone bar", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    setMediaQueryMatches(MOBILE_QUERY, true);
  });

  afterEach(() => {
    cleanup();
    resetMediaQueries();
    window.sessionStorage.clear();
  });

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
