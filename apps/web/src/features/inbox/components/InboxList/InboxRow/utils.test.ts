import { appI18n } from "../../../../../i18n/I18nProvider";
import { describe, expect, it } from "vitest";

import { formatAgeLabel, readRowTitle } from "./utils";

const now = new Date("2026-09-20T12:00:00Z");
const t = appI18n.t;

describe("formatAgeLabel", () => {
  it.each([
    ["2026-09-20T11:38:00Z", "22m ago"],
    ["2026-09-20T09:10:00Z", "2h ago"],
    ["2026-09-19T02:00:00Z", "yesterday"],
    ["2026-09-15T12:00:00Z", "5d ago"],
  ])("%s reads as %s", (at, label) => {
    expect(formatAgeLabel(t, at, now)).toBe(label);
  });

  it("past two weeks it is a short date", () => {
    expect(formatAgeLabel(t, "2026-08-01T12:00:00Z", now)).toMatch(/Aug/);
  });
});

describe("readRowTitle", () => {
  it("a blank title falls back like a missing one", () => {
    expect(readRowTitle("Fix the thing")).toBe("Fix the thing");
    expect(readRowTitle("   ")).toBeUndefined();
    expect(readRowTitle("")).toBeUndefined();
    expect(readRowTitle(null)).toBeUndefined();
  });
});
