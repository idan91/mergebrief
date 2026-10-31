import type { ValueOf } from "types/utils";
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
