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
 * Effort — the normalized, cross-provider reasoning-effort knob. Each adapter
 * maps it to its provider's own setting (Anthropic `output_config.effort`,
 * OpenAI `reasoning_effort`, …); a provider without the concept ignores it.
 */
export const Efforts = ["low", "medium", "high"] as const;

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
export type Effort = (typeof Efforts)[number];

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
    "carrier holds intent; supporting serves it. Default from concern (implementation→carrier, else supporting); flip when a supporting artifact is itself the purpose (e.g. flaky-test fix). Type, context, and CSS/style files are carrier when they define the changed contract, state model, or visual behavior; supporting only when they merely accompany another carrier.",
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

/**
 * One step of a Brief's Reading order (ADR 0025): a change-group id plus a
 * one-line, comprehension-language reason it comes next. `why` is never a
 * verdict — no importance/priority/severity words, no scores.
 */
export const ReadingOrderStepSchema = z.object({
  groupId: z
    .string()
    .describe("id of a change-group in this brief's changeGroups"),
  why: z
    .string()
    .describe(
      "one comprehension-language line, at most ~15 words, on why this group comes next (e.g. 'establishes the schema the rest builds on'). Never importance/priority/severity language, never a score.",
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
 * Generation provenance — which provider/model/effort produced this artifact.
 * CLI-owned metadata (the model never produces it); surfaced on the Receipt and
 * as an understated header label so the analysis is never mistaken for a verdict
 * (ADR 0012/0013).
 */
export const GenerationSchema = z.object({
  provider: z
    .string()
    .describe("LLM provider that produced this artifact, e.g. 'anthropic'"),
  model: z.string().describe("model id, e.g. 'claude-opus-4-8'"),
  effort: z
    .enum(Efforts)
    .nullable()
    .describe(
      "normalized reasoning effort used; null when the provider has no effort concept",
    ),
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
  generation: GenerationSchema.describe(
    "which provider/model/effort produced this brief. CLI-assigned.",
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
  readingOrder: z
    .array(ReadingOrderStepSchema)
    .optional()
    .describe(
      "optional reading order over changeGroups (ADR 0025): a strict permutation of their ids — each group exactly once, no revisits — in foundation-first order (schema/types → logic → call sites/wiring), falling back to context-first/churn-last for independent groups. Omit when no clear order applies. Mechanically validated post-parse as a permutation of the emitted group ids; dropped with a warning (not a hard failure) if it isn't.",
    ),
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
  generation: true,
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
  generation: GenerationSchema.describe(
    "which provider/model/effort produced this delta. CLI-assigned.",
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
  generation: true,
});

/**
 * Revision-narrative chunk — attaches an incremental (prevHead→head) change to
 * an existing full-Brief Change-group via `briefChangeGroupId`. Deliberately
 * lean vs. `Chunk`/`DeltaChunk`: no concern/role/loc/riskSurface — the full
 * Brief already owns that taxonomy for the same lines' prior state, and the
 * narrative only explains what is new (ADR 0024).
 */
export const RevisionNarrativeChunkSchema = z.object({
  id: z.string().describe("stable chunk id, e.g. rc1, rc2, …"),
  briefChangeGroupId: z
    .string()
    .describe(
      "id of an existing change-group on the CURRENT FULL BRIEF this chunk explains. Never invent an id — if no group fits confidently, use the closest one and note the uncertainty in `summary` prose instead.",
    ),
  file: z.string().describe("file path the chunk lives in"),
  addedRanges: z
    .array(LineRangeSchema)
    .describe(
      "new-side (+) line-number ranges of the actual ADDED lines in the incremental diff for this chunk — changed lines only, NOT the @@ hunk window.",
    ),
  removedRanges: z
    .array(LineRangeSchema)
    .describe(
      "old-side (−) line-number ranges of the actual REMOVED lines in the incremental diff for this chunk.",
    ),
  summary: z
    .string()
    .describe(
      "1-2 concrete sentences specific to these changed lines (what changed, not why; shared/impersonal voice)",
    ),
});

/**
 * Revision narrative — the shared, per-revision "what changed" explanation for
 * the Previous-Brief comparison (ADR 0024). Distinct from `DeltaBrief`: no
 * reviewer Checkpoint, no `commentsAddressed`/`addressesComments`, no
 * `wholePrImpact` verdict, and no independent `changedGroups` — every chunk
 * attaches to an existing full-Brief Change-group. `.strict()` so the schema
 * itself enforces that exclusion (an invented field like `wholePrImpact` fails
 * validation, not just documentation).
 */
export const RevisionNarrativeSchema = z
  .object({
    artifactKind: z.literal("revisionNarrative"),
    pr: PrRefSchema,
    prevHeadSha: z.string().describe("the previous briefed head SHA"),
    headSha: z.string().describe("the current head SHA"),
    prevIndex: z.number().int().describe("brief index of the previous head"),
    headIndex: z.number().int().describe("brief index of the current head"),
    generation: GenerationSchema.describe(
      "which provider/model/effort produced this narrative. CLI-assigned.",
    ),
    overview: z
      .string()
      .describe(
        "1-3 sentences on what this revision did as a whole. No line references, no group inventory.",
      ),
    chunks: z.array(RevisionNarrativeChunkSchema),
  })
  .strict();

/**
 * What the model generates for a revision narrative: RevisionNarrativeSchema
 * minus the CLI-owned metadata (`artifactKind`, `pr`, `prevHeadSha`, `headSha`,
 * `prevIndex`, `headIndex`, `generation`), filled in after generation — same
 * discipline as the brief and delta (ADR 0012/0013).
 */
export const RevisionNarrativeGenerationSchema = RevisionNarrativeSchema.omit({
  artifactKind: true,
  pr: true,
  prevHeadSha: true,
  headSha: true,
  prevIndex: true,
  headIndex: true,
  generation: true,
});

/**
 * Explicit skip stub for a Previous-Brief comparison span that never got a
 * generated narrative — huge-span fallback or config gate (ADR 0024, ADR 0006
 * huge-span threshold). Lets the FE distinguish "deliberately skipped, retry
 * won't help" from "generation failed, retry might help" (an absent
 * narrative file with marks present).
 */
export interface RevisionNarrativeSkipped {
  artifactKind: "revisionNarrativeSkipped";
  pr: PrRef;
  prevHeadSha: string;
  headSha: string;
  prevIndex: number;
  headIndex: number;
  skipped: "span too large" | "disabled by config";
}

export type PrRef = z.infer<typeof PrRefSchema>;
export type LineRange = z.infer<typeof LineRangeSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
export type ChangeGroup = z.infer<typeof ChangeGroupSchema>;
export type ReadingOrderStep = z.infer<typeof ReadingOrderStepSchema>;
export type ConcernRollup = z.infer<typeof ConcernRollupSchema>;
export type CommitRange = z.infer<typeof CommitRangeSchema>;
export type Generation = z.infer<typeof GenerationSchema>;
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type DeltaChunk = z.infer<typeof DeltaChunkSchema>;
export type DeltaBrief = z.infer<typeof DeltaBriefSchema>;
export type RevisionNarrativeChunk = z.infer<typeof RevisionNarrativeChunkSchema>;
export type RevisionNarrative = z.infer<typeof RevisionNarrativeSchema>;
