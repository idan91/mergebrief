// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderInRouter } from "../../../../../../../test/router";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import { ComparisonControls } from ".";

afterEach(() => {
  cleanup();
  resetMediaQueries();
});

beforeEach(() => {
  setMediaQueryMatches("(prefers-reduced-motion: reduce)", true);
});

function renderControls(initialEntry = "/") {
  return renderInRouter(
    <ComparisonControls
      availability={{ previousBrief: false, lastReview: false }}
      briefId="brief-2"
      compareState={{ view: "full", compare: "off" }}
    />,
    undefined,
    ["/briefs/$briefId"],
    initialEntry,
  );
}

describe("ComparisonControls", () => {
  it("keeps the link on a scope write", async () => {
    const { router } = await renderControls("/?l=c2.R4");

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
});
