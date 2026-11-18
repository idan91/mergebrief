import { describe, expect, it } from "vitest";
import {
  compareReleaseVersions,
  formatReleaseVersion,
  parseReleaseVersion,
  pickHighestStable,
} from "../src/logic/version";

describe("the release version grammar", () => {
  it("parses a stable version with or without the tag prefix", () => {
    expect(parseReleaseVersion("0.1.0")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
    });
    expect(parseReleaseVersion("v2.10.3")).toEqual({
      major: 2,
      minor: 10,
      patch: 3,
    });
  });

  it("parses a release candidate", () => {
    expect(parseReleaseVersion("0.2.0-rc.3")).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      rc: 3,
    });
  });

  it("refuses anything outside X.Y.Z with an optional rc.N", () => {
    const rejected = [
      "0.1",
      "0.1.0-beta.1",
      "0.1.0-rc",
      "01.0.0",
      "1.2.3.4",
      "",
      "latest",
    ];
    expect(rejected.map((text) => parseReleaseVersion(text))).toEqual(
      rejected.map(() => undefined),
    );
  });

  it("orders candidates before their release and releases by number", () => {
    const sorted = ["0.1.1", "0.1.0", "0.1.0-rc.2", "0.1.0-rc.1", "1.0.0"]
      .map((text) => parseReleaseVersion(text))
      .filter((version) => version !== undefined)
      .toSorted(compareReleaseVersions)
      .map(formatReleaseVersion);
    expect(sorted).toEqual([
      "0.1.0-rc.1",
      "0.1.0-rc.2",
      "0.1.0",
      "0.1.1",
      "1.0.0",
    ]);
  });

  it("picks the highest stable version and ignores candidates", () => {
    const versions = ["0.3.0-rc.1", "0.2.1", "0.1.0", "0.2.0"]
      .map((text) => parseReleaseVersion(text))
      .filter((version) => version !== undefined);
    expect(pickHighestStable(versions)).toEqual({
      major: 0,
      minor: 2,
      patch: 1,
    });
    expect(pickHighestStable([])).toBeUndefined();
  });
});
