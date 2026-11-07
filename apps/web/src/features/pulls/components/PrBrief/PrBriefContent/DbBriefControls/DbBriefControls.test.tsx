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
  it("holds no live region, since a phone hides the header it sits in", () => {
    render(makeControls(GENERATING));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("newer-commits-chip")).toBeTruthy();
  });
});
