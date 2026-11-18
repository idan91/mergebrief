import { describe, expect, it } from "vitest";
import { PrStates } from "types";

import { appI18n } from "../../../../../i18n/I18nProvider";
import type { RerunNoteInput } from "../failed-head";
import { selectWaitDetail, selectWaitProgress } from "./utils";

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

describe("selectWaitProgress", () => {
  const STARTED_AT = "2026-10-28T09:12:00.000Z";

  it("answers nothing for a pending wait or a run with no facts", () => {
    expect(
      selectWaitProgress(t, {
        status: "pending",
        parts: { done: 1, total: 2 },
        startedAt: STARTED_AT,
        locale: "en",
      }),
    ).toBeUndefined();
    expect(
      selectWaitProgress(t, {
        status: "running",
        parts: undefined,
        startedAt: undefined,
        locale: "en",
      }),
    ).toBeUndefined();
  });

  it("counts the parts done, or names the parts planned at zero", () => {
    expect(
      selectWaitProgress(t, {
        status: "running",
        parts: { done: 23, total: 57 },
        startedAt: undefined,
        locale: "en",
      }),
    ).toBe("Part 23 of 57 done.");
    expect(
      selectWaitProgress(t, {
        status: "running",
        parts: { done: 0, total: 1 },
        startedAt: undefined,
        locale: "en",
      }),
    ).toBe("Generating in 1 part.");
  });

  it("formats the start time in the reader's locale", () => {
    const line = selectWaitProgress(t, {
      status: "running",
      parts: undefined,
      startedAt: STARTED_AT,
      locale: "en-GB",
    });

    expect(line).toMatch(/^Started \d{1,2}:\d{2}\.$/);
  });
});
