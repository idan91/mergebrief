import { z } from "zod/v4";
import { AnchorSchema, GenerationSchema } from "generators";
import type { ValueOf } from "types";

// Port vocabulary lives in packages/generators; re-exported here so existing
// import paths keep working.
export {
  AnchorSchema,
  AnchorStates,
  Efforts,
  FreshRestartReasons,
  GenerationSchema,
  type Anchor,
  type AnchorState,
  type Effort,
  type FreshRestartReason,
  type Generation,
} from "generators";

/**
 * Brief schema. Generation surface: schema changes are eval-gated.
 *
 * Enums mirror the closed vocabulary docs (`docs/mvp/labeling-schema.md`,
 * `docs/mvp/risk-surface.md`) and change only in lockstep with them.
 *
 * Structured-output constraints: no recursive schemas, no min/max. Always-present
 * arrays (empty when N/A) instead of optionality, to keep the strict schema simple.
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
  "implementation", // the functional change itself (default core)
  "test", // tests, fixtures (incl. .test.* / .spec.* files)
  "doc", // docs, READMEs, changesets, doc-only files
  "spec", // specification document (NOT .spec.ts — that's test)
  "config", // configuration files
  "generated", // generated / vendored output (lockfiles, bundles)
] as const;

/**
 * Specificity — how actionable the composite intent source is. Named rather
 * than inlined in `IntentCheckSchema` so the FE's mirrored union can pin to it.
 */
export const Specificities = {
  PRECISE: "precise",
  BROAD: "broad",
  NONE: "none",
} as const;

/**
 * Why a revision narrative was deliberately not generated. Sentence-shaped
 * values, not kebab tokens: pinned wire values already written into
 * `.revision-narrative.json` stubs — never "correct" them.
 */
export const RevisionNarrativeSkipReasons = {
  SPAN_TOO_LARGE: "span too large",
  DISABLED_BY_CONFIG: "disabled by config",
} as const;

/** Role — core vs supporting. Attaches to a chunk. */
export const Roles = [
  "core", // holds the change-group's intent
  "supporting", // serves the core (its tests, docs, specs, config)
] as const;

/**
 * Risk surface — 19 factual attributes (never verdicts). Attaches to a chunk.
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
  "new-dependency",
  "new-abstraction",
  "comment-contradicts-code",
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
export type Specificity = ValueOf<typeof Specificities>;
export type RevisionNarrativeSkipReason = ValueOf<
  typeof RevisionNarrativeSkipReasons
>;

const categoryEnum = z.enum(Categories);
const concernEnum = z.enum(Concerns);
const roleEnum = z.enum(Roles);

/**
 * The risk-token vocabulary for ONE generation: built-in attributes plus that
 * repo's validated custom names. The closed enum stays enforced server-side;
 * only its membership is per-generation.
 *
 * Typed `z.ZodType<string>` on purpose: the per-generation membership cannot be
 * enumerated statically — the enum enforces it at parse time.
 */
function riskTokenEnum(customNames: readonly string[]): z.ZodType<string> {
  const [first, ...rest] = RiskSurfaceAttributes;
  return z.enum([first, ...rest, ...customNames]);
}

const riskSurfaceEnum = riskTokenEnum([]);

// --- Brief shape ----------------------------------------------------------

/** GitHub PR lifecycle states — a merged PR's `state` is `closed`. */
export const PrLifecycleStates = ["open", "closed"] as const;

export type PrLifecycleState = (typeof PrLifecycleStates)[number];

/**
 * Narrow a wire-level state string to a `PrLifecycleState`. Unrecognized values
 * yield `undefined` so the optional envelope fields are omitted (fail-open).
 */
export function toPrLifecycleState(
  value: string,
): PrLifecycleState | undefined {
  return value === "open" || value === "closed" ? value : undefined;
}

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
  state: z
    .enum(PrLifecycleStates)
    .optional()
    .describe(
      "PR state at generation time (snapshot by design). CLI-assigned, optional: pre-stamping artifacts omit it.",
    ),
  draft: z
    .boolean()
    .optional()
    .describe("whether the PR was a draft at generation time. CLI-assigned."),
  merged: z
    .boolean()
    .optional()
    .describe(
      "whether the PR was merged at generation time (merged implies state=closed). CLI-assigned.",
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

/**
 * One short factual note evidencing a chunk's risk-surface attribute. An array
 * of {attr, note}, not a record: record keys compile to `additionalProperties`,
 * which strict structured-output modes reject.
 */
function buildRiskNoteSchema(riskToken: z.ZodType<string>) {
  return z.object({
    attr: riskToken.describe(
      "the risk-surface attribute this note evidences (must also be in the chunk's riskSurface)",
    ),
    note: z
      .string()
      .describe(
        'one short factual note. For `comment-contradicts-code` it MUST cite both sides: the comment line and the code line, e.g. "comment says X (L12), code does Y (L15)".',
      ),
  });
}

export const RiskNoteSchema = buildRiskNoteSchema(riskSurfaceEnum);

/**
 * The model-facing chunk shape: attribution only (concern, role, ranges) —
 * no counts. `loc` is derived by the pipeline from the chunk's ranges
 * intersected with the diff's changed lines, so the model never counts.
 */
const buildChunkGenerationSchema = (riskToken: z.ZodType<string>) =>
  z.object({
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
      "core holds the group's intent — never 'most important' or largest; supporting serves it. Default from concern (implementation→core, else supporting); flip when a supporting artifact is itself the purpose (e.g. flaky-test fix). Type, context, and CSS/style files are core when they define the changed contract, state model, or visual behavior; supporting only when they merely accompany another core chunk.",
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
      .array(riskToken)
      .describe(
        "factual attributes that apply to this chunk (empty if none). Never verdicts — severity emerges from combinations.",
      ),
    riskNotes: z
      .array(buildRiskNoteSchema(riskToken))
      .optional()
      .describe(
        'optional short factual notes, one per risk-surface attribute on this chunk that needs evidence. REQUIRED for `comment-contradicts-code`: the note must cite both sides — the comment line and the code line, e.g. "comment says X (L12), code does Y (L15)". Omit entirely when no attribute needs a note.',
      ),
  });

/** The derived per-chunk count the pipeline stamps post-generation. */
const ChunkLocSchema = z
  .object({
    added: z.number().int().describe("lines added in this chunk"),
    deleted: z.number().int().describe("lines deleted in this chunk"),
  })
  .describe(
    "derived, never model-produced: |chunk ranges ∩ the diff's changed lines| per side",
  );

/** The stored chunk shape: the generation chunk plus the derived `loc`. */
const buildChunkSchema = (riskToken: z.ZodType<string>) =>
  buildChunkGenerationSchema(riskToken).extend({ loc: ChunkLocSchema });

export const ChunkGenerationSchema =
  buildChunkGenerationSchema(riskSurfaceEnum);
export const ChunkSchema = buildChunkSchema(riskSurfaceEnum);

export const ChangeGroupSchema = z.object({
  id: z
    .string()
    .describe(
      "stable group id referenced by chunks' changeGroupId, e.g. g1, g2, …",
    ),
  title: z
    .string()
    .describe(
      "a one-line title describing the change group (what, not why), ideally under ~100 characters (~150 ceiling), e.g. 'Add stock-location module to inventory service'",
    ),
  summary: z
    .string()
    .describe(
      "what the group does (what, not why), one group = one summary: 1-2 short sentences, ~200 characters ideal (~250 ceiling, never a target)",
    ),
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
 * One step of a Brief's reading order: a change-group id plus a one-line
 * comprehension-language reason it comes next. `why` is never a verdict — no
 * importance/priority/severity words, no scores.
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

/**
 * Changed lines no chunk claims, as per-file ranges — counts always derive
 * from the ranges. Pipeline-assigned, never model-produced.
 */
export const UnattributedFileSchema = z.object({
  file: z.string().describe("file path with unattributed changed lines"),
  addedRanges: z
    .array(LineRangeSchema)
    .describe("new-side changed lines no chunk claims"),
  removedRanges: z
    .array(LineRangeSchema)
    .describe("old-side changed lines no chunk claims"),
});

/**
 * Whole-diff changed-line totals derived from the parsed diff — exact even
 * when inter-chunk overlaps double-count a line in the per-chunk sums.
 * Pipeline-assigned, never model-produced.
 */
export const DiffTotalsSchema = z.object({
  added: z.number().int().describe("total added lines across the whole diff"),
  deleted: z
    .number()
    .int()
    .describe("total removed lines across the whole diff"),
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
 * CLI-owned metadata; the model never produces it.
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
 * A PR review comment as carried in the `.comments.json` sidecar. `outdated` is
 * read from GitHub (position == null), never recomputed.
 */
export const ReviewCommentSchema = z.object({
  id: z.string(),
  file: z.string(),
  startLine: z
    .number()
    .int()
    .nullable()
    .describe(
      "current diff range start; null for single-line comments, file-level comments, or outdated anchors",
    ),
  line: z
    .number()
    .int()
    .nullable()
    .describe("current diff line/range end; null if outdated"),
  originalStartLine: z
    .number()
    .int()
    .nullable()
    .describe(
      "range start at the time the comment was made; null for single-line comments",
    ),
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

// --- Intent check ---------------------------------------------------------

/**
 * ONE item shape shared by ALL FIVE intent buckets, on the STORED/read side.
 *
 * Grammar budget: the structured-output grammar inlines the item shape at every
 * `$ref` site, so cost is (bucket arrays × fields per item). Five arrays do not
 * compile at any field count — generation emits one tagged array
 * (`IntentCheckGenerationSchema`) and `fanOutIntentCheck` splits it before
 * validation.
 *
 * Per-bucket field rules are enforced by `validateIntentCheck` + prompt:
 * statedButMissing must have empty `groupIds`; doneButUnstated must have empty
 * `quote`/`sourceUrl`; deviations and claimedButUnachieved require both sides
 * (quote + at least one groupId), dropped not warned; `acknowledged` is
 * meaningful only in `deviations` and must be false elsewhere.
 */
export const IntentItemSchema = z.object({
  intent: z
    .string()
    .describe(
      "one short line: the stated ask (accomplished/statedButMissing), the unstated work done (doneButUnstated), the opposed ask and what the diff does against it (deviations), or the claimed-but-masked ask (claimedButUnachieved). What, not why.",
    ),
  quote: z
    .string()
    .describe(
      'verbatim supporting quote from the intent sources — the SHORTEST span that still carries the ask: a full clause, never a bare fragment (~200 chars is a ceiling, never a target), never paraphrased. "" on doneButUnstated (no ticket side)',
    ),
  sourceUrl: z
    .string()
    .describe(
      'source of the quote: "" when it comes from the PR title/description, else one of ticketUrls. Always "" on doneButUnstated',
    ),
  groupIds: z
    .array(z.string())
    .describe(
      "ids of the changeGroups delivering this item. accomplished, doneButUnstated, deviations, claimedButUnachieved: at least one; statedButMissing: MUST be empty — a missing ask has no diff anchor by definition",
    ),
  acknowledged: z
    .boolean()
    .describe(
      "deviations ONLY: true when the PR description acknowledges this reversal (a quiet receipt, not an alarm). MUST be false in every other bucket — the field is dead there",
    ),
});

/**
 * The ticket-gated intent check: did this PR do what its composite intent
 * source (title + description + ticket-like linked blocks) asked? Factual
 * buckets, never a verdict. `specificity` is the master switch — broad/none
 * means every bucket MUST be empty, enforced mechanically post-parse. No
 * optional fields (strict structured-output; "" / [] = N/A).
 */
const TICKET_TITLES_DESCRIPTION =
  'display title for each ticketUrls entry — same order and length, the source\'s own heading/summary line verbatim, never invented or paraphrased; "" when the source shows no usable title';

export const IntentCheckSchema = z.object({
  ticketUrls: z
    .array(z.string())
    .describe(
      "the linked-context URLs treated as ticket-like intent sources — ONLY URLs present in the Linked context section, never invented",
    ),
  // `.default([])` is stored-side back-compat only: pre-title artifacts parse
  // as title-less. The generation schema requires the field.
  ticketTitles: z
    .array(z.string())
    .default([])
    .describe(TICKET_TITLES_DESCRIPTION),
  specificity: z
    .enum([Specificities.PRECISE, Specificities.BROAD, Specificities.NONE])
    .describe(
      "how actionable the combined intent sources are: precise (defines this change), broad (epic/parent/support — too general), none (no usable stated intent). broad/none ⇒ all five buckets empty",
    ),
  scopeNote: z
    .string()
    .describe(
      'one sentence of scope facts when the ticket deliberately spans beyond this PR (e.g. a stacked series); "" otherwise — usually empty',
    ),
  accomplished: z
    .array(IntentItemSchema)
    .describe(
      "stated asks the diff accomplishes (empty when specificity is broad/none)",
    ),
  statedButMissing: z
    .array(IntentItemSchema)
    .describe(
      "stated asks not found in the diff — groupIds MUST be empty on every item (whole array empty when specificity is broad/none)",
    ),
  doneButUnstated: z
    .array(IntentItemSchema)
    .describe(
      'work the diff does that the sources never asked for — quote and sourceUrl MUST be "" (empty when specificity is broad/none)',
    ),
  deviations: z
    .array(IntentItemSchema)
    .describe(
      "stated asks the diff moves AGAINST that the sources nowhere retract (a reversal acknowledged in the PR description ⇒ acknowledged: true — quiet receipt, not alarm). Behavior moved against the ask belongs here; only its signal touched ⇒ claimedButUnachieved; uncertain ⇒ accomplished, never a guessed alarm. Verbatim quote + at least one groupId required (both-sides grounding). Empty when specificity is broad/none",
    ),
  claimedButUnachieved: z
    .array(IntentItemSchema)
    .describe(
      "asks the sources claim fixed/delivered while the diff operates only on the problem's signal/check path (log demotion, catch-and-swallow, test skip/delete, threshold bump) — nothing in the diff plausibly fixes the problem itself. Verbatim quote + at least one groupId required (both-sides grounding). Empty when specificity is broad/none",
    ),
});

/**
 * The five bucket names, as the generation-side `bucket` tag. Kept identical to
 * the stored `IntentCheckSchema` array names so `fanOutIntentCheck` is a
 * mechanical dispatch and the registered vocabulary reads the same on both sides.
 */
export const IntentBuckets = [
  "accomplished",
  "statedButMissing",
  "doneButUnstated",
  "deviations",
  "claimedButUnachieved",
] as const;

export type IntentBucket = (typeof IntentBuckets)[number];

/**
 * What the model emits for the intent check: ONE tagged array instead of five
 * bucket arrays, a grammar-budget requirement (see `IntentItemSchema`).
 * `fanOutIntentCheck` converts it to the stored shape before validation, so
 * nothing downstream of generation sees this.
 */
export const IntentGenerationItemSchema = IntentItemSchema.extend({
  bucket: z
    .enum(IntentBuckets)
    .describe(
      "which factual bucket this item belongs to. accomplished: a stated ask the diff delivers. statedButMissing: a stated ask absent from the diff. doneButUnstated: work the diff does that was never asked for. deviations: a stated ask the diff moves AGAINST and the sources nowhere retract. claimedButUnachieved: an ask the sources claim is fixed while the diff touches only the problem's signal/check path",
    ),
});

export const IntentCheckGenerationSchema = z.object({
  ticketUrls: IntentCheckSchema.shape.ticketUrls,
  // Required on the wire — strict structured output has no optional fields;
  // [] when there are no tickets.
  ticketTitles: z.array(z.string()).describe(TICKET_TITLES_DESCRIPTION),
  specificity: IntentCheckSchema.shape.specificity,
  scopeNote: IntentCheckSchema.shape.scopeNote,
  items: z
    .array(IntentGenerationItemSchema)
    .describe(
      "every intent-check finding, each tagged with its bucket. Empty when specificity is broad/none (never a guessed gap). Per-bucket field rules are in the Intent check section of the system prompt",
    ),
});

export type IntentCheckGeneration = z.infer<typeof IntentCheckGenerationSchema>;

/**
 * Which groups an anchored generation carried verbatim vs regenerated —
 * internal pipeline origin tracking, never rendered.
 */
export const AnchoringDetailSchema = z.object({
  carried: z.array(z.string()),
  regenerated: z.array(z.string()),
});
export type AnchoringDetail = z.infer<typeof AnchoringDetailSchema>;

/**
 * Text surfaces the length floor covers. The PR lede/changelog deliberately
 * stays out — its caps are prompt-enforced.
 */
export const TextSurfaces = {
  GROUP_TITLE: "group-title",
  GROUP_SUMMARY: "group-summary",
  NARRATIVE_OVERVIEW: "narrative-overview",
  NARRATIVE_CHUNK_SUMMARY: "narrative-chunk-summary",
  RISK_NOTE: "risk-note",
} as const;
export type TextSurface = ValueOf<typeof TextSurfaces>;

/**
 * One over-cap text field: the structured side of a warn-only length check, so
 * the FE need not parse warning strings. Pipeline-assigned, never
 * model-produced — deliberately NOT part of any generation schema; the caps
 * live in the prompt and the schema stays cap-free.
 */
export const LengthViolationSchema = z.object({
  surface: z.enum([
    TextSurfaces.GROUP_TITLE,
    TextSurfaces.GROUP_SUMMARY,
    TextSurfaces.NARRATIVE_OVERVIEW,
    TextSurfaces.NARRATIVE_CHUNK_SUMMARY,
    TextSurfaces.RISK_NOTE,
  ]),
  field: z
    .string()
    .describe('which field, e.g. "group g2 summary" — human-readable anchor'),
  actual: z.number().int(),
  cap: z.number().int(),
});
export type LengthViolation = z.infer<typeof LengthViolationSchema>;

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
  generationWarnings: z
    .array(z.string())
    .optional()
    .describe(
      "warning lines the generation pipeline emitted (salvage, feedback retry, served-model mismatch). CLI-collected, never model-produced.",
    ),
  anchor: AnchorSchema.optional().describe(
    "cross-revision anchor origin: anchored | fresh-restart(reason) | none. CLI-assigned, never model-produced; optional on the read path — pre-feature briefs lack it.",
  ),
  anchoring: AnchoringDetailSchema.optional().describe(
    "internal per-group carried-vs-regenerated stamp for anchored generations. Pipeline-assigned, never model-produced, not user-visible; present only on anchored briefs.",
  ),
  lengthViolations: z
    .array(LengthViolationSchema)
    .optional()
    .describe(
      "text fields exceeding the length caps (warn-only floor). Pipeline-assigned, never model-produced; absent when everything fits.",
    ),
  summary: z
    .string()
    .describe(
      "Markdown, deliberately short: a lede of 1-3 short sentences stating what the PR does and why (plain text, no headings), then optionally a '## Changelog' of 1-3 bullets when the change warrants one. Hard caps, never targets. The lede is required; the changelog is not.",
    ),
  changeGroups: z.array(ChangeGroupSchema),
  chunks: z.array(ChunkSchema),
  concernView: z
    .array(ConcernRollupSchema)
    .describe(
      "LoC rollup per concern (one entry per concern present). Derived from chunk loc post-generation, never model-produced.",
    ),
  unattributed: z
    .array(UnattributedFileSchema)
    .optional()
    .describe(
      "changed lines no chunk claims, as per-file ranges. Pipeline-assigned ([] when fully attributed); absent on pre-feature briefs.",
    ),
  diffTotals: DiffTotalsSchema.optional().describe(
    "whole-diff added/removed totals derived from the parsed diff. Pipeline-assigned; absent on pre-feature briefs.",
  ),
  readingOrder: z
    .array(ReadingOrderStepSchema)
    .optional()
    .describe(
      "optional reading order over changeGroups (ADR 0025): a strict permutation of their ids — each group exactly once, no revisits — in foundation-first order (schema/types → logic → call sites/wiring), falling back to context-first/churn-last for independent groups. Omit when no clear order applies. Mechanically validated post-parse as a permutation of the emitted group ids; dropped with a warning (not a hard failure) if it isn't.",
    ),
  intentCheck: IntentCheckSchema.optional().describe(
    "the ticket-gated intent check. Optional on the read path only — pre-feature briefs lack it; generation always produces it (required on BriefGenerationSchema).",
  ),
});

/**
 * What the model generates for a full brief: BriefSchema minus the CLI-owned
 * metadata, filled in after generation so the model never echoes identifiers it
 * cannot know. `intentCheck` is REQUIRED here but optional on the stored
 * `BriefSchema` — older briefs have no intent bar — and uses the generation
 * shape (one tagged `items` array). Counts never ride the wire: chunks carry
 * ranges only (no `loc`), and `concernView`/`unattributed` are derived
 * post-generation.
 */
export const BriefGenerationSchema = BriefSchema.omit({
  pr: true,
  index: true,
  commitRange: true,
  generation: true,
  generationWarnings: true,
  anchor: true,
  anchoring: true,
  lengthViolations: true,
  concernView: true,
  unattributed: true,
  diffTotals: true,
}).extend({
  chunks: z.array(ChunkGenerationSchema),
  intentCheck: IntentCheckGenerationSchema,
});

export type BriefGeneration = z.infer<typeof BriefGenerationSchema>;

/**
 * The brief-generation schema for ONE generation, with the repo's validated
 * custom-attribute names added to the closed risk vocabulary. The extended enum
 * flows into the enum-preserving json_schema, so the model can only decode names
 * the repo actually defined; no custom names means the exact static schema.
 */
export function briefGenerationSchemaWith(
  customNames: readonly string[],
): z.ZodType<BriefGeneration> {
  if (customNames.length === 0) {
    return BriefGenerationSchema;
  }
  return BriefGenerationSchema.extend({
    chunks: z.array(buildChunkGenerationSchema(riskTokenEnum(customNames))),
  });
}

/**
 * Delta chunk = a brief chunk plus delta-only fields: a one-line what-changed
 * summary and the review comment(s) this chunk resolves. The delta covers the
 * code-change narrative only — per-reviewer carry-over state is out of scope.
 */
const DeltaChunkFields = {
  summary: z
    .string()
    .describe("one-line, what changed in this chunk (what, not why)"),
  addressesComments: z
    .array(z.string())
    .describe(
      "ids of the review comments this chunk resolves (empty if it addresses none)",
    ),
};

export const DeltaChunkSchema = ChunkSchema.extend(DeltaChunkFields);

/** The model-facing delta chunk: same omission — no counts on the wire. */
export const DeltaChunkGenerationSchema =
  ChunkGenerationSchema.extend(DeltaChunkFields);

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
  generationWarnings: z
    .array(z.string())
    .optional()
    .describe("warning lines the generation pipeline emitted. CLI-collected."),
  lengthViolations: z
    .array(LengthViolationSchema)
    .optional()
    .describe(
      "text fields exceeding the length caps (warn-only floor). Pipeline-assigned, never model-produced; absent when everything fits.",
    ),
  summary: z
    .string()
    .describe(
      "Markdown reload, deliberately short: a lede of 1-3 short sentences on what changed *since the baseline* (plain text, no headings), then optionally a '## Changelog' of 1-3 bullets covering the follow-up commits. Hard caps, never targets. Frame it as 'since you last looked'.",
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
 * fields, which the CLI fills after generation — same discipline as the brief.
 */
export const DeltaBriefGenerationSchema = DeltaBriefSchema.omit({
  pr: true,
  baselineSha: true,
  headSha: true,
  baselineIndex: true,
  headIndex: true,
  generation: true,
  generationWarnings: true,
  lengthViolations: true,
}).extend({
  chunks: z
    .array(DeltaChunkGenerationSchema)
    .describe("chunks of the incremental change only"),
});

/**
 * Revision-narrative chunk — attaches an incremental (prevHead→head) change to
 * an existing full-Brief change-group. Deliberately lean vs `Chunk`/`DeltaChunk`:
 * no concern/role/loc/riskSurface, since the full Brief already owns that
 * taxonomy and the narrative only explains what is new.
 */
export const RevisionNarrativeChunkSchema = z.object({
  id: z.string().describe("stable chunk id, e.g. rc1, rc2, …"),
  briefChangeGroupId: z
    .string()
    .describe(
      "id of an existing change-group on the CURRENT FULL BRIEF this chunk explains. Never invent an id — if no group fits confidently, use the closest one and note the uncertainty in the `summary` text instead.",
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
      "ONE concrete sentence specific to these changed lines, ideally under ~100 characters (~150 ceiling, never a target) — what changed, not why; shared/impersonal voice",
    ),
});

/**
 * Revision narrative — the shared, per-revision "what changed" explanation.
 * Distinct from `DeltaBrief`: no reviewer checkpoint, no comment handling, no
 * `wholePrImpact` verdict, no independent `changedGroups`. `.strict()` so an
 * invented field fails validation rather than being merely undocumented.
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
    generationWarnings: z
      .array(z.string())
      .optional()
      .describe(
        "warning lines the generation pipeline emitted. CLI-collected.",
      ),
    lengthViolations: z
      .array(LengthViolationSchema)
      .optional()
      .describe(
        "text fields exceeding the length caps (warn-only floor). Pipeline-assigned, never model-produced; absent when everything fits.",
      ),
    overview: z
      .string()
      .describe(
        "1-2 short sentences on what this revision did as a whole (~250 characters max — a ceiling, never a target). No line references, no group inventory.",
      ),
    chunks: z.array(RevisionNarrativeChunkSchema),
  })
  .strict();

/**
 * What the model generates for a revision narrative: RevisionNarrativeSchema
 * minus the CLI-owned metadata, filled in after generation — same discipline as
 * the brief and delta.
 */
export const RevisionNarrativeGenerationSchema = RevisionNarrativeSchema.omit({
  artifactKind: true,
  pr: true,
  prevHeadSha: true,
  headSha: true,
  prevIndex: true,
  headIndex: true,
  generation: true,
  generationWarnings: true,
  lengthViolations: true,
});

/**
 * Explicit skip stub for a comparison span that never got a generated narrative
 * — huge-span fallback or config gate. Lets the FE distinguish "deliberately
 * skipped, retry won't help" from "generation failed, retry might help".
 */
export interface RevisionNarrativeSkipped {
  artifactKind: "revisionNarrativeSkipped";
  pr: PrRef;
  prevHeadSha: string;
  headSha: string;
  prevIndex: number;
  headIndex: number;
  skipped: RevisionNarrativeSkipReason;
}

export type PrRef = z.infer<typeof PrRefSchema>;
export type IntentItem = z.infer<typeof IntentItemSchema>;
export type IntentCheck = z.infer<typeof IntentCheckSchema>;
export type LineRange = z.infer<typeof LineRangeSchema>;
export type RiskNote = z.infer<typeof RiskNoteSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
export type ChunkGeneration = z.infer<typeof ChunkGenerationSchema>;
export type DeltaChunkGeneration = z.infer<typeof DeltaChunkGenerationSchema>;
export type UnattributedFile = z.infer<typeof UnattributedFileSchema>;
export type DiffTotals = z.infer<typeof DiffTotalsSchema>;
export type ChangeGroup = z.infer<typeof ChangeGroupSchema>;
export type ReadingOrderStep = z.infer<typeof ReadingOrderStepSchema>;
export type ConcernRollup = z.infer<typeof ConcernRollupSchema>;
export type CommitRange = z.infer<typeof CommitRangeSchema>;
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type DeltaChunk = z.infer<typeof DeltaChunkSchema>;
export type DeltaBrief = z.infer<typeof DeltaBriefSchema>;
export type RevisionNarrativeChunk = z.infer<
  typeof RevisionNarrativeChunkSchema
>;
export type RevisionNarrative = z.infer<typeof RevisionNarrativeSchema>;
