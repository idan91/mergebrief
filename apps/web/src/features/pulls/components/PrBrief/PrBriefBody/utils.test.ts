import { describe, expect, it } from "vitest";

import { appI18n } from "../../../../../i18n/I18nProvider";
import type { SupersededStopSource } from "../../../utils/pr-state";
import {
  readEmptyCopyOverride,
  readSupersededAnnouncementKey,
  type EmptyCopySource,
} from "./utils";

const OPEN_INSTALLED: SupersededStopSource = {
  state: "open",
  appInstalled: true,
};

describe("readSupersededAnnouncementKey", () => {
  it("announces a newer push on an open installation PR", () => {
    expect(readSupersededAnnouncementKey(OPEN_INSTALLED)).toBe(
      "pulls.announce.superseded",
    );
  });

  it("announces the stop on a closed PR", () => {
    const closed = { ...OPEN_INSTALLED, state: "closed" as const };

    expect(readSupersededAnnouncementKey(closed)).toBe(
      "pulls.announce.supersededNotOpen",
    );
  });
});

describe("readEmptyCopyOverride", () => {
  const OPEN_META: EmptyCopySource = { appInstalled: true, state: "open" };

  it("keeps the default line on an open installation PR", () => {
    expect(readEmptyCopyOverride(appI18n.t, OPEN_META)).toBeUndefined();
  });

  it("promises no brief on a closed installation PR", () => {
    const closed = { ...OPEN_META, state: "closed" as const };

    expect(readEmptyCopyOverride(appI18n.t, closed)).toBe(
      appI18n.t("pulls.empty.notOpenCopy"),
    );
  });
});
