import type { z } from "zod/v4";
import type { Result, ValueOf } from "types/utils";
import type {
  Brief,
  BriefSchema,
  ChangeGroup,
  Chunk,
  DeltaBrief,
  PrRefSchema,
  RevisionNarrative,
  RevisionNarrativeSkipped,
} from "../types";
import type {
  StoredChangeGroupReadSchema,
  StoredChunkReadSchema,
} from "./schemas";

export const ArtifactIssueCodes = {
  NOT_JSON: "not-json",
  INVALID: "invalid",
  DROPPED_SECTION: "dropped-section",
  UNKNOWN_CHANGE_GROUP: "unknown-change-group",
  LEGACY_MEMBERSHIP: "legacy-membership",
  MINTED_GROUP_ID: "minted-group-id",
  SHARED_GROUP_ID: "shared-group-id",
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

export type StoredParse<Stored> = Result<Stored, ArtifactIssue[]>;

export type BriefWriteCheck = Result<Brief, ArtifactIssue[]>;
export type DeltaBriefWriteCheck = Result<DeltaBrief, ArtifactIssue[]>;
export type RevisionNarrativeWriteCheck = Result<
  StoredRevisionNarrative,
  ArtifactIssue[]
>;

type StampedSection = "index" | "commitRange" | "generation";

/** A Brief as read back from storage: older bodies lack the stamped sections. */
export type StoredBrief = Omit<Brief, StampedSection> & {
  [Section in StampedSection]?: Brief[Section] | undefined;
};

export interface StoredBriefRead {
  brief: StoredBrief;
  /**
   * Each dropped section, minted or shared group id, normalized membership
   * and unknown group.
   */
  issues: ArtifactIssue[];
}

export type StoredBriefReadResult = Result<StoredBriefRead, ArtifactIssue[]>;
export type StoredDeltaBriefReadResult = Result<DeltaBrief, ArtifactIssue[]>;
export type StoredRevisionNarrativeReadResult = Result<
  StoredRevisionNarrative,
  ArtifactIssue[]
>;

export type StoredChangeGroupRead = z.infer<typeof StoredChangeGroupReadSchema>;
export type StoredChunkRead = z.infer<typeof StoredChunkReadSchema>;

type OptionalShapeKey<Shape> = {
  [Key in keyof Shape]: Shape[Key] extends z.ZodOptional ? Key : never;
}[keyof Shape];

/** Every section the Brief reader may drop: a missing or extra key fails to compile. */
export type BriefSectionSchemas = Record<
  OptionalShapeKey<typeof BriefSchema.shape> | StampedSection,
  z.ZodType
>;

export type PrSectionSchemas = Record<
  OptionalShapeKey<typeof PrRefSchema.shape>,
  z.ZodType
>;

export interface SectionsRead {
  body: Record<string, unknown>;
  dropped: ArtifactIssue[];
}

export interface ReadingOrderRead {
  brief: StoredBrief;
  dropped: ArtifactIssue[];
}

export type SharedGroupIdIssues = ArtifactIssue[];

export interface IdentifiedGroup {
  stored: StoredChangeGroupRead;
  /** The stored id, or the one minted for a group that has none. */
  id: string;
}

export interface GroupMembership {
  changeGroups: ChangeGroup[];
  chunks: Chunk[];
  issues: ArtifactIssue[];
}

export type GroupMembershipResult = Result<GroupMembership, ArtifactIssue[]>;
