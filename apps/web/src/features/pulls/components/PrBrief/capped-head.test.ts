import { describe, expect, it } from "vitest";

import { appI18n } from "../../../../i18n/I18nProvider";
import { buildCappedLabel, readCapResetsAt } from "./capped-head";

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
    expect(label).toContain("Daily generation cap reached — resumes ");
  });

  it("says generation has resumed once the window rolled over", () => {
    // A stale capped row must not promise a reset time that already passed.
    const label = buildCappedLabel(
      t,
      "2026-08-01T18:30:00.000Z",
      new Date("2026-08-03T09:00:00.000Z"),
    );
    expect(label).toBe(
      "Daily generation cap reached — generation has since resumed.",
    );
  });

  it("degrades without a time rather than printing Invalid Date", () => {
    expect(buildCappedLabel(t, "nonsense")).toBe(
      "Daily generation cap reached.",
    );
  });
});
