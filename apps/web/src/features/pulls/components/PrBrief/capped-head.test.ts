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
  const SKIPPED_AT = "2026-08-03T18:30:00.000Z";

  it("names a reset time still in the future", () => {
    const label = buildCappedLabel(
      t,
      { cappedAt: "2026-08-03T18:30:00.000Z" },
      new Date("2026-08-03T19:00:00.000Z"),
    );
    expect(label).toContain("Daily generation cap reached. Resumes ");
  });

  it("says generation has resumed once the window rolled over", () => {
    // A stale capped row must not promise a reset time that already passed.
    const label = buildCappedLabel(
      t,
      { cappedAt: "2026-08-01T18:30:00.000Z" },
      new Date("2026-08-03T09:00:00.000Z"),
    );
    expect(label).toBe(
      "Daily generation cap reached. Generation has since resumed.",
    );
  });

  it("degrades without a time rather than printing Invalid Date", () => {
    expect(buildCappedLabel(t, { cappedAt: "nonsense" })).toBe(
      "Daily generation cap reached.",
    );
  });

  it("names the runs a large run lacked, not a reached cap", () => {
    const label = buildCappedLabel(
      t,
      { cappedAt: SKIPPED_AT, units: { needed: 9, left: 4, cap: 20 } },
      new Date("2026-08-03T19:00:00.000Z"),
    );
    expect(label).toContain(
      "Too few runs were left to brief this pull request. Resumes ",
    );
    expect(label).not.toMatch(/cap reached/);
  });

  it("promises no resume time when no day fits the run", () => {
    const label = buildCappedLabel(
      t,
      { cappedAt: SKIPPED_AT, units: { needed: 9, left: 4, cap: 9 } },
      new Date("2026-08-03T19:00:00.000Z"),
    );
    expect(label).toBe(
      "This pull request is too large for this instance's daily cap.",
    );
  });
});

describe("buildCappedCardDetail", () => {
  const LIMIT =
    "This instance limits how many briefs it generates per day, across every repository.";
  const OPEN_INSTALLED = {
    prState: "open",
    appInstalled: true,
  } as const;

  it("names the runs a large pull request needed in place of the limit", () => {
    const units = { needed: 9, left: 4, cap: 20 };
    const input = { ...OPEN_INSTALLED, units };
    expect(buildCappedCardDetail(t, input)).toBe(
      "This pull request needs 9 more runs to be briefed in parts, and this instance had 4 left today. This push will not be picked up again on its own. The next push after the reset is briefed as usual.",
    );
  });

  it("names the cap in place of the next push when no day fits the run", () => {
    const units = { needed: 9, left: 4, cap: 9 };
    const input = { ...OPEN_INSTALLED, appInstalled: false, units };
    expect(buildCappedCardDetail(t, input)).toBe(
      "This pull request needs 9 more runs to be briefed in parts, and this instance's daily cap of 9 cannot fit that in one day. No push or retry is briefed until the instance operator raises the daily cap.",
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
