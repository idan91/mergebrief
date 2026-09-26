// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderInRouter } from "../../../../../../test/router";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import type { BriefTimeline } from "../../../../utils/timeline";
import { TimelineNavigator } from ".";

afterEach(() => {
  cleanup();
  resetMediaQueries();
});

beforeEach(() => {
  setMediaQueryMatches("(prefers-reduced-motion: reduce)", true);
});

const POINTS: BriefTimeline["points"] = [
  { briefId: "brief-1", headSha: "1111111aaaa", index: 1, comparisons: {} },
  { briefId: "brief-2", headSha: "2222222bbbb", index: 2, comparisons: {} },
  { briefId: "brief-3", headSha: "3333333cccc", index: 3, comparisons: {} },
];

function renderAt(position: number, initialEntry = "/") {
  const selectedPoint = POINTS[position];
  return renderInRouter(
    <TimelineNavigator
      availability={{ previousBrief: false, lastReview: false }}
      briefId={selectedPoint?.briefId ?? ""}
      compareState={{ view: "full", compare: "off" }}
      timeline={{ points: POINTS, selectedPoint }}
    />,
    undefined,
    ["/briefs/$briefId"],
    initialEntry,
  );
}

describe("TimelineNavigator", () => {
  it("links the previous and next briefs from a middle point", async () => {
    await renderAt(1);

    const previous = screen.getByRole("link", { name: /previous/i });
    const next = screen.getByRole("link", { name: /next/i });
    expect(previous.getAttribute("href")).toBe("/briefs/brief-1");
    expect(next.getAttribute("href")).toBe("/briefs/brief-3");
  });

  it("leaves the link behind on the way to another brief", async () => {
    await renderAt(1, "/?view=full&l=c1.R10");

    const previous = screen.getByRole("link", { name: /previous/i });
    const next = screen.getByRole("link", { name: /next/i });
    expect(previous.getAttribute("href")).toBe("/briefs/brief-1?view=full");
    expect(next.getAttribute("href")).toBe("/briefs/brief-3?view=full");
  });

  it("keeps the link on a lens write", async () => {
    const { router } = await renderAt(1, "/?l=c2.R4");

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: /changes only/i }));
    });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/briefs/brief-2"),
    );
    // No comparison is available, so the view normalizes back to full.
    expect(router.state.location.search).toEqual({
      view: "full",
      compare: "off",
      l: "c2.R4",
    });
  });

  it("draws a disabled square where there is no previous brief", async () => {
    await renderAt(0);

    expect(screen.queryByRole("link", { name: /previous/i })).toBeNull();
    const disabled = document.querySelectorAll('[data-state="disabled"]');
    expect(disabled.length).toBe(1);
    expect(screen.getByRole("link", { name: /next/i })).toBeTruthy();
  });

  it("lists every point in the picker with the selected one chosen", async () => {
    await renderAt(2);

    const picker = screen.getByRole("button", { name: /Select PR revision/ });
    expect(picker.textContent).toContain("3333333");
    await act(async () => {
      fireEvent.click(picker);
    });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[2]?.getAttribute("aria-selected")).toBe("true");
  });

  it("choosing a point in the picker navigates to that brief", async () => {
    const { router } = await renderAt(2);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Select PR revision/ }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0]!);
    });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/briefs/brief-1"),
    );
  });
});
