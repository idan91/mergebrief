import { join } from "node:path";
import type { Result } from "types/utils";

import { NOTES_EXTENSION } from "../consts";
import type {
  CheckReport,
  NotesError,
  ReleaseNotes,
  TagReport,
} from "../types";
import { readReleaseNotes } from "./notes";
import {
  compareReleaseVersions,
  formatReleaseVersion,
  parseReleaseVersion,
  pickHighestStable,
  resolveChannel,
} from "./version";

/**
 * Every notes file parses; with a tag, the tag's file exists and is placed
 * against the notes files and the tags already published, so a hotfix cut
 * from an older branch never reports itself as the highest stable version.
 */
export function checkReleases(
  dir: string,
  tag?: string,
  knownTags: readonly string[] = [],
): Result<CheckReport, readonly NotesError[]> {
  const read = readReleaseNotes(dir);
  if (!read.ok) {
    return read;
  }
  if (tag === undefined) {
    return { ok: true, value: { notes: read.value } };
  }

  const placed = placeTag(dir, read.value, tag, knownTags);
  if (!placed.ok) {
    return { ok: false, error: [placed.error] };
  }
  return { ok: true, value: { notes: read.value, tag: placed.value } };
}

function placeTag(
  dir: string,
  notes: readonly ReleaseNotes[],
  tag: string,
  knownTags: readonly string[],
): Result<TagReport, NotesError> {
  const version = parseReleaseVersion(tag);
  if (version === undefined) {
    return {
      ok: false,
      error: { path: dir, reason: `tag ${tag} is not vX.Y.Z or vX.Y.Z-rc.N` },
    };
  }

  const text = formatReleaseVersion(version);
  const own = notes.find(
    (entry) => compareReleaseVersions(entry.version, version) === 0,
  );
  if (own === undefined) {
    const path = join(dir, `${text}${NOTES_EXTENSION}`);
    return {
      ok: false,
      error: { path, reason: `no notes file for tag ${tag}` },
    };
  }

  const known = knownTags
    .map((knownTag) => parseReleaseVersion(knownTag))
    .filter((parsed) => parsed !== undefined);
  const everyVersion = [...notes.map((entry) => entry.version), ...known];
  const highestStable = pickHighestStable(everyVersion);
  const isHighestStable =
    highestStable !== undefined &&
    compareReleaseVersions(highestStable, version) === 0;
  const isHighest = everyVersion.every(
    (candidate) => compareReleaseVersions(candidate, version) <= 0,
  );
  return {
    ok: true,
    value: {
      version: text,
      channel: resolveChannel(version),
      isHighestStable,
      isHighest,
    },
  };
}
