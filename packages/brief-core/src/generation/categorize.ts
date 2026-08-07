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
  validatePartition,
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
 * Normalized reasoning-effort default (BRIEF-75): applied when a caller
 * passes no explicit effort, keeping zero-config behavior byte-identical.
 * The configured value arrives from the loaded generator block (worker,
 * CLIs, eval harness); each adapter maps or honestly declines it.
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
 * The CLI-owned `pr` metadata block every artifact carries (ADR 0012). `sha`
 * varies by artifact: the brief's commit-range head, the delta's PR head, the
 * narrative's current head.
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
 * verification corpus — the two views must stay byte-identical. */
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
 * post-parse validation) derives from the same accepted context, so a
 * rejected artifact disappears from ALL of them at once (codex round 1: an
 * over-budget instructions file must not leave its system contract behind).
 *
 * Acceptance pipeline (all fail-open, all ⚠-warned into generationWarnings):
 *   1. custom-attribute name floor + collision/duplicate drop;
 *   2. scope pre-filter — a path-scoped attribute matching NONE of the PR's
 *      changed files is not injected at all (ADR 0032 #11 deterministic
 *      pre-filtering; plain log, not a warning — it's the normal case);
 *   3. instructions budget — over-budget means omitted whole.
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
  // With repo context in play, forged fences anywhere else in the message
  // (PR body, linked context, file paths, diff) are neutralized so a PR
  // cannot impersonate default-branch config (ADR 0032 #3 trust rule).
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
  // CLI-owned metadata it cannot know, filled in here (ADR 0012/0013).
  const collector = collectGenerationWarnings(log);
  // Everything repo-context flows from ONE accepted view: name floor,
  // collision drop, scope pre-filter, and the instructions budget all run
  // BEFORE any name touches the schema enum or any text touches the prompt.
  const accepted = acceptRepoContext(repoContext, pr.meta.files, collector.log);
  const effectiveContext = accepted.context;
  const customNames =
    effectiveContext?.customAttributes.map((attr) => attr.name) ?? [];
  // Anchored regeneration (BRIEF-143): the anchor view rides the user
  // message (trusted tier-2 reference) and the system prompt gains the
  // anchored section; the fresh path stays byte-identical.
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
  const readingOrderIssues = validateReadingOrder(
    readingOrder,
    generated.changeGroups,
  );
  warnIssues(readingOrderIssues, collector.log, "reading order");
  const keepReadingOrder =
    readingOrder !== undefined && readingOrderIssues.length === 0;

  // Intent check (BRIEF-54): ticketUrls ⊆ the URLs actually injected as
  // linked context; quotes verify against the composite corpus — the PR
  // title/description rides as the "" source, matching the sourceUrl
  // convention. The corpus must be the SAME sanitized view the prompt
  // rendered (linked_context fence strip + forged-fence defusal when repo
  // context is in play) — verifying against raw text would flag a model
  // quote as fabricated when the harness altered the text it read.
  // Warn-and-drop, same register as readingOrder.
  const corpusClean =
    effectiveContext !== undefined
      ? stripForgedRepoFences
      : (text: string) => text;
  // The wire shape is one tagged `items` array (grammar budget, BRIEF-85);
  // fan it out to the stored five buckets BEFORE validation so every
  // per-bucket rule applies exactly as it would to native arrays.
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
  );
  warnIssues(intentChecked.issues, collector.log, "intent check");

  // Repo-attribute floor first (unknown tokens + path scopes, ADR 0032 #11),
  // then the mechanical risk validation on the surviving tokens. Skipped
  // entirely without repo context so the no-config path stays byte-identical.
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

  const partial = {
    ...rest,
    chunks: trio.chunks,
    intentCheck: intentChecked.intentCheck,
    ...(keepReadingOrder ? { readingOrder } : {}),
    pr: buildPrRef(pr.locator, pr.meta, commitRange.head),
    index,
    commitRange,
    generation: generator.provenance(effort),
  };
  warnIssues(
    validatePartition(partial.changeGroups, partial.chunks),
    collector.log,
  );
  const warnings = collector.warnings();
  const brief: Brief = {
    ...partial,
    ...(warnings.length > 0 ? { generationWarnings: warnings } : {}),
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
 * Tee warning lines off a Logger into an artifact-bound collection (BRIEF-11
 * UI surfacing): salvage/retry lines from the schema floor (`⚠ …`) and
 * adapter warnings (served-model mismatch, effort-knob gaps — `warning: …`)
 * become part of the artifact so the UI can render what generation did,
 * not just that it finished.
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

// --- Delta (delta core; per-reviewer carry-over is out of CLI scope) -------

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
  // The model produces analysis only; identifiers + endpoint indices + generation
  // are CLI-owned (ADR 0012/0013), filled in here.
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

  const partial = {
    ...generated,
    chunks: trio.chunks,
    pr: buildPrRef(input.locator, input.meta, input.meta.sha),
    baselineSha: input.baselineSha,
    headSha: input.headSha,
    baselineIndex: input.baselineIndex ?? null,
    headIndex: input.headIndex ?? null,
    generation: generator.provenance(effort),
  };
  warnIssues(
    validatePartition(partial.changedGroups, partial.chunks),
    collector.log,
  );
  const warnings = collector.warnings();
  const delta: DeltaBrief = {
    ...partial,
    ...(warnings.length > 0 ? { generationWarnings: warnings } : {}),
  };
  return delta;
}

// --- Revision narrative (ADR 0024) -----------------------------------------

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
   * The span's mechanical comparison-mark ranges, when the caller has them
   * (both production paths build marks before the narrative call). Enables
   * the marks↔narrative overlap validations in both directions (BRIEF-73) —
   * warn-only, collected into `generationWarnings`.
   */
  marksFiles?: Pick<
    RevisionChangeFile,
    "file" | "addedRanges" | "removedRanges"
  >[];
}

/**
 * Trim the current full Brief to the alignment context the narrative needs
 * (ADR 0024): change-group id/title/summary/categories and chunk
 * file/ranges/group-id — never risk surface, LoC, or the brief's other
 * fields, which would just invite the model to re-describe them.
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

function renderRevisionNarrativeUser(input: RevisionNarrativeInput): string {
  return `PR: ${input.meta.url}
Repo: ${input.locator.owner}/${input.locator.repo}
Number: ${input.locator.number}
Title: ${input.meta.title}
Previous head SHA: ${input.prevHeadSha} (brief _${input.prevIndex})
Head SHA: ${input.headSha} (brief _${input.headIndex})

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
  // it cannot know (ADR 0012/0013), filled in here.
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
  const warnings = collector.warnings();
  const narrative: RevisionNarrative = {
    artifactKind: "revisionNarrative",
    ...generated,
    pr: buildPrRef(input.locator, input.meta, input.headSha),
    prevHeadSha: input.prevHeadSha,
    headSha: input.headSha,
    prevIndex: input.prevIndex,
    headIndex: input.headIndex,
    generation: generator.provenance(effort),
    ...(warnings.length > 0 ? { generationWarnings: warnings } : {}),
  };
  return narrative;
}
