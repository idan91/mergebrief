// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";
import type { BriefSearchParams } from "../../../model/comparison/compareState";
import type { ComparisonMarks } from "../../../model/types";
import { briefFixture } from "@web/features/brief/fixtures";
import { FixtureBriefView, mountBriefHost } from "../../../test-utils";

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

function Harness() {
  const [search, setSearch] = useState<BriefSearchParams>({
    view: "changes",
    compare: "last-review",
  });

  return (
    <>
      <Button
        onClick={() => setSearch({ view: "full", compare: "last-review" })}
      >
        to full
      </Button>
      <FixtureBriefView
        comparisonPlan={{
          lastReview: {
            marks: {
              queryKey: ["test-last-review-marks"],
              queryFn: () => Promise.resolve(lastReviewMarks),
            },
          },
        }}
        exitChangesScope={() =>
          setSearch({ view: "full", compare: "last-review" })
        }
        searchParams={search}
      />
    </>
  );
}

function viewedBoxes(): HTMLInputElement[] {
  return screen
    .getAllByRole("checkbox", { name: /Viewed/ })
    .filter((box): box is HTMLInputElement => box instanceof HTMLInputElement);
}

describe("V in Changes scope", () => {
  it("marks nothing viewed in Changes and the active chunk in Full", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefHost(<Harness />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "to full" })).toBeTruthy(),
    );

    fireEvent.keyDown(window, { key: "z" });
    fireEvent.keyDown(window, { key: "v" });
    fireEvent.click(screen.getByRole("button", { name: "to full" }));

    await waitFor(() => expect(viewedBoxes().length).toBeGreaterThan(0));
    expect(viewedBoxes().some((box) => box.checked)).toBe(false);

    fireEvent.keyDown(window, { key: "v" });

    await waitFor(() =>
      expect(viewedBoxes().filter((box) => box.checked)).toHaveLength(1),
    );
  });
});
