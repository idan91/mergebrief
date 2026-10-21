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

export const BumpLevels = {
  MAJOR: "major",
  MINOR: "minor",
  PATCH: "patch",
} as const;
export type BumpLevel = ValueOf<typeof BumpLevels>;

/** What `cut` will do, computed before any tag is written. */
export interface CutPlan {
  readonly version: string;
  readonly tag: string;
  readonly commit: string;
  readonly notesPath: string;
}

export interface CutError {
  readonly reason: string;
}

/** The git the cut needs, injected so the plan is testable without a repo. */
export interface GitPort {
  /** Brings the remote default branch to a ref of its own; the one fetch a cut does. */
  fetchDefaultBranch(): void;
  listRemoteTags(): readonly string[];
  resolveCommit(ref: string): string | undefined;
  isOnDefaultBranch(commit: string): boolean;
  readFileAt(commit: string, path: string): string | undefined;
  hasLocalTag(tag: string): boolean;
  createTag(tag: string, commit: string): void;
  pushTag(tag: string): void;
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
