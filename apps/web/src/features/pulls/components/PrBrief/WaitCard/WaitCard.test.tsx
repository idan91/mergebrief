// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WaitReasons } from "contract";
import { PrStates } from "types";
import { I18nProvider } from "../../../../../i18n/I18nProvider";

import type { RerunNoteInput } from "../failed-head";
import { WaitCard } from ".";

const OPEN_INSTALLED: RerunNoteInput = {
  prState: PrStates.OPEN,
  appInstalled: true,
  awaitsReadyForReview: false,
};
const STALLED_LINE =
  "Generation for this push stopped: its queued job used every attempt.";

describe("WaitCard on a stalled head", () => {
  it("names no brief coming and shows no spinner", () => {
    render(
      <I18nProvider>
        <WaitCard
          phase={undefined}
          prNumber={7}
          repoId="42"
          span={undefined}
          rerun={OPEN_INSTALLED}
          status="pending"
          waitReason={WaitReasons.STALLED}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("heading").textContent).toBe(STALLED_LINE);
    expect(
      screen.getByText(/^No brief is on the way for this push\. A new push/),
    ).toBeTruthy();
    expect(screen.queryByTestId("empty-block-spinner")).toBeNull();
  });

  it("points a stalled url row at a paste", () => {
    const urlRow = { ...OPEN_INSTALLED, appInstalled: false };
    render(
      <I18nProvider>
        <WaitCard
          phase={undefined}
          prNumber={7}
          repoId="42"
          rerun={urlRow}
          span={undefined}
          status="pending"
          waitReason={WaitReasons.STALLED}
        />
      </I18nProvider>,
    );

    expect(
      screen.getByText(/Paste this pull request's URL on the home page/),
    ).toBeTruthy();
  });
});
