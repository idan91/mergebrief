// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../../i18n/I18nProvider";
import { DbBriefControls } from ".";
import { NewerCommitsStates } from "./NewerCommitsChip/types";
import type { NewerCommitsChipState } from "./NewerCommitsChip/types";

afterEach(cleanup);

function makeControls(newerCommits: NewerCommitsChipState) {
  return (
    <I18nProvider>
      <DbBriefControls
        compare={{
          availability: { previousBrief: false, lastReview: false },
          compareState: { view: "full", compare: "off" },
          onNavigate: () => undefined,
        }}
        newerCommits={newerCommits}
      />
    </I18nProvider>
  );
}

const GENERATING: NewerCommitsChipState = {
  announcement: "New brief queued.",
  status: {
    state: NewerCommitsStates.GENERATING,
    label: "Newer commits",
    infoLabel: "About newer commits",
    statusLabel: "Generating new brief",
    title: "Generating new brief",
    explanation: [],
  },
};

describe("DbBriefControls", () => {
  it("announces the chip's outcomes from one live region", () => {
    render(makeControls(GENERATING));

    const regions = screen.getAllByRole("status");
    expect(regions).toHaveLength(1);
    expect(regions[0]?.textContent).toBe("New brief queued.");
  });

  it("keeps the region once the chip leaves", () => {
    const view = render(makeControls(GENERATING));

    view.rerender(makeControls({ announcement: "The new brief is ready." }));

    expect(screen.queryByTestId("newer-commits-chip")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      "The new brief is ready.",
    );
  });
});
