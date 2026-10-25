import { describe, expect, it } from "vitest";
import { PrStates } from "types";

import { appI18n } from "../../../../../i18n/I18nProvider";
import type { RerunNoteInput } from "../failed-head";
import { selectWaitDetail } from "./utils";

const t = appI18n.t;
const STALLED_DETAIL = "No brief is on the way for this push.";
const OPEN_INSTALLED: RerunNoteInput = {
  prState: PrStates.OPEN,
  appInstalled: true,
  awaitsReadyForReview: false,
};

function readStalledDetail(rerun: RerunNoteInput): string {
  return selectWaitDetail(t, { span: undefined, stalled: true, rerun });
}

describe("selectWaitDetail on a stalled head", () => {
  it("names the triggers that queue an installed head's next run", () => {
    expect(readStalledDetail(OPEN_INSTALLED)).toBe(
      `${STALLED_DETAIL} A new push, a submitted review or a review request queues a new run.`,
    );
  });

  it("points a url row at a paste", () => {
    const urlRow = { ...OPEN_INSTALLED, appInstalled: false };

    expect(readStalledDetail(urlRow)).toBe(
      `${STALLED_DETAIL} Paste this pull request's URL on the home page to retry it.`,
    );
  });

  it("points a held draft at ready for review", () => {
    const heldDraft = { ...OPEN_INSTALLED, awaitsReadyForReview: true };

    expect(readStalledDetail(heldDraft)).toContain(
      "marking this pull request ready for review",
    );
  });

  it("names no rerun on a closed PR", () => {
    const closed = { ...OPEN_INSTALLED, prState: PrStates.CLOSED };

    expect(readStalledDetail(closed)).toContain("no longer open");
  });
});

describe("selectWaitDetail while a brief is coming", () => {
  it("names the diff the wait will show", () => {
    const detail = selectWaitDetail(t, {
      span: undefined,
      stalled: false,
      rerun: OPEN_INSTALLED,
    });

    expect(detail).toBe(t("pulls.wait.diffPending"));
  });
});
