import { appI18n } from "../../../../../i18n/I18nProvider";
import { describe, expect, it } from "vitest";

import type { InboxItem } from "../../../types";
import { describeRow, formatAgeLabel, readRowTitle } from "./utils";

const now = new Date("2026-09-20T12:00:00Z");
const t = appI18n.t;
const AT = "2026-09-20T10:00:00Z";

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
    expect(readRowTitle(undefined)).toBeUndefined();
  });
});

describe("describeRow", () => {
  it("names an awaiting head on demand in the row link", () => {
    const item: InboxItem = {
      repoId: "424242",
      prNumber: 7,
      state: "open",
      draft: false,
      source: "installation",
      viewerIsAuthor: true,
      viewerCanDelete: false,
      viewerCanPush: false,
      generateEveryPush: false,
      behind: false,
      unreachable: false,
    };

    expect(
      describeRow(t, item, { status: "awaiting-trigger", updatedAt: AT }),
    ).toContain("On demand.");
  });

  it("names a merged PR's waiting head merged, not on demand", () => {
    const item: InboxItem = {
      repoId: "424242",
      prNumber: 7,
      state: "merged",
      draft: false,
      source: "installation",
      viewerIsAuthor: true,
      viewerCanDelete: false,
      viewerCanPush: false,
      generateEveryPush: false,
      behind: false,
      unreachable: false,
    };

    const label = describeRow(t, item, {
      status: "awaiting-trigger",
      updatedAt: AT,
    });
    expect(label).toContain("Merged.");
    expect(label).not.toContain("On demand");
  });
});
