import { compareSemver, parseSemver, type Semver } from "persistence";
import type { Mutable, Result } from "types/utils";
import type { z } from "zod/v4";
import type { ReleaseEntry, VersionManifest } from "../types";
import { ReleaseEntrySchema, VersionManifestSchema } from "../schemas";

export interface GapFlags {
  readonly breaking: boolean;
  readonly security: boolean;
}

function shapeRelease(
  parsed: z.infer<typeof ReleaseEntrySchema>,
): ReleaseEntry {
  const release: Mutable<ReleaseEntry> = {
    version: parsed.version,
    breaking: parsed.breaking,
    security: parsed.security,
  };
  if (parsed.date !== undefined) {
    release.date = parsed.date;
  }
  if (parsed.notesUrl !== undefined) {
    release.notesUrl = parsed.notesUrl;
  }
  return release;
}

/** Entries that are not a release are dropped; the envelope must parse. */
export function parseVersionManifest(
  body: unknown,
): Result<VersionManifest, string> {
  const envelope = VersionManifestSchema.safeParse(body);
  if (!envelope.success) {
    return { ok: false, error: "malformed manifest" };
  }

  const releases: ReleaseEntry[] = [];
  for (const candidate of envelope.data.releases) {
    const entry = ReleaseEntrySchema.safeParse(candidate);
    if (entry.success) {
      releases.push(shapeRelease(entry.data));
    }
  }

  const manifest: Mutable<VersionManifest> = {
    latest: envelope.data.latest,
    releases,
  };
  if (envelope.data.releaseNotesUrl !== undefined) {
    manifest.releaseNotesUrl = envelope.data.releaseNotesUrl;
  }
  return { ok: true, value: manifest };
}

/** Flags over releases newer than `running` and no newer than `latest`. */
export function deriveGapFlags(
  running: Semver,
  latest: Semver,
  releases: readonly ReleaseEntry[],
): GapFlags {
  let breaking = false;
  let security = false;
  for (const release of releases) {
    const version = parseSemver(release.version);
    if (!version.ok) {
      continue;
    }
    const inGap =
      compareSemver(version.value, running) > 0 &&
      compareSemver(version.value, latest) <= 0;
    if (inGap) {
      breaking = breaking || release.breaking;
      security = security || release.security;
    }
  }
  return { breaking, security };
}
