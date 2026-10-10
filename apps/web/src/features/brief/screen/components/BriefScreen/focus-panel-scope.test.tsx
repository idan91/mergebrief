// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComparisonMarks } from "../../../model/types";
import { briefFixture } from "@web/features/brief/fixtures";
import { mountBriefView } from "../../../test-utils";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const lastReviewMarks: ComparisonMarks = {
  baselineSha: "chk1234",
  headSha: briefFixture.pr.sha,
  baselineLabel: "checkpoint",
  baselineIndex: 1,
  files: [],
};

describe("focus panel scope", () => {
  it("keeps the panel and its Escape claim out of Changes scope", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefView({
      comparisonPlan: {
        lastReview: {
          marks: {
            queryKey: ["test-focus-scope-marks"],
            queryFn: () => Promise.resolve(lastReviewMarks),
          },
        },
      },
      searchParams: { view: "changes", compare: "last-review" },
    });

    fireEvent.keyDown(window, { key: "z" });
    await screen.findByTestId("focus-indicator");
    expect(screen.queryByTestId("focus-panel")).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("focus-indicator")).toBeNull(),
    );
  });
});
