// Shapes of the anchored-generation plan and stitch steps. `CompareFiles`
// is the compare-endpoint file list the plan reads; brief-core owns the shape
// so `github` (which produces it) and the worker (which consumes it) share
// one definition without brief-core depending on either.
import type { Hop } from "../diff/remap";
import type { RevisionChangeFile } from "../diff/revchanges";
import type { Brief } from "../types";

export type ChangeGroup = Brief["changeGroups"][number];
export type Chunk = Brief["chunks"][number];

/**
 * One compare `files[]` entry. `status` stays an OPEN string on purpose: a new
 * GitHub status must degrade to conservative handling, not fail a parse.
 */
export interface CompareFile {
  readonly filename: string;
  readonly status: string;
  /** `previous_filename`: present on renamed/copied entries. */
  readonly previousFilename?: string;
}

export interface CompareFiles {
  readonly files: readonly CompareFile[];
  /**
   * False when the list may be truncated: GitHub caps a compare response at
   * 300 files, so a 300-entry list proves nothing about the rest.
   */
  readonly complete: boolean;
  /**
   * The compare relation head-vs-base ('ahead' | 'diverged' | 'behind' |
   * 'identical'; open string). Only 'ahead' means a fast-forward span whose
   * three-dot diff equals the true tree diff; a same-base force-push shows
   * 'diverged' while the base SHA never moves. Absent means not-fast-forward.
   */
  readonly status?: string;
}

export interface AnchorPlanArgs {
  readonly previousBrief: Brief;
  /** The prevHead→head raw span diff; undefined = fetch failed (nothing confirmable). */
  readonly incrementalDiff?: string;
  /** Compare per-file metadata; undefined = fetch failed (nothing confirmable). */
  readonly compareFiles?: CompareFiles;
  /**
   * True when the PR-base SHA moved since the previous brief (rebase /
   * base-advance): three-dot compare data lies after a rewrite, so everything
   * re-looks BEFORE the partition even runs.
   */
  readonly baseShaMoved: boolean;
  /**
   * Every group id the PR's Brief chain has used (`brief.used_group_ids`) —
   * folded into `previousGroupIds` so descent never re-mints a retired id
   * for an unrelated group. Absent degrades to previous-brief-only.
   */
  readonly chainGroupIds?: readonly string[];
}

/** One frozen group carried verbatim: its definition + (remapped) chunks. */
export interface FrozenCarry {
  readonly group: ChangeGroup;
  readonly chunks: readonly Chunk[];
}

export interface ReLookEntry {
  readonly id: string;
  readonly files: readonly string[];
  readonly reason?: string;
}

export interface AnchorPlan {
  readonly frozen: readonly FrozenCarry[];
  /** Union of the frozen groups' files — the withhold/drop set. */
  readonly frozenFiles: ReadonlySet<string>;
  readonly reLook: readonly ReLookEntry[];
  readonly previousGroupIds: readonly string[];
  /**
   * The durable carry-over hop for this push — every file the span touched,
   * coordinates only. Absent whenever the file list may be incomplete, since
   * a missing hop demotes an anchor while a partial one misplaces it.
   */
  readonly hunkSpans?: Hop;
}

export interface StitchArgs {
  /** The fresh categorize output (model temp ids, may re-cover frozen files). */
  readonly generated: Brief;
  readonly plan: AnchorPlan;
  /** Every changed file path of the PR — the coverage check's universe. */
  readonly prFiles: readonly string[];
  /**
   * The whole-PR diff's changed-line ranges — the universe `unattributed`
   * derives against. categorize() skips the stamp on anchored runs (the model
   * withholds frozen chunks), so the stitch owns it over the merged set.
   */
  readonly changedFiles: readonly RevisionChangeFile[];
}

export interface StitchResult {
  readonly brief: Brief;
  readonly carriedGroupIds: readonly string[];
  /**
   * The ids of the chunks that carried verbatim. Chunk ids get a collision
   * guard, not descent, so a read mark may only carry against this exact set.
   */
  readonly carriedChunkIds: readonly string[];
  readonly regeneratedGroupIds: readonly string[];
}

export interface StitchError {
  readonly message: string;
}
