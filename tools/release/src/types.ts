import type { ValueOf } from "types/utils";

/** `major.minor.patch`, plus the candidate number when the tag is an rc. */
export interface ReleaseVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly rc?: number;
}

export const ReleaseChannels = {
  STABLE: "stable",
  RC: "rc",
} as const;
export type ReleaseChannel = ValueOf<typeof ReleaseChannels>;

/** One `docs/releases/<version>.md`, parsed. */
export interface ReleaseNotes {
  readonly version: ReleaseVersion;
  readonly date: string;
  readonly breaking: boolean;
  readonly security: boolean;
  readonly body: string;
  readonly path: string;
}

export interface NotesError {
  readonly path: string;
  readonly reason: string;
}

/** What the workflow reads off `check --tag`. */
export interface TagReport {
  readonly version: string;
  readonly channel: ReleaseChannel;
  /** The highest stable version among the notes files and the published tags. */
  readonly isHighestStable: boolean;
  /** The highest version of any channel; decides the npm `next` dist-tag. */
  readonly isHighest: boolean;
}

export interface CheckReport {
  readonly notes: readonly ReleaseNotes[];
  readonly tag?: TagReport;
}

/** One entry of `version.json`'s `releases`, the api's `ReleaseEntry`. */
export interface VersionManifestRelease {
  readonly version: string;
  readonly date: string;
  readonly breaking: boolean;
  readonly security: boolean;
  readonly notesUrl: string;
}

/** The file every instance fetches from the latest Release. */
export interface VersionManifest {
  readonly latest: string;
  readonly releaseNotesUrl: string;
  readonly releases: readonly VersionManifestRelease[];
}

export interface StampError {
  readonly path: string;
  readonly reason: string;
}

export const ExitCodes = {
  OK: 0,
  REFUSED: 1,
  USAGE: 2,
} as const;
export type ExitCode = ValueOf<typeof ExitCodes>;
