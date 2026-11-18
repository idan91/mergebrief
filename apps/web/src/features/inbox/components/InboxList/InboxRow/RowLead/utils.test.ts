import { InboxReviewStates } from "types/inbox";
import { describe, expect, it } from "vitest";

import { appI18n } from "@web/i18n/I18nProvider";
import { UnknownValues } from "@web/utils/open-enum/types";

import { readReviewStateTip } from "./utils";

const t = appI18n.t;

describe("readReviewStateTip", () => {
  it("names a known review state", () => {
    expect(readReviewStateTip(t, InboxReviewStates.REVIEWED)).toBe("Reviewed");
  });

  it("names the viewer's own pull request", () => {
    expect(readReviewStateTip(t, undefined)).toBe(
      "Yours: you opened this pull request",
    );
  });

  it("gives an unknown review state no callout", () => {
    expect(readReviewStateTip(t, UnknownValues.UNKNOWN)).toBeUndefined();
  });
});
