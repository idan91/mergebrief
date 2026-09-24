// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderInRouter } from "../../../../../../test/router";
import type { BriefTimeline } from "../../../../utils/timeline";
import { TimelineNavigator } from "./TimelineNavigator";

afterEach(cleanup);

const POINTS: BriefTimeline["points"] = [
  { briefId: "brief-1", headSha: "1111111aaaa", index: 1, comparisons: {} },
  { briefId: "brief-2", headSha: "2222222bbbb", index: 2, comparisons: {} },
  { briefId: "brief-3", headSha: "3333333cccc", index: 3, comparisons: {} },
];

function renderAt(position: number) {
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

  it("draws a disabled square where there is no previous brief", async () => {
    await renderAt(0);

    expect(screen.queryByRole("link", { name: /previous/i })).toBeNull();
    const disabled = document.querySelectorAll('[data-state="disabled"]');
    expect(disabled.length).toBe(1);
    expect(screen.getByRole("link", { name: /next/i })).toBeTruthy();
  });

  it("lists every point in the picker with the selected one chosen", async () => {
    await renderAt(2);

    const picker = screen.getByRole("combobox");
    expect(picker.querySelectorAll("option").length).toBe(3);
    expect((picker as HTMLSelectElement).value).toBe("brief-3");
  });
});
