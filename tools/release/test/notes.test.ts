import { describe, expect, it } from "vitest";
import { readReleaseNotes } from "../src/logic/notes";
import { ReleaseChannels } from "../src/types";
import { makeNotesDir, makeNotesFile } from "./helpers";

const BODY = "## Highlights\n\nThe first release.\n";

function readErrors(
  files: Readonly<Record<string, string>>,
): readonly string[] {
  const result = readReleaseNotes(makeNotesDir(files));
  if (result.ok) {
    return [];
  }
  return result.error.map((error) => error.reason);
}

describe("reading the release notes files", () => {
  it("reads one valid file into its version, flags, date and body", () => {
    const dir = makeNotesDir({ "0.1.0.md": makeNotesFile({}, BODY) });

    const result = readReleaseNotes(dir);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      version: { major: 0, minor: 1, patch: 0 },
      channel: ReleaseChannels.STABLE,
      date: "2026-10-03",
      breaking: false,
      security: false,
      body: BODY,
    });
    expect(result.value[0]?.path.endsWith("0.1.0.md")).toBe(true);
  });

  it("reads a candidate file on the rc channel", () => {
    const dir = makeNotesDir({ "0.2.0-rc.1.md": makeNotesFile({}, BODY) });

    const result = readReleaseNotes(dir);

    expect(result.ok && result.value[0]?.channel).toBe(ReleaseChannels.RC);
  });

  it("sorts newest first", () => {
    const dir = makeNotesDir({
      "0.1.0.md": makeNotesFile({}, BODY),
      "0.2.0-rc.1.md": makeNotesFile({}, BODY),
      "0.1.1.md": makeNotesFile({}, BODY),
    });

    const result = readReleaseNotes(dir);

    const names = result.ok
      ? result.value.map((notes) => notes.path.split("/").at(-1))
      : [];
    expect(names).toEqual(["0.2.0-rc.1.md", "0.1.1.md", "0.1.0.md"]);
  });

  it("refuses a filename outside the grammar", () => {
    expect(readErrors({ "README.md": "# notes" })).toEqual([
      "filename is not <X.Y.Z>.md or <X.Y.Z-rc.N>.md",
    ]);
  });

  it("refuses a file without a front matter fence", () => {
    expect(readErrors({ "0.1.0.md": "# no fence\n" })).toEqual([
      "front matter must open with --- on the first line and close with ---",
    ]);
  });

  it("refuses an unknown front matter key", () => {
    const text = `---\ndate: 2026-10-03\nbreaking: false\nsecurity: false\ntitle: x\n---\n${BODY}`;
    expect(readErrors({ "0.1.0.md": text })[0]).toContain("title");
  });

  it("refuses a repeated or indented front matter key", () => {
    const repeated = `---\ndate: 2026-10-03\nbreaking: true\nsecurity: false\nbreaking: false\n---\n${BODY}`;
    const indented = `---\ndate: 2026-10-03\n  breaking: false\nsecurity: false\n---\n${BODY}`;
    expect(readErrors({ "0.1.0.md": repeated })).toEqual([
      "front matter key repeats: breaking",
    ]);
    expect(readErrors({ "0.1.0.md": indented })[0]).toContain("indented");
  });

  it("refuses a date that is not ISO", () => {
    expect(
      readErrors({
        "0.1.0.md": makeNotesFile({ date: "3 Oct 2026" }, BODY),
      })[0],
    ).toContain("date");
  });

  it("refuses a flag that is not true or false", () => {
    expect(
      readErrors({ "0.1.0.md": makeNotesFile({ breaking: "yes" }, BODY) })[0],
    ).toContain("breaking");
  });

  it("refuses a breaking release without an Upgrade section", () => {
    expect(
      readErrors({ "0.1.0.md": makeNotesFile({ breaking: "true" }, BODY) }),
    ).toEqual([
      "a breaking release needs an `## Upgrade` section listing the extra steps",
    ]);
  });

  it("accepts a breaking release that lists its upgrade steps", () => {
    const body = `${BODY}\n## Upgrade\n\n1. Add the new env key.\n`;
    expect(
      readErrors({ "1.0.0.md": makeNotesFile({ breaking: "true" }, body) }),
    ).toEqual([]);
  });

  it("refuses an empty body", () => {
    expect(readErrors({ "0.1.0.md": makeNotesFile({}, "\n\n") })).toEqual([
      "the notes body is empty",
    ]);
  });

  it("lists every bad file in one run", () => {
    const errors = readErrors({
      "0.1.0.md": "# no fence\n",
      "nope.md": "x",
      "0.1.1.md": makeNotesFile({}, BODY),
    });
    expect(errors).toHaveLength(2);
  });

  it("refuses a missing directory", () => {
    const result = readReleaseNotes("/nonexistent/releases");
    expect(result.ok).toBe(false);
  });
});
