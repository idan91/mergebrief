import { z } from "zod/v4";
import { AnchorSchema, GenerationSchema } from "generators";
import type { ValueOf } from "types";

// Port vocabulary now lives in packages/generators (BRIEF-11); re-exported
// here so the categorizer's own modules and downstream consumers keep their
// import paths.
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
 * Brief schema — the heart of the categorizer.
 *
 * Mirrors the controlled vocabulary in `docs/mvp/labeling-schema.md` (the
 * authoritative closed token list) and `docs/mvp/risk-surface.md` (the 19
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

/**
 * Specificity — how actionable the composite intent corpus is (BRIEF-54,
 * ADR 0009 §2 as amended). Named here rather than inlined in
 * `IntentCheckSchema`'s `z.enum` so the FE's mirrored union can be pinned to
 * it (BRIEF-44 PR 7); the enum's wire values are unchanged.
 */
export const Specificities = {
  PRECISE: "precise",
  BROAD: "broad",
  NONE: "none",
} as const;

/**
 * Why a Previous-Brief revision narrative was deliberately not generated
 * (ADR 0024). Sentence-shaped values, not kebab tokens: these are the
 * historical wire values written into `.revision-narrative.json` stubs, so
 * they are pinned as-is and must not be "corrected".
 */
export const RevisionNarrativeSkipReasons = {
  SPAN_TOO_LARGE: "span too large",
  DISABLED_BY_CONFIG: "disabled by config",
} as const;

/** Role — carrier vs supporting. Attaches to a chunk. */
export const Roles = [
  "carrier", // holds the change-group's intent
  "supporting", // serves the carrier (its tests, docs, specs, config)
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
 * The risk-token vocabulary for ONE generation: the built-in attributes plus
 * that repo's validated custom-attribute names (ADR 0032 #11). The closed
 * enum stays enforced (server-side via the enum-preserving json_schema);
 * only its membership is per-generation. The static exports below use the
 * built-ins-only vocabulary — the CLI path and every existing caller are
 * byte-for-byte unchanged.
 *
 * Typed `z.ZodType<string>` on purpose: a stored chunk's risk tokens are
 * "built-in ∪ that generation's custom names", which the static type system
 * cannot enumerate — the honest static type is `string`, with the enum doing
 * the actual enforcement at parse time.
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
 * Narrow a wire-level state string (octokit `PullRequestInfo.state`) to a
 * `PrLifecycleState`; anything unrecognized yields `undefined` so the optional
 * envelope fields are simply omitted (fail-open — the badge just won't
 * render).
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
      "PR state at generation time (snapshot by design — BRIEF-103). CLI-assigned, optional: pre-stamping artifacts omit it.",
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
 * One short factual note attached to a chunk's risk-surface attribute — the
 * cite-or-stay-silent evidence home (ADR 0026). An array of {attr, note}
 * objects, not a record: record keys compile to `additionalProperties` in
 * JSON schema, which strict structured-output modes reject.
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

const buildChunkSchema = (riskToken: z.ZodType<string>) =>
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

// --- Intent check (BRIEF-54 + BRIEF-85, ADR 0009 §2 as twice amended) ------

/**
 * ONE item shape shared by ALL FIVE intent buckets, on the STORED/read side.
 *
 * Grammar budget (measured live 2026-07-24 and again 2026-07-25): Anthropic's
 * structured-output grammar inlines the item shape at every `$ref` site, so
 * its cost is (number of bucket arrays × fields per item), NOT the number of
 * distinct object shapes as BRIEF-54's note assumed. Measured cliff on
 * `anthropic:claude-opus-4-8`: four bucket arrays × four fields compiles;
 * five arrays, or four arrays plus a fifth field, both `400 "The compiled
 * grammar is too large"`. Neither a newer model (`claude-opus-5`) nor
 * disabling thinking moves the limit — it is schema compilation, not the
 * request shape.
 *
 * Five arrays therefore CANNOT be generated directly at any field count. The
 * GENERATION side instead emits one tagged array
 * (`IntentCheckGenerationSchema` below — a single `$ref` site, so the whole
 * intent check costs less grammar than BRIEF-54's three arrays did) and
 * `fanOutIntentCheck` splits it into these five arrays before validation.
 * The stored shape below is unchanged from the locked design, so the read
 * path, the shipped intent bar, and every BRIEF-54 brief already in the
 * database are untouched.
 *
 * Per-bucket field rules live in the mechanical floor
 * (`validateIntentCheck`) + prompt:
 *
 * - accomplished: `quote`/`sourceUrl` cited; `groupIds` at least one.
 * - statedButMissing: `quote`/`sourceUrl` cited; `groupIds` MUST be empty
 *   (a missing ask has no diff anchor by definition).
 * - doneButUnstated: `intent` describes the unstated work; `quote` and
 *   `sourceUrl` MUST be "" (no ticket side by definition); `groupIds` at
 *   least one.
 * - deviations / claimedButUnachieved (BRIEF-85, alarm-class): `quote`/
 *   `sourceUrl` cited AND `groupIds` at least one — both-sides grounding,
 *   enforced drop-not-warn (stricter than the neutral buckets).
 * - `acknowledged` is meaningful ONLY in `deviations`; MUST be `false` in
 *   every other bucket (dead-field precedent, forced by the validator).
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
      'verbatim supporting quote from the intent corpus — the SHORTEST span that still carries the ask: a full clause, never a bare fragment (~200 chars is a ceiling, never a target), never paraphrased. "" on doneButUnstated (no ticket side)',
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
 * The ticket-gated intent check (ADR 0009 §2 as twice amended): did this PR
 * do what its composite intent corpus (title + description + all ticket-like
 * linked blocks, judged together) asked? Factual buckets, never a verdict.
 * `specificity` is the master switch — broad/none means the buckets MUST be
 * empty ("never a guessed gap"), enforced mechanically post-parse. No optional
 * fields (strict structured-output; empty string / empty array = N/A).
 *
 * BRIEF-85 adds the alarm pair: `deviations` (diff opposes an ask the corpus
 * states and nowhere retracts) + `claimedButUnachieved` (corpus claims a
 * fix/delivery, diff touches only the signal/check path). Routing: behavior
 * moved against the ask ⇒ deviations; only the signal touched ⇒
 * claimedButUnachieved; uncertain ⇒ accomplished — never a guessed alarm.
 */
export const IntentCheckSchema = z.object({
  ticketUrls: z
    .array(z.string())
    .describe(
      "the linked-context URLs treated as ticket-like intent sources — ONLY URLs present in the Linked context section, never invented",
    ),
  specificity: z
    .enum([Specificities.PRECISE, Specificities.BROAD, Specificities.NONE])
    .describe(
      "how actionable the combined intent corpus is: precise (defines this change), broad (epic/parent/support — too general), none (no usable stated intent). broad/none ⇒ all five buckets empty",
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
      'work the diff does that the corpus never asked for — quote and sourceUrl MUST be "" (empty when specificity is broad/none)',
    ),
  deviations: z
    .array(IntentItemSchema)
    .describe(
      "stated asks the diff moves AGAINST that the corpus nowhere retracts (a reversal acknowledged in the PR description ⇒ acknowledged: true — quiet receipt, not alarm). Behavior moved against the ask belongs here; only its signal touched ⇒ claimedButUnachieved; uncertain ⇒ accomplished, never a guessed alarm. Verbatim quote + at least one groupId required (both-sides grounding). Empty when specificity is broad/none",
    ),
  claimedButUnachieved: z
    .array(IntentItemSchema)
    .describe(
      "asks the corpus claims fixed/delivered while the diff operates only on the problem's signal/check path (log demotion, catch-and-swallow, test skip/delete, threshold bump) — nothing in the diff plausibly fixes the problem itself. Verbatim quote + at least one groupId required (both-sides grounding). Empty when specificity is broad/none",
    ),
});

/**
 * The five bucket names, as the generation-side `bucket` tag. Deliberately
 * identical to the stored `IntentCheckSchema` array names so `fanOutIntentCheck`
 * is a mechanical dispatch and the registered vocabulary
 * (`docs/mvp/labeling-schema.md` §7) reads the same on both sides.
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
 * What the model actually emits for the intent check: ONE tagged array
 * instead of five bucket arrays. The grammar inlines the item shape per
 * `$ref` site, so five arrays cannot compile at any field count (see
 * `IntentItemSchema`); one tagged array costs a single inlined copy and
 * leaves headroom for future schema growth. `fanOutIntentCheck` converts
 * this into the stored five-array `IntentCheckSchema` before validation, so
 * nothing downstream of generation sees this shape.
 */
export const IntentGenerationItemSchema = IntentItemSchema.extend({
  bucket: z
    .enum(IntentBuckets)
    .describe(
      "which factual bucket this item belongs to. accomplished: a stated ask the diff delivers. statedButMissing: a stated ask absent from the diff. doneButUnstated: work the diff does that was never asked for. deviations: a stated ask the diff moves AGAINST and the corpus nowhere retracts. claimedButUnachieved: an ask the corpus claims is fixed while the diff touches only the problem's signal/check path",
    ),
});

export const IntentCheckGenerationSchema = z.object({
  ticketUrls: IntentCheckSchema.shape.ticketUrls,
  specificity: IntentCheckSchema.shape.specificity,
  scopeNote: IntentCheckSchema.shape.scopeNote,
  items: z
    .array(IntentGenerationItemSchema)
    .describe(
      "every intent-check finding, each tagged with its bucket. Empty when specificity is broad/none (never a guessed gap). Per-bucket field rules are in the Intent check section of the system prompt",
    ),
});

export type IntentCheckGeneration = z.infer<typeof IntentCheckGenerationSchema>;

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
      "warning lines the generation pipeline emitted (salvage, feedback retry, served-model mismatch). CLI-collected, never model-produced (BRIEF-11 UI surfacing).",
    ),
  anchor: AnchorSchema.optional().describe(
    "cross-revision anchor provenance (BRIEF-143): anchored | fresh-restart(reason) | none. CLI-assigned, never model-produced; optional on the read path — pre-feature briefs lack it.",
  ),
  summary: z
    .string()
    .describe(
      "Markdown, deliberately short: a lede of 1-3 short sentences stating what the PR does and why (plain prose, no headings), then optionally a '## Changelog' of 1-3 bullets when the change warrants one. Hard caps, never targets. The lede is required; the changelog is not.",
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
  intentCheck: IntentCheckSchema.optional().describe(
    "the ticket-gated intent check (BRIEF-54). Optional on the read path only — pre-feature briefs lack it; generation always produces it (required on BriefGenerationSchema).",
  ),
});

/**
 * What the model actually generates for a full brief: BriefSchema minus the
 * CLI-owned metadata (`pr`, `index`, `commitRange`), which the CLI fills after
 * generation so the model never echoes identifiers it cannot know (ADR 0012).
 * `intentCheck` is REQUIRED here (the model always judges the corpus) while
 * staying optional on the stored/read `BriefSchema` — pre-BRIEF-54 briefs
 * simply have no intent bar. It also uses the GENERATION shape (one tagged
 * `items` array, a grammar-budget requirement — see `IntentItemSchema`);
 * `fanOutIntentCheck` converts it to the stored five-array shape.
 */
export const BriefGenerationSchema = BriefSchema.omit({
  pr: true,
  index: true,
  commitRange: true,
  generation: true,
  generationWarnings: true,
  anchor: true,
}).extend({
  intentCheck: IntentCheckGenerationSchema,
});

export type BriefGeneration = z.infer<typeof BriefGenerationSchema>;

/**
 * The brief-generation schema for ONE generation, with the repo's validated
 * custom-attribute names added to the closed risk vocabulary (ADR 0032 #11 /
 * plan PR 3): the extended enum flows into the enum-preserving json_schema,
 * so the model can only decode names the repo actually defined — built-in
 * enforcement stays intact, and no custom names means the exact static
 * schema. The inferred type is identical either way (risk tokens are
 * statically `string` — see `riskTokenEnum`).
 */
export function briefGenerationSchemaWith(
  customNames: readonly string[],
): z.ZodType<BriefGeneration> {
  if (customNames.length === 0) {
    return BriefGenerationSchema;
  }
  return BriefGenerationSchema.extend({
    chunks: z.array(buildChunkSchema(riskTokenEnum(customNames))),
  });
}

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
  generationWarnings: z
    .array(z.string())
    .optional()
    .describe(
      "warning lines the generation pipeline emitted. CLI-collected (BRIEF-11 UI surfacing).",
    ),
  summary: z
    .string()
    .describe(
      "Markdown reload, deliberately short: a lede of 1-3 short sentences on what changed *since the baseline* (plain prose, no headings), then optionally a '## Changelog' of 1-3 bullets covering the follow-up commits. Hard caps, never targets. Frame it as 'since you last looked'.",
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
  generationWarnings: true,
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
    generationWarnings: z
      .array(z.string())
      .optional()
      .describe(
        "warning lines the generation pipeline emitted. CLI-collected (BRIEF-11 UI surfacing).",
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
  generationWarnings: true,
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
  skipped: RevisionNarrativeSkipReason;
}

export type PrRef = z.infer<typeof PrRefSchema>;
export type IntentItem = z.infer<typeof IntentItemSchema>;
export type IntentCheck = z.infer<typeof IntentCheckSchema>;
export type LineRange = z.infer<typeof LineRangeSchema>;
export type RiskNote = z.infer<typeof RiskNoteSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
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
