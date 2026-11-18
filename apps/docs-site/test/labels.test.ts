import { createI18n, en, PSEUDO_LOCALE } from "i18n";
import { describe, expect, it } from "vitest";

import { readSiteLabels } from "../src/labels";

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  return typeof value === "object" && value !== null
    ? Object.values(value).flatMap(collectStrings)
    : [];
}

describe("readSiteLabels", () => {
  it("resolves every docsSite catalog key and nothing else", () => {
    const labels = readSiteLabels(createI18n().t);

    expect(collectStrings(labels).toSorted()).toEqual(
      collectStrings(en.docsSite).toSorted(),
    );
  });

  it("reads through the catalog rather than literals", () => {
    const labels = readSiteLabels(createI18n({ locale: PSEUDO_LOCALE }).t);

    expect(labels.sidebar.releases).not.toBe(en.docsSite.sidebar.releases);
  });
});
