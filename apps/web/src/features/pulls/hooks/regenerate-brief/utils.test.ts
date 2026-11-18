import { describe, expect, it } from "vitest";

import { createI18n } from "i18n";

import { RegenerateResultKinds } from "../../types";
import { readRegenerateNotice, refreshesMeta } from "./utils";

const { t } = createI18n();

describe("readRegenerateNotice", () => {
  it("says nothing on queued, since the card swap is announced", () => {
    expect(readRegenerateNotice(t, RegenerateResultKinds.QUEUED)).toBe(
      undefined,
    );
  });

  it("reads the wire copy for the two refusals", () => {
    expect(readRegenerateNotice(t, RegenerateResultKinds.HELD)).toBe(
      "A brief is already generating for this push. It shows here when it finishes.",
    );
    expect(readRegenerateNotice(t, RegenerateResultKinds.NOT_REGENERABLE)).toBe(
      "This push's brief can't be regenerated. Reload to see where it stands.",
    );
  });

  it("names both requirements when the route refused the viewer", () => {
    expect(readRegenerateNotice(t, RegenerateResultKinds.NOT_ALLOWED)).toBe(
      "Regenerating needs push access to this repository and the MergeBrief App installed on it.",
    );
  });

  it("never claims nothing happened on an indeterminate answer", () => {
    expect(
      readRegenerateNotice(t, RegenerateResultKinds.INDETERMINATE),
    ).toMatch(/could not confirm/);
  });
});

describe("refreshesMeta", () => {
  it("refreshes on queued and both refusals only", () => {
    const refreshing = Object.values(RegenerateResultKinds).filter((kind) =>
      refreshesMeta(kind),
    );

    expect(refreshing).toEqual([
      RegenerateResultKinds.QUEUED,
      RegenerateResultKinds.HELD,
      RegenerateResultKinds.NOT_REGENERABLE,
    ]);
  });
});
