import { z } from "zod/v4";
import { AnchorSchema, GenerationSchema } from "generators/generation";
import { ChangeGroupCategories, TicketTrackers, type ValueOf } from "types";
import { PrStackSchema } from "./pr-stack";
import { isMediaKey } from "./media/key";
import type { MediaKey } from "./media/types";

/**
 * Brief schema. Generation surface: schema changes are eval-gated.
 *
 * Enums mirror the closed vocabulary docs (`docs/vocabulary/labeling-schema.md`,
 * `docs/vocabulary/risk-surface.md`) and change only in lockstep with them.
 *
 * Structured-output constraints: no recursive schemas, no min/max. Always-present
 * arrays (empty when N/A) instead of optionality, to keep the strict schema simple.
 */

// --- Closed vocabularies (one source of truth per axis) -------------------

/** Concern - artifact. Attaches to a chunk. Mostly derivable from file path. */
export const Concerns = {
  IMPLEMENTATION: "implementation", // the functional change itself (default core)
  TEST: "test", // tests, fixtures (incl. .test.* / .spec.* files)
  DOC: "doc", // docs, READMEs, changesets, doc-only files
  SPEC: "spec", // specification document (NOT .spec.ts - that's test)
  CONFIG: "config", // configuration files
  GENERATED: "generated", // generated / vendored output (lockfiles, bundles)
} as const;

/**
 * Specificity - how actionable the composite intent source is. Named rather
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
 * `.revision-narrative.json` stubs - never "correct" them.
 */
export const RevisionNarrativeSkipReasons = {
  SPAN_TOO_LARGE: "span too large",
  DISABLED_BY_CONFIG: "disabled by config",
} as const;

/** Why a checkpoint span stores a skip record instead of a Delta Brief. */
export const DeltaSkipReasons = {
  SPAN_TOO_LARGE: "span-too-large",
  OUTPUT_CUT: "output-cut",
} as const;

/** Role - core vs supporting. Attaches to a chunk. */
export const Roles = {
  CORE: "core", // holds the change-group's intent
  SUPPORTING: "supporting", // serves the core (its tests, docs, specs, config)
} as const;

/**
 * Risk surface the model observes - 19 factual attributes (never verdicts).
 * Attaches to a chunk. Three buckets: about the code / about the change /
 * about the blast radius.
 */
export const ModelRiskSurfaceAttributes = {
  // about the CODE
  NO_TESTS: "no-tests",
  NO_TYPES: "no-types",
  LEGACY_AREA: "legacy-area",
  DENSE_LOGIC: "dense-logic",
  // about the CHANGE
  TOUCHES_AUTH: "touches-auth",
  MUTATES_STATE: "mutates-state",
  REMOVES_VALIDATION: "removes-validation",
  RELAXES_PERMISSIONS: "relaxes-permissions",
  WIDENS_ERROR_HANDLING: "widens-error-handling",
  ADDS_FEATURE_FLAG: "adds-feature-flag",
  NEW_DEPENDENCY: "new-dependency",
  NEW_ABSTRACTION: "new-abstraction",
  COMMENT_CONTRADICTS_CODE: "comment-contradicts-code",
  // about the BLAST RADIUS
  EXTERNAL_IO: "external-io",
  CROSS_SERVICE: "cross-service",
  SCHEMA_ADJACENT: "schema-adjacent",
  HOT_PATH: "hot-path",
  WIDELY_IMPORTED: "widely-imported",
  RELEASE_IMMINENT: "release-imminent",
} as const;

/**
 * Attributes the pipeline sets from the diff itself, after validation. The
 * model's schema and prompt never offer them, so it can neither emit nor
 * drop one, and the Unattributed remainder may carry them.
 */
export const CodeSetRiskAttributes = {
  // about the CHANGE
  ADDS_SECRET: "adds-secret",
  CHANGES_PACKAGE_SOURCE: "changes-package-source",
} as const;

export const RiskSurfaceAttributes = {
  ...ModelRiskSurfaceAttributes,
  ...CodeSetRiskAttributes,
} as const;

/**
 * Custom-attribute names double as json_schema enum tokens and prompt text,
 * so their charset is a security control, not a style preference: kebab-case
 * identifiers only, ≤ 50 chars. `repo-config` enforces the same shape at the
 * YAML boundary; this is the categorizer's own floor (never trust upstream).
 * Every built-in name fits it too, so the stored-Brief reader checks any risk
 * token against it.
 */
export const CUSTOM_ATTRIBUTE_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const CUSTOM_ATTRIBUTE_NAME_MAX_CHARS = 50;

/**
 * MergeBrief's own cap, not GitHub's: past GitHub's pull request diff limit
 * the worker reads the compare diff only for a pull request changing at most
 * this many files. `generationError.diff-too-large` interpolates it; the
 * Entry comment's reasons stay parameter-free, so that one spells it out.
 */
export const MAX_BRIEFED_CHANGED_FILES = 3_000;

export type Concern = ValueOf<typeof Concerns>;
export type Role = ValueOf<typeof Roles>;
export type RiskSurfaceAttribute = ValueOf<typeof RiskSurfaceAttributes>;
export type ModelRiskSurfaceAttribute = ValueOf<
  typeof ModelRiskSurfaceAttributes
>;
export type Specificity = ValueOf<typeof Specificities>;
export type ShortenedReading = ValueOf<typeof ShortenedReadings>;
export type RevisionNarrativeSkipReason = ValueOf<
  typeof RevisionNarrativeSkipReasons
>;
export type DeltaSkipReason = ValueOf<typeof DeltaSkipReasons>;

const categoryEnum = z.enum(ChangeGroupCategories);
const concernEnum = z.enum(Concerns);
const roleEnum = z.enum(Roles);

/**
 * The risk-token vocabulary for ONE generation: built-in attributes plus that
 * repo's validated custom names. The closed enum stays enforced server-side;
 * only its membership is per-generation.
 *
 * Typed `z.ZodType<string>` on purpose: the per-generation membership cannot be
 * enumerated statically - the enum enforces it at parse time.
 */
function riskTokenEnum(customNames: readonly string[]): z.ZodType<string> {
  return z.enum([...Object.values(ModelRiskSurfaceAttributes), ...customNames]);
}

/** What a model may emit: the code-set attributes are never offered. */
const modelRiskEnum = riskTokenEnum([]);
/** What a stored chunk may carry: every built-in attribute. */
const storedRiskEnum: z.ZodType<string> = z.enum(RiskSurfaceAttributes);
const codeSetRiskEnum: z.ZodType<string> = z.enum(CodeSetRiskAttributes);

// --- Brief shape ----------------------------------------------------------

/** GitHub PR lifecycle states - a merged PR's `state` is `closed`. */
export const PrLifecycleStates = {
  OPEN: "open",
  CLOSED: "closed",
} as const;

export type PrLifecycleState = ValueOf<typeof PrLifecycleStates>;

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
  repo: z.string().describe("owner/name, e.g. idan91/mergebrief"),
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
  headRef: z
    .string()
    .optional()
    .describe(
      "head branch name at generation time. CLI-assigned, optional: older artifacts omit it.",
    ),
  baseRef: z
    .string()
    .optional()
    .describe(
      "base branch name at generation time. CLI-assigned, optional: older artifacts omit it.",
    ),
  stack: PrStackSchema.optional().describe(
    "open-PR stack snapshot at generation time. CLI-assigned, optional: older artifacts omit it.",
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

export const RiskNoteSchema = buildRiskNoteSchema(storedRiskEnum);

/**
 * The model-facing chunk shape: attribution only (concern, role, ranges) ,
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

/** How a multi-call run read a shortened file's chunk; absent means read in full. */
export const ShortenedReadings = {
  PACKAGE_SUMMARY: "package-summary",
  COUNTS_ONLY: "counts-only",
} as const;

/**
 * What the grouping call of a multi-call run read: the full diff, or an
 * outline keeping at most N changed lines per hunk, then hunk headers only,
 * then one line per file. Listed from the fullest to the coarsest.
 */
export const OutlineForms = {
  FULL: "full",
  LINES_40: "lines-40",
  LINES_20: "lines-20",
  LINES_12: "lines-12",
  LINES_6: "lines-6",
  LINES_2: "lines-2",
  HEADERS: "headers",
  FILES: "files",
} as const;
export type OutlineForm = ValueOf<typeof OutlineForms>;

/** The stored chunk shape: the generation chunk plus the derived `loc` and `readAs`. */
const buildChunkSchema = (riskToken: z.ZodType<string>) =>
  buildChunkGenerationSchema(riskToken).extend({
    loc: ChunkLocSchema,
    readAs: z
      .enum(ShortenedReadings)
      .optional()
      .describe(
        "derived, never model-produced: how a multi-call run read a lockfile, generated or vendored file; absent when read in full",
      ),
  });

export const ChunkGenerationSchema = buildChunkGenerationSchema(modelRiskEnum);
export const ChunkSchema = buildChunkSchema(storedRiskEnum);
export type ChunkGeneration = z.infer<typeof ChunkGenerationSchema>;

/** Any attribute name a run may have offered: the built-ins and a repo's custom names share this shape. */
const partRiskToken: z.ZodType<string> = z
  .string()
  .regex(CUSTOM_ATTRIBUTE_NAME_PATTERN)
  .max(CUSTOM_ATTRIBUTE_NAME_MAX_CHARS);

/**
 * A detail call's chunk as a multi-call run stores it between calls: the
 * generation shape, no `loc`, closed against any key beyond attribution so a
 * stored part never carries code text.
 */
export const PartChunkSchema =
  buildChunkGenerationSchema(partRiskToken).strict();

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
 * comprehension-language reason it comes next. `why` is never a verdict - no
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
 * Changed lines no chunk claims, as per-file ranges - counts always derive
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
  riskSurface: z
    .array(codeSetRiskEnum)
    .optional()
    .describe(
      "code-set attributes only: the remainder carries no model-observed attribute",
    ),
});

/**
 * Whole-diff changed-line totals derived from the parsed diff - exact even
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
 * The commit span a full brief covers - the whole PR, base→head - plus a count.
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
 * `$ref` site, so five arrays do not compile; generation emits one tagged array
 * (`IntentCheckGenerationSchema`) and `fanOutIntentCheck` splits it before
 * validation. Per-bucket field rules live in `validateIntentCheck` + prompt.
 */
export const IntentItemSchema = z.object({
  intent: z
    .string()
    .describe(
      "one short line: the stated ask (accomplished/statedButMissing), the unstated work done (doneButUnstated), the opposed ask and what the diff does against it (deviations), or the claimed fix the diff only masks (maskedFixes). What, not why.",
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
      "ids of the changeGroups delivering this item. accomplished, doneButUnstated, deviations, maskedFixes: at least one; statedButMissing: MUST be empty — a missing ask has no diff anchor by definition",
    ),
  acknowledged: z
    .boolean()
    .describe(
      "deviations ONLY: true when the PR description acknowledges this reversal (a quiet receipt, not an alarm). MUST be false in every other bucket — the field is dead there",
    ),
});

/** Where in the PR the primary ticket's reference was first found. */
export const ReferenceLocations = {
  DESCRIPTION: "description",
  TITLE: "title",
  BRANCH: "branch",
} as const;
export type ReferenceLocation = ValueOf<typeof ReferenceLocations>;

/** Whether the harness read the primary ticket. Harness-written, never model-produced. */
export const PrimaryTicketStatuses = {
  READ: "read",
  UNREAD: "unread",
} as const;
/** @public */
export type PrimaryTicketStatus = ValueOf<typeof PrimaryTicketStatuses>;

/** Why a primary ticket went unread: a closed set, one copy template each. */
export const TicketUnreadReasons = {
  NOT_FOUND: "not-found",
  NO_CREDENTIAL: "no-credential",
  TIMEOUT: "timeout",
  RATE_LIMITED: "rate-limited",
  UNSUPPORTED: "unsupported",
} as const;
export type TicketUnreadReason = ValueOf<typeof TicketUnreadReasons>;

/** How the diff relates to the primary ticket's goal. A read, never a gate. */
export const AlignmentReads = {
  ALIGNED: "aligned",
  PARTIAL: "partial",
  MISALIGNED: "misaligned",
} as const;
/** @public */
export type AlignmentRead = ValueOf<typeof AlignmentReads>;

const ALIGNMENT_GOAL_DESCRIPTION =
  "the shortest verbatim span of the primary ticket that states what the ticket wants achieved — the goal, not an acceptance list or an implementation step; a full clause, never a fragment; ~200 chars ceiling, never a target. The ticket title may serve as the goal when the body states none";
const ALIGNMENT_RESPONSE_DESCRIPTION =
  "one sentence, ~250 chars ceiling: what this diff does relative to the goal in plain words — what it delivers, leaves out, or does instead. Facts about the diff; never a verdict, never a recommendation, no group ids";

/** The stored alignment read: present only when the model quoted a goal that verified. */
export const TicketAlignmentSchema = z.object({
  read: z.enum([
    AlignmentReads.ALIGNED,
    AlignmentReads.PARTIAL,
    AlignmentReads.MISALIGNED,
  ]),
  goal: z.string().describe(ALIGNMENT_GOAL_DESCRIPTION),
  response: z.string().describe(ALIGNMENT_RESPONSE_DESCRIPTION),
});
export type TicketAlignment = z.infer<typeof TicketAlignmentSchema>;

/**
 * The wire shape: strict structured output has no optional fields, so "" on
 * `read` is the no-read sentinel and `fanOutIntentCheck` turns it into absence.
 */
export const TicketAlignmentGenerationSchema = z.object({
  read: z
    .enum([
      AlignmentReads.ALIGNED,
      AlignmentReads.PARTIAL,
      AlignmentReads.MISALIGNED,
      "",
    ])
    .describe(
      'aligned: the diff delivers the goal as the ticket states it. partial: the diff serves the goal and delivers one slice of it — an ordinary outcome. misaligned: the diff does not serve the goal, or serves it in a way the ticket explicitly rules out. "" when no Primary ticket is present or it states no goal you can quote',
    ),
  goal: z
    .string()
    .describe(`${ALIGNMENT_GOAL_DESCRIPTION}; "" when read is ""`),
  response: z
    .string()
    .describe(`${ALIGNMENT_RESPONSE_DESCRIPTION}; "" when read is ""`),
});

/**
 * The one ticket this PR is about, as the harness resolved and read it.
 * Stamped after generation; the model never sees or produces it.
 */
export const PrimaryTicketSchema = z.object({
  key: z
    .string()
    .describe('the tracker key, e.g. "BRIEF-239"; "" for a URL-only reference'),
  url: z.string().describe("canonical ticket URL"),
  tracker: z.enum([TicketTrackers.GITHUB, TicketTrackers.NOTION]),
  foundIn: z.enum([
    ReferenceLocations.DESCRIPTION,
    ReferenceLocations.TITLE,
    ReferenceLocations.BRANCH,
  ]),
  title: z.string().describe('the ticket title; "" when unread'),
  header: z
    .string()
    .describe(
      'the tracker header line, title first (then status, type, priority; or state, labels, milestone); "" when none',
    ),
  status: z.enum([PrimaryTicketStatuses.READ, PrimaryTicketStatuses.UNREAD]),
  reason: z
    .enum([
      TicketUnreadReasons.NOT_FOUND,
      TicketUnreadReasons.NO_CREDENTIAL,
      TicketUnreadReasons.TIMEOUT,
      TicketUnreadReasons.RATE_LIMITED,
      TicketUnreadReasons.UNSUPPORTED,
      "",
    ])
    .describe('why the ticket went unread; "" when read'),
});
export type PrimaryTicket = z.infer<typeof PrimaryTicketSchema>;

/**
 * The ticket-gated intent check: did this PR do what its composite intent
 * source (title + description + ticket-like linked blocks) asked? Factual
 * buckets, never a verdict. `specificity` is the master switch - broad/none
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
      "stated asks the diff moves AGAINST that the sources nowhere retract (a reversal acknowledged in the PR description ⇒ acknowledged: true — quiet receipt, not alarm). Behavior moved against the ask belongs here; only its signal touched ⇒ maskedFixes; uncertain ⇒ accomplished, never a guessed alarm. Verbatim quote + at least one groupId required (both-sides grounding). Empty when specificity is broad/none",
    ),
  maskedFixes: z
    .array(IntentItemSchema)
    .describe(
      "asks the sources claim fixed/delivered while the diff operates only on the problem's signal/check path (log demotion, catch-and-swallow, test skip/delete, threshold bump) — nothing in the diff plausibly fixes the problem itself. Verbatim quote + at least one groupId required (both-sides grounding). Empty when specificity is broad/none",
    ),
  primaryTicket: PrimaryTicketSchema.optional().describe(
    "the one ticket this PR is about, as the harness resolved and read it. Harness-written after generation, never model-produced; absent when the PR references no ticket.",
  ),
  alignment: TicketAlignmentSchema.optional().describe(
    "the Ticket alignment read against the primary ticket's goal. Absent when there is no primary ticket, it could not be read, the sources are broad or absent, or the goal quote did not verify.",
  ),
});

/**
 * The five bucket names, as the generation-side `bucket` tag. Kept identical to
 * the stored `IntentCheckSchema` array names so `fanOutIntentCheck` is a
 * mechanical dispatch and the registered vocabulary reads the same on both sides.
 */
export const IntentBuckets = {
  ACCOMPLISHED: "accomplished",
  STATED_BUT_MISSING: "statedButMissing",
  DONE_BUT_UNSTATED: "doneButUnstated",
  DEVIATIONS: "deviations",
  MASKED_FIXES: "maskedFixes",
} as const;

export type IntentBucket = ValueOf<typeof IntentBuckets>;

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
      "which factual bucket this item belongs to. accomplished: a stated ask the diff delivers. statedButMissing: a stated ask absent from the diff. doneButUnstated: work the diff does that was never asked for. deviations: a stated ask the diff moves AGAINST and the sources nowhere retract. maskedFixes: an ask the sources claim is fixed while the diff touches only the problem's signal/check path",
    ),
});

export const IntentCheckGenerationSchema = z.object({
  ticketUrls: IntentCheckSchema.shape.ticketUrls,
  // Required on the wire - strict structured output has no optional fields;
  // [] when there are no tickets.
  ticketTitles: z.array(z.string()).describe(TICKET_TITLES_DESCRIPTION),
  specificity: IntentCheckSchema.shape.specificity,
  scopeNote: IntentCheckSchema.shape.scopeNote,
  items: z
    .array(IntentGenerationItemSchema)
    .describe(
      "every intent-check finding, each tagged with its bucket. Empty when specificity is broad/none (never a guessed gap). Per-bucket field rules are in the Intent check section of the system prompt",
    ),
  alignment: TicketAlignmentGenerationSchema,
});

export type IntentCheckGeneration = z.infer<typeof IntentCheckGenerationSchema>;

/**
 * Which groups an anchored generation carried verbatim vs regenerated ,
 * internal pipeline origin tracking, never rendered.
 */
export const AnchoringDetailSchema = z.object({
  carried: z.array(z.string()),
  regenerated: z.array(z.string()),
});

/**
 * Text surfaces the length floor covers. The PR lede/changelog deliberately
 * stays out - its caps are prompt-enforced.
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
 * model-produced - deliberately NOT part of any generation schema; the caps
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

/** Where a shown Summary Media item sits in the Brief summary. */
export const SummaryMediaPositions = {
  BEFORE_LEDE: "before-lede",
  AFTER_LEDE: "after-lede",
} as const;
/** @public */
export type SummaryMediaPosition = ValueOf<typeof SummaryMediaPositions>;

export const SUMMARY_MEDIA_MAX_SHOWN = 2;
export const SUMMARY_MEDIA_MAX_POINTER_ITEMS = 4;
export const SUMMARY_MEDIA_LABEL_MAX_CHARS = 40;
/** A stored key past this is junk, never a normalised address. */
const MEDIA_KEY_MAX_CHARS = 4_096;

/** A key the stored Summary Media accepts; the generator drops any other before the write check sees it. */
export function isStoredMediaKey(value: string): value is MediaKey {
  const withinCap = value.length <= MEDIA_KEY_MAX_CHARS;
  return withinCap && isMediaKey(value);
}

const MediaKeySchema = z.string().refine(isStoredMediaKey, "Not a Media key");

/**
 * The Media the model picked for the Brief summary, by key, never by
 * address: the page shows a key only when it names an item of the
 * description it extracts again. Generator-written, after the trims.
 */
export const SummaryMediaSchema = z.object({
  shown: z
    .array(
      z.object({
        key: MediaKeySchema,
        position: z.enum(SummaryMediaPositions),
      }),
    )
    .max(SUMMARY_MEDIA_MAX_SHOWN),
  pointer: z
    .object({
      label: z.string().min(1).max(SUMMARY_MEDIA_LABEL_MAX_CHARS),
      items: z
        .array(MediaKeySchema)
        .min(1)
        .max(SUMMARY_MEDIA_MAX_POINTER_ITEMS),
    })
    .optional(),
});
export type SummaryMedia = z.infer<typeof SummaryMediaSchema>;

/**
 * The model's Summary Media answer: item numbers from the `<pr_media>`
 * block and position strings, kept lax so a slip trims instead of failing
 * the generation. Sent only when the description holds Media.
 */
const SummaryMediaShownGenerationSchema = z.object({
  item: z.number().describe("an item number from <pr_media>"),
  position: z
    .string()
    .describe(
      `${SummaryMediaPositions.BEFORE_LEDE} or ${SummaryMediaPositions.AFTER_LEDE}`,
    ),
});

export const SummaryMediaGenerationSchema = z.object({
  shown: z
    .array(SummaryMediaShownGenerationSchema)
    .describe(
      `0 to ${SUMMARY_MEDIA_MAX_SHOWN} items shown in the summary; empty when none shows the change better than the lede`,
    ),
  pointer: z
    .object({
      label: z
        .string()
        .describe(
          `a short plain-text label, no links, at most ${SUMMARY_MEDIA_LABEL_MAX_CHARS} characters`,
        ),
      items: z
        .array(z.number())
        .describe(
          `1 to ${SUMMARY_MEDIA_MAX_POINTER_ITEMS} item numbers from <pr_media>, none of them shown`,
        ),
    })
    .optional()
    .describe("at most one pointer to a set of items in the Media strip"),
});
export type SummaryMediaGeneration = z.infer<
  typeof SummaryMediaGenerationSchema
>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  const isObject = typeof value === "object" && value !== null;
  return isObject && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  const isNumber = typeof value === "number";
  return isNumber && Number.isFinite(value);
}

/** Item 1 is the first: a pick with no usable number stays as item 0, which names nothing, so the resolver counts it. */
const NO_ITEM = 0;
/** No position at all: the resolver reads it as unknown, places it after the lede and counts it. */
const NO_POSITION = "";

function readItemNumber(value: unknown): number {
  return isFiniteNumber(value) ? value : NO_ITEM;
}

function readShownPick(entry: unknown): Record<string, unknown> {
  if (!isPlainObject(entry)) {
    return { item: NO_ITEM, position: NO_POSITION };
  }
  const position = entry["position"];
  return {
    item: readItemNumber(entry["item"]),
    position: typeof position === "string" ? position : NO_POSITION,
  };
}

function readPointerPick(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    return { label: "", items: [] };
  }
  const label = value["label"];
  const items = Array.isArray(value["items"]) ? value["items"] : [];
  return {
    label: typeof label === "string" ? label : "",
    items: items.map(readItemNumber),
  };
}

/**
 * A malformed answer trims, never fails the brief, and every trim is
 * counted: on an adapter that does not enforce the schema, a pick keeps
 * its place with what parses of it and the resolver drops and counts the
 * rest. Anything but an object reads as no answer. The wire schema is the
 * strict shape still.
 */
function trimSummaryMediaAnswer(value: unknown): unknown {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const shown = Array.isArray(value["shown"]) ? value["shown"] : [];
  const answer: Record<string, unknown> = { shown: shown.map(readShownPick) };
  const pointer = readPointerPick(value["pointer"]);
  if (pointer !== undefined) {
    answer["pointer"] = pointer;
  }
  return answer;
}

const SUMMARY_MEDIA_GENERATION_FIELDS = {
  summaryMedia: z
    .preprocess(trimSummaryMediaAnswer, SummaryMediaGenerationSchema.optional())
    .describe("Summary Media, by item number; see the Summary Media section"),
};

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
  outlineForm: z
    .enum(OutlineForms)
    .optional()
    .describe(
      "which outline form the grouping call of a multi-call run read. Pipeline-assigned, never model-produced; absent on a single-call brief.",
    ),
  summaryMedia: SummaryMediaSchema.optional().describe(
    "the Media shown in the Brief summary and its pointer, by key. Generator-mapped from item numbers; absent when the description holds no Media or nothing valid was picked.",
  ),
});

/**
 * What the model generates for a full brief: BriefSchema minus the CLI-owned
 * metadata, filled in after generation so the model never echoes identifiers it
 * cannot know. `intentCheck` is REQUIRED here but optional on the stored
 * `BriefSchema` - older briefs have no intent bar - and uses the generation
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
  outlineForm: true,
  summaryMedia: true,
}).extend({
  chunks: z.array(ChunkGenerationSchema),
  intentCheck: IntentCheckGenerationSchema,
});

const BriefWithMediaGenerationSchema = BriefGenerationSchema.extend(
  SUMMARY_MEDIA_GENERATION_FIELDS,
);

/** A brief generation's answer; `summaryMedia` only when the request offered it. */
export type BriefGeneration = z.infer<typeof BriefWithMediaGenerationSchema>;

/** One group's hunks in the grouping call's hunk map. */
export const HunkMapEntrySchema = z.object({
  groupId: z
    .string()
    .describe("id of the change-group these hunks belong to, e.g. g1"),
  hunks: z
    .array(z.string())
    .describe(
      "each item a whole file (`f12`), one hunk (`f12h3`) or a run of consecutive hunks of one file (`f12h2-h5`), spelled exactly as the input's `### <fileId>` titles and `[hunk <id>]` markers spell them; every hunk id of the input appears exactly once across all entries",
    ),
});

/**
 * What the grouping call of a multi-call run generates: the Brief's
 * whole-PR fields and change-groups, plus the hunk map a detail call reads
 * to find its groups' code. No chunks: a detail call writes those.
 */
export const GroupingGenerationSchema = z.object({
  summary: BriefSchema.shape.summary,
  changeGroups: z.array(ChangeGroupSchema),
  hunkMap: z
    .array(HunkMapEntrySchema)
    .describe("one entry per change-group; see the Hunk map section"),
  readingOrder: BriefSchema.shape.readingOrder,
  intentCheck: IntentCheckGenerationSchema,
});

/** The grouping schema of a run whose description holds Media. */
export const GroupingWithMediaGenerationSchema =
  GroupingGenerationSchema.extend(SUMMARY_MEDIA_GENERATION_FIELDS);

/**
 * A grouping part as stored: the grouping answer with its Summary Media
 * already mapped from item numbers to keys, so a resumed run never reads a
 * number against a description edited since. A part without the field
 * still reads.
 */
export const StoredGroupingSchema = GroupingGenerationSchema.extend({
  summaryMedia: SummaryMediaSchema.optional(),
});

export type HunkMapEntry = z.infer<typeof HunkMapEntrySchema>;
export type GroupingGeneration = z.infer<
  typeof GroupingWithMediaGenerationSchema
>;
export type StoredGrouping = z.infer<typeof StoredGroupingSchema>;

function buildDetailGenerationSchema(riskToken: z.ZodType<string>) {
  return z.object({
    chunks: z
      .array(buildChunkGenerationSchema(riskToken))
      .describe(
        "one chunk per contiguous run of changed lines in the batch; every chunk's changeGroupId is the group on its hunk's marker",
      ),
  });
}

/** What a detail call of a multi-call run generates: the chunks of its batch, nothing else. */
export const DetailGenerationSchema =
  buildDetailGenerationSchema(modelRiskEnum);

export type DetailGeneration = z.infer<typeof DetailGenerationSchema>;

/** The detail schema for one run, with the repo's validated custom-attribute names in the risk vocabulary. */
export function detailGenerationSchemaWith(
  customNames: readonly string[],
): z.ZodType<DetailGeneration> {
  if (customNames.length === 0) {
    return DetailGenerationSchema;
  }
  return buildDetailGenerationSchema(riskTokenEnum(customNames));
}

/**
 * The brief-generation schema for ONE generation, with the repo's validated
 * custom-attribute names added to the closed risk vocabulary. The extended enum
 * flows into the enum-preserving json_schema, so the model can only decode names
 * the repo actually defined; no custom names means the exact static schema.
 */
export function briefGenerationSchemaWith(
  customNames: readonly string[],
  offersSummaryMedia = false,
): z.ZodType<BriefGeneration> {
  const vocabulary =
    customNames.length === 0
      ? BriefGenerationSchema
      : BriefGenerationSchema.extend({
          chunks: z.array(
            buildChunkGenerationSchema(riskTokenEnum(customNames)),
          ),
        });
  if (!offersSummaryMedia) {
    return vocabulary;
  }
  if (customNames.length === 0) {
    return BriefWithMediaGenerationSchema;
  }
  return vocabulary.extend(SUMMARY_MEDIA_GENERATION_FIELDS);
}

/** The grouping schema for one run: Summary Media only when the description holds Media. */
export function groupingGenerationSchemaWith(
  offersSummaryMedia: boolean,
): z.ZodType<GroupingGeneration> {
  return offersSummaryMedia
    ? GroupingWithMediaGenerationSchema
    : GroupingGenerationSchema;
}

/**
 * Delta chunk = a brief chunk plus delta-only fields: a one-line what-changed
 * summary and the review comment(s) this chunk resolves. The delta covers the
 * code-change narrative only - per-reviewer carry-over state is out of scope.
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

/** The model-facing delta chunk: same omission - no counts on the wire. */
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
  packageSourceFiles: z
    .array(z.string())
    .optional()
    .describe(
      "head paths of the span's files `changes-package-source` fires on that no chunk carries. Pipeline-assigned, never model-produced; absent when there are none.",
    ),
});

/**
 * What the model generates for a delta: DeltaBriefSchema minus the CLI-owned
 * fields, which the CLI fills after generation - same discipline as the brief.
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
  packageSourceFiles: true,
}).extend({
  chunks: z
    .array(DeltaChunkGenerationSchema)
    .describe("chunks of the incremental change only"),
});

/**
 * Revision-narrative chunk - attaches an incremental (prevHead→head) change to
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
 * Revision narrative - the shared, per-revision "what changed" explanation.
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
 * minus the CLI-owned metadata, filled in after generation - same discipline as
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
 * - huge-span fallback or config gate. Lets the FE distinguish "deliberately
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

/**
 * The stored record for a checkpoint span that never got a Delta Brief: the
 * span is too large for one call, or the call was cut at its output cap. A
 * retry would meet the same limit, so the view says why instead of waiting.
 */
export interface DeltaSkipped {
  artifactKind: "deltaSkipped";
  pr: PrRef;
  baselineSha: string;
  headSha: string;
  baselineIndex: number | null;
  headIndex: number | null;
  skipped: DeltaSkipReason;
}

export type PrRef = z.infer<typeof PrRefSchema>;
export type IntentItem = z.infer<typeof IntentItemSchema>;
export type IntentCheck = z.infer<typeof IntentCheckSchema>;
export type LineRange = z.infer<typeof LineRangeSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
export type UnattributedFile = z.infer<typeof UnattributedFileSchema>;
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
