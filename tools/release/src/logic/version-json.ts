import type { Result } from "types/utils";

import type {
  ReleaseNotes,
  ReleaseVersion,
  VersionManifest,
  VersionManifestRelease,
} from "../types";
import { buildReleasePageUrl } from "./release-body";
import {
  compareReleaseVersions,
  formatReleaseVersion,
  isStableVersion,
} from "./version";

/** `latest` and `releases[]` over the stable notes files up to `through`, newest first; a file merged ahead of its tag is left out. */
export function buildVersionManifest(
  notes: readonly ReleaseNotes[],
  through: ReleaseVersion,
): Result<VersionManifest, string> {
  const releases = notes
    .filter((entry) => isStableVersion(entry.version))
    .filter((entry) => compareReleaseVersions(entry.version, through) <= 0)
    .map(shapeManifestRelease);
  const newest = releases[0];
  if (newest === undefined) {
    return {
      ok: false,
      error: "no stable release among the notes files; version.json needs one",
    };
  }

  return {
    ok: true,
    value: {
      latest: newest.version,
      releaseNotesUrl: newest.notesUrl,
      releases,
    },
  };
}

function shapeManifestRelease(notes: ReleaseNotes): VersionManifestRelease {
  return {
    version: formatReleaseVersion(notes.version),
    date: notes.date,
    breaking: notes.breaking,
    security: notes.security,
    notesUrl: buildReleasePageUrl(notes.version),
  };
}
