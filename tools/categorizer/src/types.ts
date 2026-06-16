import { z } from "zod/v4";

/**
 * Brief schema — the heart of the categorizer.
 *
 * Mirrors the controlled vocabulary in `docs/mvp/labeling-schema.md` (the
 * authoritative closed token list) and `docs/mvp/risk-surface.md` (the 16
 * factual attributes). If a token is not registered there, it is not valid
 * here — keep these enums in lockstep with those files.
 *
 * Structured-output constraints (from the claude-api skill): no recursive
 * schemas, no min/max constraints. Optionality is avoided in favour of
 * always-present arrays (empty when N/A) so the strict schema stays simple.
 */

// --- Closed vocabularies (one source of truth per axis) -------------------

/** Category — intent. Attaches to a change-group. */
export const Categories = [
  "bugfix", // correct a defect in existing behavior
  "logic-refactor", // behavior-preserving restructure of logic
  "move-with-edits", // relocation of code with edits inside the move
  "lib-bump", // dependency version change *with* API/behavior impact
  "pure-move", // relocation only, bytes identical, no edits
  "new-feature", // adds a new capability
  "dependency-update", // dep version bump with no API/behavior impact
  "schema-change", // data-model / migration change
] as const;

/** Concern — artifact. Attaches to a chunk. Mostly derivable from file path. */
export const Concerns = [
  "implementation", // the functional change itself (default carrier)
  "test", // tests, fixtures (incl. .test.* / .spec.* files)
  "doc", // docs, READMEs, changesets, doc-only files
  "spec", // specification document (NOT .spec.ts — that's test)
  "config", // configuration files
  "generated", // generated / vendored output (lockfiles, bundles)
] as const;

/** Role — carrier vs supporting. Attaches to a chunk. */
export const Roles = [
  "carrier", // holds the change-group's intent
  "supporting", // serves the carrier (its tests, docs, specs, config)
] as const;

/**
 * Risk surface — 16 factual attributes (never verdicts). Attaches to a chunk.
 * Three buckets: about the code / about the change / about the blast radius.
 */
export const RiskSurfaceAttributes = [
  // about the CODE
  "no-tests",
  "no-types",
  "legacy-area",
  "dense-logic",
  // about the CHANGE
  "touches-auth",
  "mutates-state",
  "removes-validation",
  "relaxes-permissions",
  "widens-error-handling",
  "adds-feature-flag",
  // about the BLAST RADIUS
  "external-io",
  "cross-service",
  "schema-adjacent",
  "hot-path",
  "widely-imported",
  "release-imminent",
] as const;

export type Category = (typeof Categories)[number];
export type Concern = (typeof Concerns)[number];
export type Role = (typeof Roles)[number];
export type RiskSurfaceAttribute = (typeof RiskSurfaceAttributes)[number];

const categoryEnum = z.enum(Categories);
const concernEnum = z.enum(Concerns);
const roleEnum = z.enum(Roles);
const riskSurfaceEnum = z.enum(RiskSurfaceAttributes);

// --- Brief shape ----------------------------------------------------------

export const PrRefSchema = z.object({
  repo: z.string().describe("owner/name, e.g. medusajs/medusa"),
  number: z.number().int().describe("PR number"),
  title: z.string(),
  url: z.string().describe("PR URL"),
  sha: z.string().describe("head commit SHA of the PR"),
  description: z
    .string()
    .describe(
      "the PR description (body) as authored, kept for display and as optional agent context",
    ),
});

/** A contiguous run of line numbers (1-based, inclusive) on one side of the diff. */
export const LineRangeSchema = z.object({
  start: z.number().int().describe("first line number (1-based, inclusive)"),
  end: z
    .number()
    .int()
    .describe("last line number (inclusive); equals start for a single line"),
});

export const ChunkSchema = z.object({
  id: z.string().describe("stable chunk id, e.g. c1, c2, …"),
  changeGroupId: z
    .string()
    .describe(
      "id of the single change-group this chunk belongs to (exactly one — a chunk is never shared across groups; a file spans groups only via different chunks)",
    ),
  file: z.string().describe("file path the chunk lives in"),
  concern: concernEnum.describe(
    "artifact kind; mostly derivable from the file path",
  ),
  role: roleEnum.describe(
    "carrier holds intent; supporting serves it. Default from concern (implementation→carrier, else supporting); flip when a supporting artifact is itself the purpose (e.g. flaky-test fix).",
  ),
  loc: z
    .object({
      added: z.number().int().describe("git lines added in this chunk"),
      deleted: z.number().int().describe("git lines deleted in this chunk"),
    })
    .describe(
      "approximation: git LoC ≈ adjusted LoC. Note likely moves in the group summary; we do not claim move-accurate LoC.",
    ),
  addedRanges: z
    .array(LineRangeSchema)
    .describe(
      "new-side (+) line-number ranges of the actual ADDED lines in this chunk — changed lines only, NOT the @@ hunk window. Empty if the chunk only deletes. Many disjoint ranges = scattered change.",
    ),
  removedRanges: z
    .array(LineRangeSchema)
    .describe(
      "old-side (−) line-number ranges of the actual REMOVED lines in this chunk — changed lines only, NOT the @@ hunk window. Empty if the chunk only adds.",
    ),
  riskSurface: z
    .array(riskSurfaceEnum)
    .describe(
      "factual attributes that apply to this chunk (empty if none). Never verdicts — severity emerges from combinations.",
    ),
});

export const ChangeGroupSchema = z.object({
  id: z
    .string()
    .describe("stable group id referenced by chunks' changeGroupId, e.g. g1, g2, …"),
  title: z
    .string()
    .describe(
      "a one-line title describing the change group (what, not why), e.g. 'Add stock-location module to inventory service'",
    ),
  summary: z
    .string()
    .describe("what the group does (what, not why), one group = one summary"),
  dominantCategory: categoryEnum.describe("the group's primary intent"),
  secondaryCategories: z
    .array(categoryEnum)
    .describe("additional intents present in the group (empty if none)"),
  uncertain: z
    .boolean()
    .describe(
      "true when confidence on the dominant category is below threshold. AI never hides uncertainty — flag it rather than forcing a token.",
    ),
  uncertainBetween: z
    .array(categoryEnum)
    .describe(
      "the categories in tension when uncertain=true (e.g. new-feature vs bugfix); empty when uncertain=false",
    ),
});

export const ConcernRollupSchema = z.object({
  concern: concernEnum,
  added: z.number().int().describe("total git lines added for this concern"),
  deleted: z
    .number()
    .int()
    .describe("total git lines deleted for this concern"),
});

/**
 * The commit span a full brief covers — the whole PR, base→head — plus a count.
 * CLI-owned metadata (the model never produces it); see ADR 0012.
 */
export const CommitRangeSchema = z.object({
  base: z.string().describe("PR base commit SHA"),
  head: z.string().describe("head commit SHA this brief covers"),
  commitCount: z
    .number()
    .int()
    .describe("number of commits in the PR at this head"),
});

/**
 * A PR review comment (line comment or thread reply) as carried in the
 * `.comments.json` sidecar — display data for both the brief and the delta
 * (ADR 0012). `outdated` is read from GitHub (position == null), never
 * recomputed (ADR 0007).
 */
export const ReviewCommentSchema = z.object({
  id: z.string(),
  file: z.string(),
  startLine: z
    .number()
    .int()
    .nullable()
    .describe("current diff range start; null for single-line comments, file-level comments, or outdated anchors"),
  line: z.number().int().nullable().describe("current diff line/range end; null if outdated"),
  originalStartLine: z
    .number()
    .int()
    .nullable()
    .describe("range start at the time the comment was made; null for single-line comments"),
  originalLine: z
    .number()
    .int()
    .nullable()
    .describe("line/range end at the time the comment was made"),
  author: z.string(),
  body: z.string(),
  inReplyToId: z
    .string()
    .nullable()
    .describe("id of the comment this replies to; null for a thread root"),
  outdated: z
    .boolean()
    .describe(
      "GitHub-native outdated status (GitHub nulls the comment's `line` when its anchor leaves the current diff); read, not recomputed",
    ),
});

export const BriefSchema = z.object({
  pr: PrRefSchema,
  index: z
    .number()
    .int()
    .describe(
      "PR-global brief ordinal — the Nth distinct head SHA briefed for this PR. CLI-assigned, not model-produced.",
    ),
  commitRange: CommitRangeSchema.describe(
    "the commit span this brief covers (whole PR, base→head). CLI-assigned.",
  ),
  summary: z
    .string()
    .describe(
      "Markdown, in this order: (1) a concise one-paragraph **overview** of what the PR does; (2) the fuller plain-English what-it-does for the whole PR; (3) optionally, a '## Changelog' bullet list when the change warrants one. The changelog is not required; the overview and the what-it-does are.",
    ),
  changeGroups: z.array(ChangeGroupSchema),
  chunks: z.array(ChunkSchema),
  concernView: z
    .array(ConcernRollupSchema)
    .describe("LoC rollup per concern (one entry per concern present)"),
});

/**
 * What the model actually generates for a full brief: BriefSchema minus the
 * CLI-owned metadata (`pr`, `index`, `commitRange`), which the CLI fills after
 * generation so the model never echoes identifiers it cannot know (ADR 0012).
 */
export const BriefGenerationSchema = BriefSchema.omit({
  pr: true,
  index: true,
  commitRange: true,
});

/**
 * Delta brief — the re-review reload. This is the **delta core** only: the
 * code-change narrative between a baseline SHA and the head SHA (per ADR 0006).
 * The per-reviewer carry-over overlay (reopened/settled flags, moved/orphaned
 * comments) requires reviewer state and is out of scope for the stateless CLI.
 */
/**
 * Delta chunk = a brief chunk plus delta-only fields: a one-line what-changed
 * summary and the review comment(s) this chunk resolves (ADR 0011). These are
 * delta-specific; the full brief uses the base ChunkSchema.
 */
export const DeltaChunkSchema = ChunkSchema.extend({
  summary: z
    .string()
    .describe("one-line, what changed in this chunk (what, not why)"),
  addressesComments: z
    .array(z.string())
    .describe(
      "ids of the review comments this chunk resolves (empty if it addresses none)",
    ),
});

export const DeltaBriefSchema = z.object({
  pr: PrRefSchema,
  baselineSha: z.string().describe("the SHA the reviewer last looked at"),
  headSha: z.string().describe("the current head SHA"),
  baselineIndex: z
    .number()
    .int()
    .nullable()
    .describe(
      "brief index of the baseline SHA (null if that end was never briefed). CLI-assigned.",
    ),
  headIndex: z
    .number()
    .int()
    .nullable()
    .describe(
      "brief index of the head SHA (null if that end was never briefed). CLI-assigned.",
    ),
  summary: z
    .string()
    .describe(
      "Markdown reload, in this order: (1) a concise one-paragraph overview of what changed *since the baseline*; (2) the fuller what-changed; (3) optionally a '## Changelog' of the follow-up commits. Frame it as 'since you last looked'.",
    ),
  commentsAddressed: z
    .string()
    .describe(
      "Markdown: how the follow-up answers the prior review comments overall. Empty string when there are no comments. Never author replies — only describe how the change addresses them.",
    ),
  changedGroups: z
    .array(ChangeGroupSchema)
    .describe("change-groups for the incremental (baseline→head) change only"),
  chunks: z
    .array(DeltaChunkSchema)
    .describe("chunks of the incremental change only"),
  wholePrImpact: z
    .string()
    .describe(
      "how this follow-up affects the overall PR — does it complete/alter the original intent, or introduce new risk not present at the baseline. Grounded in the diff; not a verdict.",
    ),
});

/**
 * What the model generates for a delta: DeltaBriefSchema minus the CLI-owned
 * fields (`pr`, `baselineSha`, `headSha`, `baselineIndex`, `headIndex`), which
 * the CLI fills after generation (ADR 0012) — same discipline as the brief.
 */
export const DeltaBriefGenerationSchema = DeltaBriefSchema.omit({
  pr: true,
  baselineSha: true,
  headSha: true,
  baselineIndex: true,
  headIndex: true,
});

export type PrRef = z.infer<typeof PrRefSchema>;
export type LineRange = z.infer<typeof LineRangeSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
export type ChangeGroup = z.infer<typeof ChangeGroupSchema>;
export type ConcernRollup = z.infer<typeof ConcernRollupSchema>;
export type CommitRange = z.infer<typeof CommitRangeSchema>;
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type DeltaChunk = z.infer<typeof DeltaChunkSchema>;
export type DeltaBrief = z.infer<typeof DeltaBriefSchema>;
