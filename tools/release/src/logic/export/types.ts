import type { Result, ValueOf } from "types/utils";

import type { CommandRunner, GitPort, TreeChangeCounts } from "../../types";

/** What ships and what stays private: top-level entries, then path prefixes. */
export interface ExportPaths {
  /** Top-level entries: a dir with its trailing `/`, a root file by name. */
  readonly include: readonly string[];
  /** Path prefixes, no globs; a dir prefix ends in `/`. */
  readonly exclude: readonly string[];
}

/** A line that states the exclusion rule, so it may name an excluded prefix. */
export interface ExclusionRuleSite {
  readonly path: string;
  readonly fragment: string;
}

export interface ExcludedCount {
  readonly prefix: string;
  readonly count: number;
}

export interface Classification {
  readonly shipped: readonly string[];
  /** Every exclude prefix, in manifest order, with the tracked paths it held back. */
  readonly excluded: readonly ExcludedCount[];
}

export interface UnclassifiedPaths {
  /** Top-level entries in neither list, sorted; a dir carries its `/`. */
  readonly unclassified: readonly string[];
}

export interface ExportError {
  readonly reason: string;
}

export const LinkHitKinds = {
  LINK: "link",
  MENTION: "mention",
} as const;
export type LinkHitKind = ValueOf<typeof LinkHitKinds>;

/** A shipped markdown line that sends a reader into an excluded path. */
export interface LinkHit {
  readonly path: string;
  readonly line: number;
  readonly target: string;
  readonly kind: LinkHitKind;
}

export interface MaterializeInput {
  readonly commit: string;
  readonly shipped: readonly string[];
  readonly out: string;
}

/** `owner/name`, or a rehearsal remote's URL or path, as messages print it. */
export type RepositorySlug = `${string}/${string}`;

/** The repository a release is published to: the notes gate reads its tags. */
export interface PublicRepository {
  readonly slug: RepositorySlug;
  readonly url: string;
  /** `--authenticated-reads`: it exists and is private, so even a dry run refuses when it does not answer. */
  readonly authenticatesReads?: boolean;
}

export interface ExportOptions {
  readonly version: string;
  readonly source: string;
  /** An absolute dir, absent or empty; the tree is left there. */
  readonly out: string;
  readonly dryRun: boolean;
  readonly publicRepository: PublicRepository;
  /** Required by a publish, absent in a dry run. */
  readonly token?: string;
  /** An absolute dir, absent or empty: no gate runs, and the release bundle and plan land there for other jobs to gate and push. */
  readonly emit?: string;
  /** The commit an emit planned; a gated dry run refuses a rebuild that differs, so the gates checked what ships. */
  readonly expectCommit?: string;
}

/** What a run does with the publish token. */
export interface ExportTokenUse {
  /** A publish; a dry run and an emit push nothing. */
  readonly pushes: boolean;
  /** `--authenticated-reads`: the target repository is still private. */
  readonly authenticatesReads: boolean;
}

/** The publish token, handed on only for what the run asked for. */
export interface ExportTokens {
  /** Pushes the release; absent when nothing is pushed. */
  readonly publish?: string;
  /** Reads the target repository; absent, it is read anonymously. */
  readonly publicRead?: string;
}

/** How a run reaches the public repository: which one, and the token its reads carry. */
export interface PublicRepositoryAccess {
  readonly repository: PublicRepository;
  /** Present only under `--authenticated-reads`; absent, the reads are anonymous. */
  readonly readToken?: string;
}

export interface GateDeps {
  readonly git: GitPort;
  readonly runner: CommandRunner;
}

export interface ExportDeps extends GateDeps {
  /** Receives the report a block at a time, each gate's verdict as it lands. */
  readonly print: (text: string) => void;
}

/** What was read, where the tree is, what stayed private. */
export interface ExportHeader {
  readonly version: string;
  readonly commit: string;
  readonly out: string;
  readonly fileCount: number;
  readonly excluded: readonly ExcludedCount[];
}

export const GateNames = {
  PATHS: "paths",
  GITLEAKS: "gitleaks",
  NOTES: "notes",
  BUILD: "build",
} as const;
export type GateName = ValueOf<typeof GateNames>;

export interface GateContext {
  readonly dir: string;
  /** `X.Y.Z` or `X.Y.Z-rc.N`, no `v`. */
  readonly version: string;
  readonly shipped: readonly string[];
  /** A publish, an emit or any run that authenticates its reads refuses a public repo that does not answer; a plain dry run plans against an empty one. */
  readonly requiresPublicRepository: boolean;
  readonly publicRepository: PublicRepository;
}

export interface GatePass {
  readonly summary: string;
  /** Lines the run must show even though the gate passed. */
  readonly notices: readonly string[];
}

export interface GateFailure {
  readonly reason: string;
  readonly details: readonly string[];
}

export type GateOutcome = Result<GatePass, GateFailure>;

export interface GateVerdict {
  readonly name: GateName;
  readonly outcome: GateOutcome;
}

export interface GateRun {
  readonly verdicts: readonly GateVerdict[];
  /** Every gate ran and passed. */
  readonly passed: boolean;
}

export const PublishActions = {
  PUSH_COMMIT: "push-commit",
  PUSH_TAG: "push-tag",
  PUSH_RECORD: "push-record",
} as const;
export type PublishAction = ValueOf<typeof PublishActions>;

export interface PublishInput {
  /** `X.Y.Z` or `X.Y.Z-rc.N`, no `v`. */
  readonly version: string;
  /** The source commit's SHA. */
  readonly source: string;
  readonly shipped: readonly string[];
  readonly out: string;
  readonly requiresPublicRepository: boolean;
  readonly publicRepository: PublicRepository;
}

/** What a publish would do, every object already built; the dry run prints it and stops. */
export interface PublishPlan {
  readonly version: string;
  readonly source: string;
  /** The previous release commit; absent for the first release. */
  readonly parent?: string;
  readonly commit: string;
  readonly tree: string;
  readonly tag: string;
  readonly tagObject: string;
  readonly record: string;
  readonly recordObject: string;
  readonly changes: TreeChangeCounts;
  readonly actions: readonly PublishAction[];
  readonly notices: readonly string[];
}

export interface PublishTarget {
  readonly url: string;
  readonly token: string;
}

/** `plan.json` beside the bundle: what the push job checks the bundle against and pushes, in order. */
export interface EmittedPlan {
  /** The public repository the plan read; the push job refuses to push anywhere else. */
  readonly publicUrl: string;
  readonly version: string;
  readonly source: string;
  readonly commit: string;
  readonly tree: string;
  readonly tag: string;
  readonly tagObject: string;
  readonly record: string;
  readonly recordObject: string;
  readonly actions: readonly PublishAction[];
}

export interface ExportOutcome {
  readonly header: ExportHeader;
  /** Absent for an emit, which runs no gate. */
  readonly gates?: GateRun;
  /** Absent when a gate failed. */
  readonly publish?: PublishPlan;
}
