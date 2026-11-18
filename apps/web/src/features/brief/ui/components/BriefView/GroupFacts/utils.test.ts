import { describe, expect, it } from "vitest";

import { RiskSurfaceAttributes } from "brief-core/types";
import { appI18n } from "@web/i18n/I18nProvider";
import { briefFixture } from "@web/features/brief/test-utils/fixtures";
import { GroupViewKinds } from "../../../../model/utils/remainder";
import {
  buildBriefViewModel,
  type GroupView,
} from "../../../../model/utils/view-model";
import { hasLineTotal, resolveGroupSummary } from "./utils";

function readRemainder(
  addedRanges: { start: number; end: number }[],
): GroupView {
  const model = buildBriefViewModel({
    ...briefFixture,
    unattributed: [
      {
        file: ".npmrc",
        addedRanges,
        removedRanges: [],
        riskSurface: [RiskSurfaceAttributes.CHANGES_PACKAGE_SOURCE],
      },
    ],
  });
  const remainder = model.groups.find(
    (group) => group.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER,
  );
  if (remainder === undefined) {
    throw new Error("model has no remainder group");
  }
  return remainder;
}

describe("resolveGroupSummary", () => {
  it("keeps the model's summary for an attributed group", () => {
    const model = buildBriefViewModel(briefFixture);
    const group = model.groups[0];
    if (group === undefined) {
      throw new Error("fixture has no group");
    }

    expect(resolveGroupSummary(appI18n.t, group)).toBe(
      briefFixture.changeGroups[0]?.summary,
    );
  });

  it("says the model skipped lines when the remainder holds some", () => {
    const remainder = readRemainder([{ start: 1, end: 2 }]);

    expect(resolveGroupSummary(appI18n.t, remainder)).toBe(
      appI18n.t("brief.unattributed.remainderSummary"),
    );
  });

  it("names the flags when the remainder holds no changed line", () => {
    const remainder = readRemainder([]);

    expect(resolveGroupSummary(appI18n.t, remainder)).toBe(
      appI18n.t("brief.unattributed.flagsOnlySummary"),
    );
  });
});

describe("hasLineTotal", () => {
  it("draws a total for an attributed group", () => {
    const group = buildBriefViewModel(briefFixture).groups[0];
    if (group === undefined) {
      throw new Error("fixture has no group");
    }

    expect(hasLineTotal(group)).toBe(true);
  });

  it("draws a total for a remainder that holds changed lines", () => {
    expect(hasLineTotal(readRemainder([{ start: 1, end: 2 }]))).toBe(true);
  });

  it("draws none for a remainder of flags alone", () => {
    expect(hasLineTotal(readRemainder([]))).toBe(false);
  });
});
