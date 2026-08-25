import type {
  ArtifactStore,
  PullRequestLifecycle,
  PullRequestRow,
  RepoId,
  ScopeContext,
  TenantRepository,
} from "persistence";
import type { z } from "zod";
import type { BriefMetaSchema } from "./schemas";

/** How a stored `owner/repo` slug becomes a row identity + lifecycle. */
export interface RepoResolution {
  readonly repoId: RepoId;
  readonly lifecycle: PullRequestLifecycle;
  /** The PR's base SHA — the only way a pre-index brief can be placed. */
  readonly baseSha?: string;
}

export type ResolveRepo = (
  repoSlug: string,
  prNumber: number,
) => Promise<RepoResolution>;

export interface IngestBriefOptions {
  readonly dir: string;
  /** The EXPLICIT target scope — never inferred from the artifacts. */
  readonly ctx: ScopeContext;
  readonly resolveRepo: ResolveRepo;
  readonly log?: (message: string) => void;
}

export interface IngestSummary {
  readonly briefs: number;
  readonly narratives: number;
  readonly marks: number;
  readonly deltas: number;
  /** Files with no database home — reported, not silent. */
  readonly skipped: readonly string[];
  /** *.brief.json files the mapper could not place — LOUD data-loss risk. */
  readonly unmapped: readonly string[];
}

export interface ParsedBriefFile {
  readonly name: string;
  readonly body: string;
  readonly meta: z.infer<typeof BriefMetaSchema>;
  /** Pre-index brief: its base SHA is unknown until the repo resolves. */
  readonly legacy?: boolean;
}

/** One directory sorted into the artifact families the mapper writes. */
export interface CollectedFiles {
  readonly briefFiles: readonly ParsedBriefFile[];
  readonly narrativeNames: readonly string[];
  readonly comparisonNames: readonly string[];
  readonly revchangesNames: readonly string[];
  readonly deltaNames: readonly string[];
}

/**
 * What every phase shares. `skipped` and `unmapped` are the two ACCUMULATING
 * lists — a phase appends to them rather than returning its own, so the order
 * files were reported in survives the split into phases.
 */
export interface IngestRun {
  readonly dir: string;
  readonly repo: TenantRepository;
  readonly store: ArtifactStore;
  readonly log: (message: string) => void;
  readonly skipped: string[];
  readonly unmapped: string[];
}

/** Every PR row this run wrote, plus the bases pre-index briefs write with. */
export interface ResolvedPullRequests {
  readonly prRows: ReadonlyMap<string, PullRequestRow>;
  readonly legacyBaseShas: ReadonlyMap<string, string>;
}
