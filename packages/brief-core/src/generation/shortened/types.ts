import type { ValueOf } from "types/utils";
import type { IndexedFile } from "../../diff/hunk-index/types";
import type { ShortenedReading } from "../../types";
import type { LockfileReadFailure, PackageChanges } from "./lockfiles/types";

export const LockfileFormats = {
  PNPM: "pnpm",
  NPM: "npm",
  YARN: "yarn",
  /** Any other ecosystem's lockfile: read as one line, never by package. */
  OTHER: "other",
} as const;
export type LockfileFormat = ValueOf<typeof LockfileFormats>;
export type PackageLockfileFormat = Exclude<
  LockfileFormat,
  typeof LockfileFormats.OTHER
>;

export const LockfileSideKinds = {
  TEXT: "text",
  /** The file does not exist at that commit: an added or deleted lockfile. */
  ABSENT: "absent",
  UNAVAILABLE: "unavailable",
} as const;

export interface LockfileText {
  kind: typeof LockfileSideKinds.TEXT;
  text: string;
}

export interface LockfileAbsent {
  kind: typeof LockfileSideKinds.ABSENT;
}

export interface LockfileUnavailable {
  kind: typeof LockfileSideKinds.UNAVAILABLE;
}

export type LockfileSide = LockfileText | LockfileAbsent | LockfileUnavailable;

/** A lockfile's full content at the span's base and head. */
export interface LockfileSides {
  before: LockfileSide;
  after: LockfileSide;
}

export interface PackageLockfileSummary {
  format: PackageLockfileFormat;
  changes: PackageChanges;
  /** Every known fetch host the base side's entries use; absent for a lockfile with no base side. */
  baseHosts?: string[];
}

/** A pnpm, npm or yarn lockfile one side of which could not be read. */
export interface UnreadLockfileSummary {
  format: PackageLockfileFormat;
  unread: LockfileReadFailure;
}

export interface OtherLockfileSummary {
  format: typeof LockfileFormats.OTHER;
}

export type LockfileSummary =
  | PackageLockfileSummary
  | UnreadLockfileSummary
  | OtherLockfileSummary;

/** Why a multi-call run reads a file shortened instead of in full. */
export const ShortenedKinds = {
  LOCKFILE: "lockfile",
  GENERATED: "generated",
  VENDORED: "vendored",
} as const;
export type ShortenedKind = ValueOf<typeof ShortenedKinds>;

/** One `.gitattributes` line's linguist settings; an absent attribute is left as the earlier rules had it. */
export interface LinguistRule {
  /** A `matchesGlob` pattern anchored at the repository root. */
  pattern: string;
  generated?: boolean;
  vendored?: boolean;
}

/** Why a `.gitattributes` gives no rule at all: the last rule wins, so a dropped one could mark hand-written code generated. */
export const GitAttributesRefusals = {
  TOO_LARGE: "too-large",
  OVER_RULE_BUDGET: "over-rule-budget",
  UNAPPLIED_UNSET: "unapplied-unset",
} as const;
export type GitAttributesRefusal = ValueOf<typeof GitAttributesRefusals>;

export interface LinguistAttributes {
  generated: boolean;
  vendored: boolean;
}

export interface LinguistAttributeLookup {
  byPath: Map<string, LinguistAttributes>;
  /** Paths the match budget never reached: absent from `byPath`, so each reads in full. */
  unresolvedPathCount: number;
}

export interface ShortenedFile {
  file: IndexedFile;
  kind: ShortenedKind;
  readAs: ShortenedReading;
  /** Present when the file is a lockfile. */
  lockfile?: LockfileSummary;
}

export interface ShortenedChunkIds {
  id: string;
  changeGroupId: string;
}
