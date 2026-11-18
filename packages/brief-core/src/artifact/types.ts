import type { z } from "zod/v4";
import type { Result, ValueOf } from "types/utils";
import type {
  Brief,
  BriefSchema,
  RevisionNarrativeSchema,
  ChangeGroup,
  Chunk,
  DeltaBrief,
  DeltaSkipped,
  DeltaUnchanged,
  PrRefSchema,
  RevisionNarrative,
  RevisionNarrativeSkipped,
  RevisionNarrativeUnchanged,
} from "../types";
import type {
  StoredChunkReadSchema,
  StoredSessionFactsReadSchema,
} from "./schemas";

export const ArtifactIssueCodes = {
  NOT_JSON: "not-json",
  INVALID: "invalid",
  DROPPED_SECTION: "dropped-section",
  DROPPED_FIELD: "dropped-field",
  UNKNOWN_CHANGE_GROUP: "unknown-change-group",
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
  | RevisionNarrativeSkipped
  | RevisionNarrativeUnchanged;

/** A delta row's body: the generated Delta Brief, or the span's skip or no-change record. */
export type StoredDelta = DeltaBrief | DeltaSkipped | DeltaUnchanged;

export type StoredParse<Stored> = Result<Stored, ArtifactIssue[]>;

export type BriefWriteCheck = Result<Brief, ArtifactIssue[]>;
export type DeltaWriteCheck = Result<StoredDelta, ArtifactIssue[]>;
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
   * Each dropped section or field, shared group id, and chunk moved to the
   * remainder.
   */
  issues: ArtifactIssue[];
}

export type StoredBriefReadResult = Result<StoredBriefRead, ArtifactIssue[]>;
export type StoredDeltaBriefReadResult = Result<DeltaBrief, ArtifactIssue[]>;
export type StoredDeltaReadResult = Result<StoredDelta, ArtifactIssue[]>;
export interface StoredRevisionNarrativeRead {
  narrative: StoredRevisionNarrative;
  /** Each nulled effort and dropped section. */
  issues: ArtifactIssue[];
}

export type StoredRevisionNarrativeReadResult = Result<
  StoredRevisionNarrativeRead,
  ArtifactIssue[]
>;

export type StoredChunkRead = z.infer<typeof StoredChunkReadSchema>;

type OptionalShapeKey<Shape> = {
  [Key in keyof Shape]: Shape[Key] extends z.ZodOptional ? Key : never;
}[keyof Shape];

/** Every section the Brief reader may drop: a missing or extra key fails to compile. */
export type BriefSectionSchemas = Record<
  OptionalShapeKey<typeof BriefSchema.shape> | StampedSection,
  z.ZodType
>;

export type NarrativeSectionSchemas = Record<
  OptionalShapeKey<typeof RevisionNarrativeSchema.shape>,
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

export interface RiskTokensRead {
  chunks: StoredChunkRead[];
  dropped: ArtifactIssue[];
}

export interface ReadingOrderRead {
  brief: StoredBrief;
  dropped: ArtifactIssue[];
}

export type SharedGroupIdIssues = ArtifactIssue[];

export interface GroupMembership {
  changeGroups: ChangeGroup[];
  chunks: Chunk[];
  /** Chunks naming no group: the reader moves them into the remainder. */
  orphans: StoredChunkRead[];
  issues: ArtifactIssue[];
}

/**
 * A risk-surface flag's identity: file, attribute, AND the region it fires
 * over, its chunk's whole diff span. Region is part of the identity because a
 * Disposition is anchored to one occurrence: the same attribute firing twice
 * in a file is two decisions.
 */
export interface FlagKey {
  readonly filePath: string;
  readonly attribute: string;
  readonly regionStart: number;
  readonly regionEnd: number;
}

/** What a Review Session needs from its Brief, and nothing else. */
export interface BriefSessionFacts {
  readonly chunkIds: readonly string[];
  readonly groupIds: readonly string[];
  readonly flags: readonly FlagKey[];
  /** Deduplicated; a File comment keys on these. */
  readonly filePaths: readonly string[];
  /**
   * The most Chunks a reviewer can mark read: the web shows each unattributed
   * file as one more Chunk, under an id the body does not carry.
   */
  readonly markableChunkCount: number;
}

export type BriefSessionFactsRead = Result<BriefSessionFacts, ArtifactIssue[]>;

export type StoredSessionFactsChunk = z.infer<
  typeof StoredSessionFactsReadSchema
>["chunks"][number];

export interface ChunkRegion {
  readonly start: number;
  readonly end: number;
}
