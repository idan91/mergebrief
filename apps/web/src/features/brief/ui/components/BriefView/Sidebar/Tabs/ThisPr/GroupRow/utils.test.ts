import { describe, expect, it } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { appI18n } from "@web/i18n/I18nProvider";
import { GroupViewKinds } from "../../../../../../../model/utils/remainder";
import { buildBriefViewModel } from "../../../../../../../model/utils/view-model";
import { getChunkCountsLabel } from "./utils";

const first = buildBriefViewModel(briefFixture).groups[0];
if (!first || first.kind !== GroupViewKinds.ATTRIBUTED) {
  throw new Error("fixture has no attributed group");
}
const core = first.coreChunks.length;

describe("getChunkCountsLabel", () => {
  it("returns the core count alone with no supporting chunk", () => {
    const label = getChunkCountsLabel(appI18n.t, {
      ...first,
      supportingChunks: [],
    });

    expect(label).toBe(`${core} core`);
  });

  it("returns core and supporting counts once a group has some", () => {
    const label = getChunkCountsLabel(appI18n.t, {
      ...first,
      supportingChunks: [...first.coreChunks, ...first.coreChunks],
    });

    expect(label).toBe(`${core} core · ${2 * core} supporting`);
  });
});
