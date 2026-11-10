import type { Result, ValueOf } from "types/utils";

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

export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

/** Everything a release commit is made of; the same inputs give the same SHA. */
export interface ReleaseCommitInputs {
  readonly treeSha: string;
  /** The previous release commit; absent for the first release. */
  readonly parent?: string;
  readonly author: GitIdentity;
  readonly committer: GitIdentity;
  /** ISO 8601 with offset, the source commit's committer date; author and committer date both. */
  readonly date: string;
  readonly message: string;
}

export interface AnnotatedTagInputs {
  readonly name: string;
  readonly target: string;
  readonly message: string;
  readonly tagger: GitIdentity;
  readonly date: string;
}

/** One `public/vX.Y.Z` record: the source it was exported from and the public commit it became. */
export interface PublicRecord {
  readonly version: string;
  readonly source: string;
  readonly publicCommit: string;
}

/** What the public repository holds: its main head and its `v*` tags peeled to commits. */
export interface PublicRefs {
  readonly main?: string;
  readonly tags: ReadonlyMap<string, string>;
}

export interface TreeChangeCounts {
  readonly added: number;
  readonly edited: number;
  readonly deleted: number;
}

/** One ref a release bundle carries. */
export interface BundleRef {
  readonly ref: string;
  readonly sha: string;
}

/** The git the export needs, injected so its plan is testable without a repo. */
export interface GitPort {
  /** Brings the remote default branch to a ref of its own, so the source is checked against main as fetched. */
  fetchDefaultBranch(): void;
  resolveCommit(ref: string): string | undefined;
  isOnDefaultBranch(commit: string): boolean;
  /** Whether `ancestor` is `descendant` or in its history. */
  isAncestor(ancestor: string, descendant: string): boolean;
  /** The tags a repository URL holds; `undefined` when no repository answers at it. */
  listPublicTags(url: string): readonly string[] | undefined;
  /** Makes `dir` a one-commit repository of every file in it, so git-reading gates run there. */
  commitScratchRepo(dir: string): void;
  listTrackedPaths(commit: string): readonly string[];
  /** Writes exactly `paths` as `commit` holds them into `dir`; never reads the checkout. */
  archiveTo(commit: string, dir: string, paths: readonly string[]): void;
  /** ISO 8601 with offset. */
  readCommitterDate(commit: string): string;
  /** Every `Co-authored-by` value on `(fromExclusive, to]`, or on all of `to`'s history. */
  listCoAuthorTrailers(
    fromExclusive: string | undefined,
    to: string,
  ): readonly string[];
  /** A tree of exactly `paths` as `commit` holds them, built from the object db; returns its SHA. */
  writeTree(commit: string, paths: readonly string[]): string;
  /** The paths where `dir` and `tree` differ in content, mode or presence; empty when they match. */
  verifyTreeMatchesDir(tree: string, dir: string): readonly string[];
  commitTree(inputs: ReleaseCommitInputs): string;
  /** Whether the object is readable here, the repository's store and the scratch store included. */
  hasObject(sha: string): boolean;
  /** Writes the tag object only, no ref; returns its SHA. */
  writeAnnotatedTag(inputs: AnnotatedTagInputs): string;
  countTreeChanges(
    parent: string | undefined,
    commit: string,
  ): TreeChangeCounts;
  /** Reads the public repository's refs and brings its main commit local; `undefined` when none answers. */
  fetchPublic(url: string): PublicRefs | undefined;
  /** A plain push of `refspecs`, never forced. */
  pushPublic(url: string, token: string, refspecs: readonly string[]): void;
  /** Every `public/v*` record the remote holds; a malformed one is the refusal naming it. */
  listRecords(): Result<readonly PublicRecord[], string>;
  pushRecord(version: string, tagObject: string): void;
  /** Writes `refs` and the objects they reach, minus what `excluding` reaches, as a bundle at `file`. */
  writeBundle(
    file: string,
    refs: readonly BundleRef[],
    excluding: string,
  ): void;
  /** Deletes the objects publish wrote outside the repository's own store. */
  discardScratchObjects(): void;
}

export interface CommandSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Laid over the environment the runner was built with. */
  readonly env?: Readonly<Record<string, string>>;
}

/** A finished tool run whose stderr was captured. */
export interface StderrRun {
  readonly status: number;
  readonly stderr: string;
}

/** Spawns a gate's tool; the value is the exit code, the error why it could not start. */
export interface CommandRunner {
  run(spec: CommandSpec): Result<number, string>;
  /** As `run`, with the tool's stderr captured and echoed to ours after it exits; stdout still streams. */
  runCapturingStderr(spec: CommandSpec): Result<StderrRun, string>;
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
