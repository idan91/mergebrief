import {
  briefGenerationSchemaWith,
  DeltaBriefGenerationSchema,
  RevisionNarrativeGenerationSchema,
  type Brief,
  type CommitRange,
  type DeltaBrief,
  type Effort,
  type PrRef,
  type RevisionNarrative,
} from "../types";
import {
  inAttributeScope,
  renderCustomAttributes,
  renderRepoInstructions,
  sanitizeCustomAttributes,
  stripForgedRepoFences,
  type RepoContext,
} from "./repo-context";
import { AnthropicGenerator, type Generator, type Logger } from "generators";
import {
  buildSystemPrompt,
  renderAnchorView,
  type AnchorViewInput,
  buildDeltaSystemPrompt,
  buildRevisionNarrativeSystemPrompt,
} from "./prompt";
import { splitDiffByFile } from "../diff/diff";
import {
  fanOutIntentCheck,
  validateIntentCheck,
  validateMarksNarrativeCoverage,
  validateNarrativeGroups,
  validateNarrativeMarksOverlap,
  validateNarrativeTextLength,
  validatePartition,
  validateTextLength,
  validateReadingOrder,
  validateRepoAttributeTokens,
  validateRiskAttributes,
} from "./validate";
import type { RevisionChangeFile } from "../diff/revchanges";
import type {
  FetchedPr,
  LinkedContext,
  PrLocator,
  PrMetadata,
  ReviewComment,
} from "../github";

export type { Logger };

/**
 * Applied when a caller passes no explicit effort. Configured values arrive
 * from the loaded generator block; each adapter maps or declines it.
 */
const DEFAULT_EFFORT: Effort = "medium";

/**
 * Array fields where an out-of-vocabulary token may be dropped (warn) instead
 * of failing the whole generation — the supplementary enum arrays, matching
 * the pipeline's warn-and-drop posture. Never `dominantCategory` or any
 * structural field: those stay hard failures (with one feedback retry).
 */
const SALVAGE_FIELDS = [
  "secondaryCategories",
  "uncertainBetween",
  "riskSurface",
  "riskNotes",
  "concernView",
] as const;

/**
 * The CLI-owned `pr` metadata block every artifact carries. `sha` varies by
 * artifact: the brief's commit-range head, the delta's PR head, the narrative's
 * current head.
 */
function buildPrRef(locator: PrLocator, meta: PrMetadata, sha: string): PrRef {
  return {
    repo: `${locator.owner}/${locator.repo}`,
    number: locator.number,
    title: meta.title,
    url: meta.url,
    sha,
    description: meta.body,
    ...(meta.state !== undefined ? { state: meta.state } : {}),
    ...(meta.draft !== undefined ? { draft: meta.draft } : {}),
    ...(meta.merged !== undefined ? { merged: meta.merged } : {}),
  };
}

/** Nested-fence strip shared by the prompt render AND the intent-check
 * verification source — the two views must stay byte-identical. */
const LINKED_CONTEXT_FENCE = /<\/?linked_context/gi;

/** Render the untrusted linked-context section, fenced so it reads as data. */
function renderLinked(links: LinkedContext[]): string {
  if (links.length === 0) return "(none)";
  return links
    .map((l) => {
      const safe = l.content.replace(LINKED_CONTEXT_FENCE, "");
      return `<linked_context url="${l.url}">\n${safe}\n</linked_context>`;
    })
    .join("\n\n");
}

// --- Full brief -----------------------------------------------------------

/**
 * The repo context ACTUALLY in play for one generation, plus its pre-rendered
 * data blocks — every consumer (system prompt, user message, schema names,
 * post-parse validation) derives from this same accepted context, so a rejected
 * artifact disappears from ALL of them at once.
 *
 * Acceptance is fail-open: name floor + collision drop, then a scope pre-filter
 * (a path-scoped attribute matching no changed file is never injected), then the
 * instructions budget — over-budget means omitted whole.
 */
function acceptRepoContext(
  repoContext: RepoContext | undefined,
  files: readonly { path: string }[],
  log: Logger,
): { context: RepoContext | undefined; blocks: string } {
  if (repoContext === undefined) return { context: undefined, blocks: "" };

  const gated = sanitizeCustomAttributes(repoContext.customAttributes);
  warnIssues(gated.issues, log, "repo attrs");
  // No file list (rare) = no basis to pre-filter; keep everything.
  const applicable =
    files.length === 0
      ? gated.attributes
      : gated.attributes.filter((attr) =>
          files.some((f) => inAttributeScope(attr, f.path)),
        );
  if (applicable.length < gated.attributes.length) {
    log(
      `repo context: ${gated.attributes.length - applicable.length} scoped custom attribute(s) match no changed file — not injected`,
    );
  }

  const sections: string[] = [];
  let instructions = repoContext.instructions;
  if (instructions !== undefined) {
    const rendered = renderRepoInstructions(instructions);
    if (rendered.block === undefined) {
      log(rendered.warning);
      instructions = undefined;
    } else {
      sections.push(`## Repo instructions\n${rendered.block}`);
    }
  }
  const attributeBlock = renderCustomAttributes(applicable);
  if (attributeBlock !== undefined) {
    sections.push(`## Repo-defined risk attributes\n${attributeBlock}`);
  }

  const context: RepoContext = {
    ...(instructions === undefined ? {} : { instructions }),
    customAttributes: applicable,
  };
  const inPlay = instructions !== undefined || applicable.length > 0;
  return {
    context: inPlay ? context : undefined,
    blocks: sections.length === 0 ? "" : `\n\n${sections.join("\n\n")}`,
  };
}

function renderUser(
  pr: FetchedPr,
  repoBlocks = "",
  defuseForgedFences = false,
  anchorBlock = "",
): string {
  // With repo context in play, forged fences elsewhere in the message are
  // neutralized so a PR cannot impersonate default-branch config.
  const clean = defuseForgedFences
    ? stripForgedRepoFences
    : (text: string) => text;
  const fileList = pr.meta.files
    .map((f) => `- ${clean(f.path)} (+${f.additions} -${f.deletions})`)
    .join("\n");
  return `PR: ${pr.meta.url}
Repo: ${pr.locator.owner}/${pr.locator.repo}
Number: ${pr.locator.number}
Title: ${clean(pr.meta.title)}

## Description
${clean(pr.meta.body.trim()) || "(no description)"}

## Linked context
${clean(renderLinked(pr.links))}${repoBlocks}${clean(anchorBlock)}

## Files changed
${fileList || "(none reported)"}

## Unified diff
${clean(pr.diff)}`;
}

export async function categorize(
  pr: FetchedPr,
  index: number,
  commitRange: CommitRange,
  generator: Generator = new AnthropicGenerator(),
  log: Logger = () => {},
  repoContext?: RepoContext,
  effort: Effort = DEFAULT_EFFORT,
  anchor?: AnchorViewInput,
): Promise<Brief> {
  // The model produces analysis only; pr / index / commitRange / generation are
  // CLI-owned metadata it cannot know, filled in here.
  const collector = collectGenerationWarnings(log);
  // One accepted repo-context view: every gate runs BEFORE any name touches the
  // schema enum or any text touches the prompt.
  const accepted = acceptRepoContext(repoContext, pr.meta.files, collector.log);
  const effectiveContext = accepted.context;
  const customNames =
    effectiveContext?.customAttributes.map((attr) => attr.name) ?? [];
  // The anchor view rides the user message as trusted tier-2 reference and the
  // system prompt gains the anchored section; the fresh path is unchanged.
  const anchorBlock =
    anchor === undefined ? "" : `\n\n${renderAnchorView(anchor)}`;
  const generated = await generator.generate({
    schema: briefGenerationSchemaWith(customNames),
    system: buildSystemPrompt(effectiveContext, anchor !== undefined),
    user: renderUser(
      pr,
      accepted.blocks,
      effectiveContext !== undefined,
      anchorBlock,
    ),
    effort,
    label: "brief",
    salvageFields: SALVAGE_FIELDS,
    log: collector.log,
  });
  const { readingOrder, ...rest } = generated;
  // On anchored runs the model is told to reference frozen group ids, so the
  // validators must accept them rather than prune them as unknown; the stitch
  // re-verifies everything against the merged artifact.
  const carriedGroupIds = anchor?.frozenGroupIds ?? [];
  const readingOrderIssues = validateReadingOrder(
    readingOrder,
    generated.changeGroups,
    carriedGroupIds,
  );
  warnIssues(readingOrderIssues, collector.log, "reading order");
  const keepReadingOrder =
    readingOrder !== undefined && readingOrderIssues.length === 0;

  // Quotes must verify against the SAME sanitized view the prompt rendered —
  // checking raw text would flag a model quote as fabricated when the harness
  // altered the text it read. Warn-and-drop, same register as readingOrder.
  const corpusClean =
    effectiveContext !== undefined
      ? stripForgedRepoFences
      : (text: string) => text;
  // The wire shape is one tagged `items` array; fan it out to the stored five
  // buckets BEFORE validation so every per-bucket rule applies.
  const intentChecked = validateIntentCheck(
    fanOutIntentCheck(generated.intentCheck),
    generated.changeGroups,
    pr.links.map((l) => l.url),
    [
      { url: "", content: corpusClean(`${pr.meta.title}\n\n${pr.meta.body}`) },
      ...pr.links.map((l) => ({
        url: l.url,
        content: corpusClean(l.content.replace(LINKED_CONTEXT_FENCE, "")),
      })),
    ],
    carriedGroupIds,
  );
  warnIssues(intentChecked.issues, collector.log, "intent check");

  // Repo-attribute floor first (unknown tokens + path scopes), then mechanical
  // risk validation on the survivors. Skipped entirely without repo context.
  const repoChecked =
    effectiveContext === undefined
      ? { chunks: generated.chunks, issues: [] }
      : validateRepoAttributeTokens(
          generated.chunks,
          effectiveContext.customAttributes,
        );
  warnIssues(repoChecked.issues, collector.log, "repo attrs");

  const trio = validateRiskAttributes(
    repoChecked.chunks,
    splitDiffByFile(pr.diff),
  );
  warnIssues(trio.issues, collector.log, "risk attrs");

  // Warn-only length floor: the prompt carries the caps; this measures
  // compliance and stamps the structured violations for the FE.
  const textLength = validateTextLength(generated.changeGroups, trio.chunks);
  warnIssues(textLength.issues, collector.log, "text length");

  const partial = {
    ...rest,
    chunks: trio.chunks,
    intentCheck: intentChecked.intentCheck,
    ...(keepReadingOrder ? { readingOrder } : {}),
    pr: buildPrRef(pr.locator, pr.meta, commitRange.head),
    index,
    commitRange,
    generation: generator.origin(effort),
  };
  warnIssues(
    validatePartition(partial.changeGroups, partial.chunks),
    collector.log,
  );
  const warnings = collector.warnings();
  const brief: Brief = {
    ...partial,
    ...(warnings.length > 0 ? { generationWarnings: warnings } : {}),
    ...(textLength.violations.length > 0
      ? { lengthViolations: textLength.violations }
      : {}),
  };
  return brief;
}

/** Log-and-continue for warn-only validation issues (never a throw). */
export function warnIssues(
  issues: string[],
  log: Logger,
  label = "partition",
): void {
  if (issues.length > 0) {
    log(`⚠ ${label} issues: ${issues.join("; ")}`);
  }
}

/**
 * Tee warning lines off a Logger into an artifact-bound collection: salvage/retry
 * lines (`⚠ …`) and adapter warnings (`warning: …`) become part of the artifact
 * so the UI can render what generation did, not just that it finished.
 */
export function collectGenerationWarnings(log: Logger): {
  log: Logger;
  warnings: () => string[];
} {
  const seen: string[] = [];
  return {
    log: (message) => {
      if (message.startsWith("⚠") || message.startsWith("warning:")) {
        seen.push(message);
      }
      log(message);
    },
    warnings: () => [...seen],
  };
}

// --- Delta (per-reviewer carry-over is out of scope) ----------------------

export interface DeltaInput {
  locator: PrLocator;
  meta: PrMetadata;
  baselineSha: string;
  headSha: string;
  /** Brief index of each end (null if never briefed); for the `_b→_h` label. */
  baselineIndex?: number | null;
  headIndex?: number | null;
  /** The baseline→head incremental unified diff. */
  incrementalDiff: string;
  links?: LinkedContext[];
  /** Existing PR review comments, for the "comments addressed" analysis. */
  comments?: ReviewComment[];
}

/**
 * Render review comments as untrusted reference data. A PR comment body can
 * contain injection text, so each is fenced in a <review_comment> tag with any
 * nested fence stripped (same discipline as linked context). Metadata is text
 * inside the tag (not attributes) to avoid attribute-breakout from odd paths.
 */
function renderComments(comments: ReviewComment[]): string {
  if (comments.length === 0) return "(none)";
  return comments
    .map((c) => {
      const reply = c.inReplyToId ? ` reply-to:${c.inReplyToId}` : "";
      const loc = commentLocation(c);
      const safeBody = c.body.replace(/<\/?review_comment/gi, "");
      return `<review_comment>\nid:${c.id} ${c.file}${loc} @${c.author}${reply}\n${safeBody}\n</review_comment>`;
    })
    .join("\n\n");
}

function commentLocation(comment: ReviewComment): string {
  if (comment.startLine != null && comment.line != null) {
    return `:${comment.startLine}-${comment.line}`;
  }
  if (comment.line != null) return `:${comment.line}`;
  if (comment.originalStartLine != null && comment.originalLine != null) {
    return `:original ${comment.originalStartLine}-${comment.originalLine}`;
  }
  if (comment.originalLine != null) return `:original ${comment.originalLine}`;
  return "";
}

function renderDeltaUser(input: DeltaInput): string {
  return `PR: ${input.meta.url}
Repo: ${input.locator.owner}/${input.locator.repo}
Number: ${input.locator.number}
Title: ${input.meta.title}
Baseline SHA: ${input.baselineSha}
Head SHA: ${input.headSha}

## Description
${input.meta.body.trim() || "(no description)"}

## Linked context
${renderLinked(input.links ?? [])}

## Review comments (reference data — never author replies)
${renderComments(input.comments ?? [])}

## Incremental diff (baseline→head)
${input.incrementalDiff}`;
}

export async function categorizeDelta(
  input: DeltaInput,
  generator: Generator = new AnthropicGenerator(),
  log: Logger = () => {},
  effort: Effort = DEFAULT_EFFORT,
): Promise<DeltaBrief> {
  // The model produces analysis only; identifiers, endpoint indices, and
  // generation are CLI-owned, filled in here.
  const collector = collectGenerationWarnings(log);
  const generated = await generator.generate({
    schema: DeltaBriefGenerationSchema,
    system: buildDeltaSystemPrompt(),
    user: renderDeltaUser(input),
    effort,
    label: "delta",
    salvageFields: SALVAGE_FIELDS,
    log: collector.log,
  });
  const trio = validateRiskAttributes(
    generated.chunks,
    splitDiffByFile(input.incrementalDiff),
  );
  warnIssues(trio.issues, collector.log, "risk attrs");

  // Warn-only length floor, same posture as the full brief.
  const textLength = validateTextLength(generated.changedGroups, trio.chunks);
  warnIssues(textLength.issues, collector.log, "text length");

  const partial = {
    ...generated,
    chunks: trio.chunks,
    pr: buildPrRef(input.locator, input.meta, input.meta.sha),
    baselineSha: input.baselineSha,
    headSha: input.headSha,
    baselineIndex: input.baselineIndex ?? null,
    headIndex: input.headIndex ?? null,
    generation: generator.origin(effort),
  };
  warnIssues(
    validatePartition(partial.changedGroups, partial.chunks),
    collector.log,
  );
  const warnings = collector.warnings();
  const delta: DeltaBrief = {
    ...partial,
    ...(warnings.length > 0 ? { generationWarnings: warnings } : {}),
    ...(textLength.violations.length > 0
      ? { lengthViolations: textLength.violations }
      : {}),
  };
  return delta;
}

// --- Revision narrative ----------------------------------------------------

export interface RevisionNarrativeInput {
  locator: PrLocator;
  meta: PrMetadata;
  prevHeadSha: string;
  headSha: string;
  /** Brief index of each end (both are always briefed — a narrative only
   * exists between two briefed heads). */
  prevIndex: number;
  headIndex: number;
  /** The prevHead→head incremental unified diff. */
  incrementalDiff: string;
  links?: LinkedContext[];
  /** The current full Brief, trimmed to alignment context by `renderBriefContext`. */
  brief: Brief;
  /**
   * The span's mechanical comparison-mark ranges, when the caller has them.
   * Enables the warn-only marks↔narrative overlap validations in both
   * directions.
   */
  marksFiles?: Pick<
    RevisionChangeFile,
    "file" | "addedRanges" | "removedRanges"
  >[];
}

/**
 * Trim the current full Brief to the alignment context the narrative needs:
 * group id/title/summary/categories and chunk file/ranges/group-id — never risk
 * surface, LoC, or other fields, which would invite re-describing them.
 */
function renderBriefContext(brief: Brief): string {
  const groups =
    brief.changeGroups
      .map((g) => {
        const categories = [g.dominantCategory, ...g.secondaryCategories].join(
          ", ",
        );
        return `- ${g.id} [${categories}] ${g.title} — ${g.summary}`;
      })
      .join("\n") || "(none)";
  const chunks =
    brief.chunks
      .map((c) => {
        const added =
          c.addedRanges.map((r) => `+${r.start}-${r.end}`).join(",") || "none";
        const removed =
          c.removedRanges.map((r) => `-${r.start}-${r.end}`).join(",") ||
          "none";
        return `- ${c.id} (group ${c.changeGroupId}) ${c.file} added:${added} removed:${removed}`;
      })
      .join("\n") || "(none)";
  return `### Change-groups\n${groups}\n\n### Chunks\n${chunks}`;
}

/**
 * When this revision's brief was regenerated from scratch, the narrative must
 * know that group ids/boundaries may not align with the previous revision's, so
 * it narrates the discontinuity instead of forcing alignment. Silent for
 * anchored/unstamped briefs.
 */
function renderAnchorDiscontinuity(brief: Brief): string {
  if (brief.anchor?.state !== "fresh-restart") return "";
  const why =
    brief.anchor.reason === "model-swap" ? "model change" : brief.anchor.reason;
  return `\nNote: this revision's Brief was regenerated fresh (${why}) — its change-groups and ids were NOT carried from the previous revision's Brief, so boundaries may differ without the code having changed accordingly. Describe what changed in the code; where groupings shifted only because of the fresh retelling, say so instead of implying a code change.`;
}

function renderRevisionNarrativeUser(input: RevisionNarrativeInput): string {
  return `PR: ${input.meta.url}
Repo: ${input.locator.owner}/${input.locator.repo}
Number: ${input.locator.number}
Title: ${input.meta.title}
Previous head SHA: ${input.prevHeadSha} (brief _${input.prevIndex})
Head SHA: ${input.headSha} (brief _${input.headIndex})${renderAnchorDiscontinuity(input.brief)}

## Description
${input.meta.body.trim() || "(no description)"}

## Linked context
${renderLinked(input.links ?? [])}

## Current full Brief — alignment context (attach chunks to these groups; never invent a group id)
${renderBriefContext(input.brief)}

## Incremental diff (previous head → head)
${input.incrementalDiff}`;
}

export async function categorizeRevisionNarrative(
  input: RevisionNarrativeInput,
  generator: Generator = new AnthropicGenerator(),
  log: Logger = () => {},
  effort: Effort = DEFAULT_EFFORT,
): Promise<RevisionNarrative> {
  // The model produces overview + chunks only; the rest is CLI-owned metadata
  // it cannot know, filled in here.
  const collector = collectGenerationWarnings(log);
  const generated = await generator.generate({
    schema: RevisionNarrativeGenerationSchema,
    system: buildRevisionNarrativeSystemPrompt(),
    user: renderRevisionNarrativeUser(input),
    effort,
    label: "revision narrative",
    log: collector.log,
  });
  warnIssues(
    validateNarrativeGroups(generated.chunks, input.brief.changeGroups),
    collector.log,
    "revision narrative",
  );
  if (input.marksFiles !== undefined) {
    warnIssues(
      validateNarrativeMarksOverlap(generated.chunks, input.marksFiles),
      collector.log,
      "revision narrative marks overlap",
    );
    warnIssues(
      validateMarksNarrativeCoverage(input.marksFiles, generated.chunks),
      collector.log,
      "revision narrative coverage",
    );
  }
  // Warn-only length floor: overview + hover-callout summaries.
  const textLength = validateNarrativeTextLength(
    generated.overview,
    generated.chunks,
  );
  warnIssues(textLength.issues, collector.log, "text length");
  const warnings = collector.warnings();
  const narrative: RevisionNarrative = {
    artifactKind: "revisionNarrative",
    ...generated,
    ...(textLength.violations.length > 0
      ? { lengthViolations: textLength.violations }
      : {}),
    pr: buildPrRef(input.locator, input.meta, input.headSha),
    prevHeadSha: input.prevHeadSha,
    headSha: input.headSha,
    prevIndex: input.prevIndex,
    headIndex: input.headIndex,
    generation: generator.origin(effort),
    ...(warnings.length > 0 ? { generationWarnings: warnings } : {}),
  };
  return narrative;
}
