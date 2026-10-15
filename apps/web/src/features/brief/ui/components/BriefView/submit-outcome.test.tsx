// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { appI18n } from "../../../../../i18n/I18nProvider";

import type { ReviewSessionPayload } from "../../../../review/session";
import {
  SubmitReviewResultKinds,
  type SubmitDraftInput,
  type SubmitReviewResult,
} from "../../../../review/utils";
import { mountBriefView } from "@web/features/brief/test-utils";

const OUTCOME_LEGEND = appI18n.t("review.submit.outcomeLegend");
const CONTINUE_TO_VERDICT = appI18n.t("review.submit.continueAction");

function buildSessionPayload(
  reviewOutcome: ReviewSessionPayload["reviewOutcome"],
): ReviewSessionPayload {
  return {
    materialized: true,
    attention: [],
    reviewOutcome,
    draftComments: [],
    readMarks: [],
    reclassifications: [],
    dispositions: [],
    submittedReviewIds: [],
  };
}

function stubSubmitReview() {
  return vi.fn<(draft: SubmitDraftInput) => Promise<SubmitReviewResult>>(() =>
    Promise.resolve({
      kind: SubmitReviewResultKinds.SUBMITTED,
      reviewId: 1,
      commentsFolded: 0,
      commentsTotal: 0,
    }),
  );
}

async function openSubmitModal(
  reviewOutcome: ReviewSessionPayload["reviewOutcome"],
) {
  const submitReview = stubSubmitReview();
  await mountBriefView({
    session: buildSessionPayload(reviewOutcome),
    submitReview,
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  fireEvent.click(screen.getByRole("button", { name: CONTINUE_TO_VERDICT }));
  return submitReview;
}

function readSubmitDisabled(): string | null {
  return screen
    .getByRole("button", { name: /^submit review$/i })
    .getAttribute("aria-disabled");
}

function clickSubmitReview(): void {
  fireEvent.click(screen.getByRole("button", { name: /^submit review$/i }));
}

function listCheckedOutcomes(): HTMLInputElement[] {
  return within(screen.getByRole("group", { name: OUTCOME_LEGEND }))
    .getAllByRole<HTMLInputElement>("radio")
    .filter((radio) => radio.checked);
}

describe("submit under a stored outcome this bundle does not know", () => {
  it("checks no outcome and keeps submit disabled with a reason", async () => {
    const submitReview = await openSubmitModal("unknown");

    expect(listCheckedOutcomes()).toEqual([]);
    expect(readSubmitDisabled()).toBe("true");
    expect(screen.getByText(/pick an outcome/i)).toBeTruthy();

    clickSubmitReview();
    expect(submitReview).not.toHaveBeenCalled();
  });

  it("enables submit once an outcome is picked and sends that one", async () => {
    const submitReview = await openSubmitModal("unknown");

    fireEvent.click(screen.getByRole("radio", { name: "Approve" }));
    expect(readSubmitDisabled()).toBeNull();
    clickSubmitReview();

    await waitFor(() => expect(submitReview).toHaveBeenCalledTimes(1));
    expect(submitReview.mock.calls[0]?.[0].outcome).toBe("approve");
  });

  it("starts a known stored outcome checked and submittable", async () => {
    await openSubmitModal("request-changes");

    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: "Request changes" })
        .checked,
    ).toBe(true);
    expect(readSubmitDisabled()).toBeNull();
  });
});
