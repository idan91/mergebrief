import type { ValueOf } from "types/utils";

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

export interface ExportOptions {
  readonly version: string;
  readonly source: string;
  /** An absolute dir, absent or empty; the tree is left there. */
  readonly out: string;
}

export interface ExportReport {
  readonly version: string;
  readonly commit: string;
  readonly out: string;
  readonly fileCount: number;
  readonly excluded: readonly ExcludedCount[];
  readonly linkHits: readonly LinkHit[];
}
