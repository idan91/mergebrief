import {
  BriefGenerationSchema,
  DeltaBriefGenerationSchema,
  RevisionNarrativeGenerationSchema,
  type Brief,
  type CommitRange,
  type DeltaBrief,
  type Effort,
  type PrRef,
  type RevisionNarrative,
} from "./types.js";
import {
  AnthropicGenerator,
  type Generator,
  type Logger,
} from "./generator.js";
import {
  buildSystemPrompt,
  buildDeltaSystemPrompt,
  buildRevisionNarrativeSystemPrompt,
} from "./prompt.js";
import {
  validatePartition,
  validateNarrativeGroups,
  validateReadingOrder,
} from "./validate.js";
import type {
  FetchedPr,
  LinkedContext,
  PrLocator,
  PrMetadata,
  ReviewComment,
} from "./github.js";

export type { Logger };

/** Normalized reasoning effort the categorizer requests (each adapter maps it). */
const EFFORT: Effort = "medium";

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
  };
}

/** Render the untrusted linked-context section, fenced so it reads as data. */
function renderLinked(links: LinkedContext[]): string {
  if (links.length === 0) return "(none)";
  return links
    .map((l) => {
      const safe = l.content.replace(/<\/?linked_context/gi, "");
      return `<linked_context url="${l.url}">\n${safe}\n</linked_context>`;
    })
    .join("\n\n");
}

// --- Full brief -----------------------------------------------------------

function renderUser(pr: FetchedPr): string {
  const fileList = pr.meta.files
    .map((f) => `- ${f.path} (+${f.additions} -${f.deletions})`)
    .join("\n");
  return `PR: ${pr.meta.url}
Repo: ${pr.locator.owner}/${pr.locator.repo}
Number: ${pr.locator.number}
Title: ${pr.meta.title}

## Description
${pr.meta.body.trim() || "(no description)"}

## Linked context
${renderLinked(pr.links)}

## Files changed
${fileList || "(none reported)"}

## Unified diff
${pr.diff}`;
}

export async function categorize(
  pr: FetchedPr,
  index: number,
  commitRange: CommitRange,
  generator: Generator = new AnthropicGenerator(),
  log: Logger = () => {},
): Promise<Brief> {
  // The model produces analysis only; pr / index / commitRange / generation are
  // CLI-owned metadata it cannot know, filled in here (ADR 0012/0013).
  const generated = await generator.generate({
    schema: BriefGenerationSchema,
    system: buildSystemPrompt(),
    user: renderUser(pr),
    effort: EFFORT,
    label: "brief",
    log,
  });
  const { readingOrder, ...rest } = generated;
  const readingOrderIssues = validateReadingOrder(readingOrder, generated.changeGroups);
  warnIssues(readingOrderIssues, log, "reading order");
  const keepReadingOrder = readingOrder !== undefined && readingOrderIssues.length === 0;

  const brief: Brief = {
    ...rest,
    ...(keepReadingOrder ? { readingOrder } : {}),
    pr: buildPrRef(pr.locator, pr.meta, commitRange.head),
    index,
    commitRange,
    generation: generator.provenance(EFFORT),
  };
  warnIssues(validatePartition(brief.changeGroups, brief.chunks), log);
  return brief;
}

/** Log-and-continue for warn-only validation issues (never a throw). */
export function warnIssues(issues: string[], log: Logger, label = "partition"): void {
  if (issues.length > 0) {
    log(`⚠ ${label} issues: ${issues.join("; ")}`);
  }
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
): Promise<DeltaBrief> {
  // The model produces analysis only; identifiers + endpoint indices + generation
  // are CLI-owned (ADR 0012/0013), filled in here.
  const generated = await generator.generate({
    schema: DeltaBriefGenerationSchema,
    system: buildDeltaSystemPrompt(),
    user: renderDeltaUser(input),
    effort: EFFORT,
    label: "delta",
    log,
  });
  const delta: DeltaBrief = {
    ...generated,
    pr: buildPrRef(input.locator, input.meta, input.meta.sha),
    baselineSha: input.baselineSha,
    headSha: input.headSha,
    baselineIndex: input.baselineIndex ?? null,
    headIndex: input.headIndex ?? null,
    generation: generator.provenance(EFFORT),
  };
  warnIssues(validatePartition(delta.changedGroups, delta.chunks), log);
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
        const categories = [g.dominantCategory, ...g.secondaryCategories].join(", ");
        return `- ${g.id} [${categories}] ${g.title} — ${g.summary}`;
      })
      .join("\n") || "(none)";
  const chunks =
    brief.chunks
      .map((c) => {
        const added = c.addedRanges.map((r) => `+${r.start}-${r.end}`).join(",") || "none";
        const removed = c.removedRanges.map((r) => `-${r.start}-${r.end}`).join(",") || "none";
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
): Promise<RevisionNarrative> {
  // The model produces overview + chunks only; the rest is CLI-owned metadata
  // it cannot know (ADR 0012/0013), filled in here.
  const generated = await generator.generate({
    schema: RevisionNarrativeGenerationSchema,
    system: buildRevisionNarrativeSystemPrompt(),
    user: renderRevisionNarrativeUser(input),
    effort: EFFORT,
    label: "revision narrative",
    log,
  });
  const narrative: RevisionNarrative = {
    artifactKind: "revisionNarrative",
    ...generated,
    pr: buildPrRef(input.locator, input.meta, input.headSha),
    prevHeadSha: input.prevHeadSha,
    headSha: input.headSha,
    prevIndex: input.prevIndex,
    headIndex: input.headIndex,
    generation: generator.provenance(EFFORT),
  };
  warnIssues(
    validateNarrativeGroups(narrative.chunks, input.brief.changeGroups),
    log,
    "revision narrative",
  );
  return narrative;
}
