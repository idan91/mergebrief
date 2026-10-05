import type { Result, ValueOf } from "types/utils";
import type {
  Brief,
  DeltaBrief,
  RevisionNarrative,
  RevisionNarrativeSkipped,
} from "../types";

export const ArtifactIssueCodes = {
  NOT_JSON: "not-json",
  INVALID: "invalid",
  DROPPED_SECTION: "dropped-section",
  UNKNOWN_CHANGE_GROUP: "unknown-change-group",
  LEGACY_MEMBERSHIP: "legacy-membership",
} as const;

export type ArtifactIssueCode = ValueOf<typeof ArtifactIssueCodes>;

export interface ArtifactIssue {
  code: ArtifactIssueCode;
  /** Dotted path into the body; empty for the body itself. */
  path: string;
  /** May name keys taken from the body: never a log field. */
  message: string;
}

export type StoredRevisionNarrative =
  | RevisionNarrative
  | RevisionNarrativeSkipped;

export type BriefWriteCheck = Result<Brief, ArtifactIssue[]>;
export type DeltaBriefWriteCheck = Result<DeltaBrief, ArtifactIssue[]>;
export type RevisionNarrativeWriteCheck = Result<
  StoredRevisionNarrative,
  ArtifactIssue[]
>;
