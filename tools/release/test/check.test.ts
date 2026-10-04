import { describe, expect, it } from "vitest";
import { checkReleases } from "../src/logic/check";
import { ReleaseChannels } from "../src/types";
import { makeNotesDir, makeNotesFile } from "./helpers";

const BODY = "## Highlights\n\nNotes.\n";

function makeCleanDir(): string {
  return makeNotesDir({
    "0.1.0.md": makeNotesFile({}, BODY),
    "0.2.0.md": makeNotesFile({}, BODY),
    "0.3.0-rc.1.md": makeNotesFile({}, BODY),
  });
}

describe("the release check", () => {
  it("passes over a clean directory without a tag", () => {
    const result = checkReleases(makeCleanDir());

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.notes).toHaveLength(3);
    expect(result.ok && result.value.tag).toBeUndefined();
  });

  it("lists every bad file", () => {
    const dir = makeNotesDir({ "0.1.0.md": "x", "bad.md": "y" });

    const result = checkReleases(dir);

    expect(!result.ok && result.error).toHaveLength(2);
  });

  it("refuses a tag outside the grammar", () => {
    const result = checkReleases(makeCleanDir(), "v0.1.0-beta.1");

    expect(!result.ok && result.error[0]?.reason).toContain("v0.1.0-beta.1");
  });

  it("refuses a tag that has no notes file", () => {
    const result = checkReleases(makeCleanDir(), "v0.4.0");

    expect(!result.ok && result.error[0]).toEqual({
      path: expect.stringContaining("0.4.0.md"),
      reason: "no notes file for tag v0.4.0",
    });
  });

  it("reports the highest stable tag as latest", () => {
    const result = checkReleases(makeCleanDir(), "v0.2.0");

    expect(result.ok && result.value.tag).toEqual({
      version: "0.2.0",
      channel: ReleaseChannels.STABLE,
      isHighestStable: true,
      isHighest: false,
    });
  });

  it("places the tag against tags already published, not only the files", () => {
    const dir = makeNotesDir({ "0.1.1.md": makeNotesFile({}, BODY) });

    const onHotfixBranch = checkReleases(dir, "v0.1.1", [
      "v0.1.0",
      "v0.2.0",
      "v0.3.0-rc.1",
    ]);
    const alone = checkReleases(dir, "v0.1.1", ["v0.1.0", "junk"]);

    expect(onHotfixBranch.ok && onHotfixBranch.value.tag?.isHighestStable).toBe(
      false,
    );
    expect(alone.ok && alone.value.tag?.isHighestStable).toBe(true);
  });

  it("reports the newest candidate as highest, an older one not", () => {
    const newest = checkReleases(makeCleanDir(), "v0.3.0-rc.1", [
      "v0.3.0-rc.0",
    ]);
    const older = checkReleases(makeCleanDir(), "v0.3.0-rc.1", ["v0.3.0-rc.2"]);
    const stale = checkReleases(makeCleanDir(), "v0.2.0", ["v0.4.0-rc.0"]);

    expect(newest.ok && newest.value.tag?.isHighest).toBe(true);
    expect(older.ok && older.value.tag?.isHighest).toBe(false);
    expect(stale).toMatchObject({
      value: { tag: { isHighestStable: true, isHighest: false } },
    });
  });

  it("never reports an older stable tag or a candidate as latest", () => {
    expect(checkReleases(makeCleanDir(), "v0.1.0")).toMatchObject({
      value: { tag: { isHighestStable: false } },
    });
    expect(checkReleases(makeCleanDir(), "v0.3.0-rc.1")).toMatchObject({
      value: { tag: { channel: ReleaseChannels.RC, isHighestStable: false } },
    });
  });
});
