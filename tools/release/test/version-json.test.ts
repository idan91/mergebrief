import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { buildVersionManifest } from "../src/logic/version-json";
import { readReleaseNotes } from "../src/logic/notes";
import type {
  ReleaseNotes,
  ReleaseVersion,
  VersionManifest,
} from "../src/types";
import { makeNotesDir, makeNotesFile } from "./helpers";

// A hand copy of apps/api/src/update-check/schemas.ts, the consumer; an app
// is never imported. A change there is mirrored here by hand.
const NotesUrlSchema = z
  .url({ protocol: /^https?$/ })
  .optional()
  .catch(undefined);
const ReleaseEntrySchema = z.object({
  version: z.string().min(1),
  date: z.string().optional(),
  breaking: z.boolean().default(false),
  security: z.boolean().default(false),
  notesUrl: NotesUrlSchema,
});
const VersionManifestSchema = z.object({
  latest: z.string().min(1),
  releaseNotesUrl: NotesUrlSchema,
  releases: z.array(z.unknown()).default([]),
});

const BODY = "## Highlights\n\nNotes.\n";
const THROUGH_NEWEST: ReleaseVersion = { major: 0, minor: 2, patch: 1 };

function unwrap(
  result: ReturnType<typeof buildVersionManifest>,
): VersionManifest {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

function readFixture(): readonly ReleaseNotes[] {
  const dir = makeNotesDir({
    "0.1.0.md": makeNotesFile({ date: "2026-10-03" }, BODY),
    "0.2.0.md": makeNotesFile(
      { date: "2026-11-01", breaking: "true" },
      `${BODY}\n## Upgrade\n\nSteps.\n`,
    ),
    "0.2.1.md": makeNotesFile({ date: "2026-11-09", security: "true" }, BODY),
    "0.3.0-rc.1.md": makeNotesFile({ date: "2026-12-01" }, BODY),
  });
  const read = readReleaseNotes(dir);
  return read.ok ? read.value : [];
}

describe("version.json from the notes files", () => {
  it("names the highest stable version as latest and links its Release page", () => {
    const manifest = unwrap(
      buildVersionManifest(readFixture(), THROUGH_NEWEST),
    );

    expect(manifest.latest).toBe("0.2.1");
    expect(manifest.releaseNotesUrl).toBe(
      "https://github.com/Idan91/mergebrief/releases/tag/v0.2.1",
    );
  });

  it("lists stable releases newest first with flags and no candidate", () => {
    const manifest = unwrap(
      buildVersionManifest(readFixture(), THROUGH_NEWEST),
    );

    expect(manifest.releases).toEqual([
      {
        version: "0.2.1",
        date: "2026-11-09",
        breaking: false,
        security: true,
        notesUrl: "https://github.com/Idan91/mergebrief/releases/tag/v0.2.1",
      },
      {
        version: "0.2.0",
        date: "2026-11-01",
        breaking: true,
        security: false,
        notesUrl: "https://github.com/Idan91/mergebrief/releases/tag/v0.2.0",
      },
      {
        version: "0.1.0",
        date: "2026-10-03",
        breaking: false,
        security: false,
        notesUrl: "https://github.com/Idan91/mergebrief/releases/tag/v0.1.0",
      },
    ]);
  });

  it("parses under the api's own manifest schema", () => {
    const manifest = unwrap(
      buildVersionManifest(readFixture(), THROUGH_NEWEST),
    );

    const parsed = VersionManifestSchema.safeParse(
      JSON.parse(JSON.stringify(manifest)),
    );
    expect(parsed.success).toBe(true);
    const entries = manifest.releases.map(
      (entry) => ReleaseEntrySchema.safeParse(entry).success,
    );
    expect(entries).toEqual([true, true, true]);
  });

  it("leaves out a stable file merged ahead of the tag", () => {
    const through: ReleaseVersion = { major: 0, minor: 2, patch: 0 };

    const manifest = unwrap(buildVersionManifest(readFixture(), through));

    expect(manifest.latest).toBe("0.2.0");
    expect(manifest.releases.map((entry) => entry.version)).toEqual([
      "0.2.0",
      "0.1.0",
    ]);
  });

  it("refuses a set with no stable release", () => {
    const dir = makeNotesDir({ "0.1.0-rc.1.md": makeNotesFile({}, BODY) });
    const read = readReleaseNotes(dir);

    const manifest = buildVersionManifest(
      read.ok ? read.value : [],
      THROUGH_NEWEST,
    );

    expect(!manifest.ok && manifest.error).toContain("stable");
  });
});
