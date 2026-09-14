import type { ValueOf } from "types/utils";

/** One baseline file as `path -> rule -> count`. */
export type SuppressionBaseline = ReadonlyMap<
  string,
  ReadonlyMap<string, number>
>;

/** One recorded dependency-cruiser violation, keyed by edge and rule. */
export interface BoundaryRecord {
  readonly from: string;
  readonly to: string;
  readonly rule: string;
}

export const ChangeKinds = {
  ADDED: "added",
  MODIFIED: "modified",
  DELETED: "deleted",
  RENAMED: "renamed",
} as const;
export type ChangeKind = ValueOf<typeof ChangeKinds>;

export interface ChangedFile {
  readonly path: string;
  readonly kind: ChangeKind;
  /** The pre-rename path, so a rename cannot shed the file's recorded debt. */
  readonly previousPath?: string;
}

export const FindingKinds = {
  NEW_SUPPRESSION: "new-suppression",
  GROWN_SUPPRESSION: "grown-suppression",
  GROWN_RULE_TOTAL: "grown-rule-total",
  UNCLEANED_EDIT: "uncleaned-edit",
  STALE_DELETION: "stale-deletion",
  NEW_BOUNDARY_RECORD: "new-boundary-record",
  BOUNDARY_BASELINE_REINTRODUCED: "boundary-baseline-reintroduced",
  BOUNDARY_IGNORE_STILL_WIRED: "boundary-ignore-still-wired",
} as const;
export type FindingKind = ValueOf<typeof FindingKinds>;

export interface Finding {
  readonly kind: FindingKind;
  readonly subject: string;
  readonly detail: string;
}

export const RetirementReasons = {
  FIXED: "fixed",
  POLICY: "policy",
  DELETED: "deleted",
} as const;
export type RetirementReason = ValueOf<typeof RetirementReasons>;

export interface RetiredSuppression {
  readonly path: string;
  readonly rule: string;
  readonly before: number;
  readonly after: number;
  readonly reason: RetirementReason;
}

export interface BaselineVerdict {
  readonly findings: readonly Finding[];
  readonly retired: readonly RetiredSuppression[];
  readonly retiredBoundaryRecords: number;
}

export const BaseErrorCodes = {
  NOT_A_REPOSITORY: "not-a-repository",
  UNKNOWN_REF: "unknown-ref",
  NO_MERGE_BASE: "no-merge-base",
  UNREADABLE_TREE: "unreadable-tree",
} as const;
export type BaseErrorCode = ValueOf<typeof BaseErrorCodes>;

export interface BaseError {
  readonly code: BaseErrorCode;
  readonly ref: string;
  readonly message: string;
}

export const ParseErrorCodes = {
  UNREADABLE: "unreadable",
  WRONG_SHAPE: "wrong-shape",
} as const;
export type ParseErrorCode = ValueOf<typeof ParseErrorCodes>;

export interface ParseError {
  readonly code: ParseErrorCode;
  readonly source: string;
  readonly message: string;
}
