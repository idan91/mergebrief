import { describe, expect, it } from "vitest";

import { appI18n } from "../../../../i18n/I18nProvider";
import {
  buildCappedCardDetail,
  buildCappedLabel,
  readCapResetsAt,
} from "./capped-head";

const t = appI18n.t;

describe("readCapResetsAt", () => {
  it("is the first UTC midnight after the skip", () => {
    expect(readCapResetsAt("2026-08-03T18:30:00.000Z")?.toISOString()).toBe(
      "2026-08-04T00:00:00.000Z",
    );
  });

  it("rolls a last-millisecond skip into the next day, not two days on", () => {
    expect(readCapResetsAt("2026-08-03T23:59:59.999Z")?.toISOString()).toBe(
      "2026-08-04T00:00:00.000Z",
    );
  });

  it("returns undefined for an unparsable timestamp", () => {
    expect(readCapResetsAt("not-a-date")).toBeUndefined();
  });
});

describe("buildCappedLabel", () => {
  it("names a reset time still in the future", () => {
    const label = buildCappedLabel(
      t,
      "2026-08-03T18:30:00.000Z",
      new Date("2026-08-03T19:00:00.000Z"),
    );
    expect(label).toContain("Daily generation cap reached. Resumes ");
  });

  it("says generation has resumed once the window rolled over", () => {
    // A stale capped row must not promise a reset time that already passed.
    const label = buildCappedLabel(
      t,
      "2026-08-01T18:30:00.000Z",
      new Date("2026-08-03T09:00:00.000Z"),
    );
    expect(label).toBe(
      "Daily generation cap reached. Generation has since resumed.",
    );
  });

  it("degrades without a time rather than printing Invalid Date", () => {
    expect(buildCappedLabel(t, "nonsense")).toBe(
      "Daily generation cap reached.",
    );
  });
});

describe("buildCappedCardDetail", () => {
  const LIMIT =
    "This instance limits how many briefs it generates per day, across every repository.";
  const OPEN_INSTALLED = {
    prState: "open",
    appInstalled: true,
    awaitsReadyForReview: false,
  } as const;

  it("points a draft its instance skips at ready for review", () => {
    const input = { ...OPEN_INSTALLED, awaitsReadyForReview: true };
    expect(buildCappedCardDetail(t, input)).toBe(
      `${LIMIT} Brief generation for draft pull requests is off on this instance, so marking this pull request ready for review after the reset queues a run.`,
    );
  });

  it("names the cap as the instance's and the next push on an open PR", () => {
    expect(buildCappedCardDetail(t, OPEN_INSTALLED)).toBe(
      `${LIMIT} This push will not be picked up again on its own. The next push after the reset is briefed as usual.`,
    );
  });

  it.each(["open", "closed", "merged"] as const)(
    "points a %s url row at a paste after the reset, not a push",
    (prState) => {
      expect(
        buildCappedCardDetail(t, {
          ...OPEN_INSTALLED,
          prState,
          appInstalled: false,
        }),
      ).toBe(
        `${LIMIT} Paste this pull request's URL on the home page after the reset to retry it.`,
      );
    },
  );

  it.each(["closed", "merged"] as const)(
    "promises no brief on a %s installation PR",
    (prState) => {
      expect(buildCappedCardDetail(t, { ...OPEN_INSTALLED, prState })).toBe(
        `${LIMIT} This pull request is no longer open, so no brief will generate.`,
      );
    },
  );
});
