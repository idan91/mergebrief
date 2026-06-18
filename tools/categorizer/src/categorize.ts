import {
  BriefGenerationSchema,
  DeltaBriefGenerationSchema,
  type Brief,
  type CommitRange,
  type DeltaBrief,
  type Effort,
} from "./types.js";
import {
  AnthropicGenerator,
  type Generator,
  type Logger,
} from "./generator.js";
import { buildSystemPrompt, buildDeltaSystemPrompt } from "./prompt.js";
import { validatePartition } from "./validate.js";
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
  const brief: Brief = {
    ...generated,
    pr: {
      repo: `${pr.locator.owner}/${pr.locator.repo}`,
      number: pr.locator.number,
      title: pr.meta.title,
      url: pr.meta.url,
      sha: commitRange.head,
      description: pr.meta.body,
    },
    index,
    commitRange,
    generation: generator.provenance(EFFORT),
  };
  warnIssues(validatePartition(brief.changeGroups, brief.chunks), log);
  return brief;
}

function warnIssues(issues: string[], log: Logger): void {
  if (issues.length > 0) {
    log(`⚠ partition issues: ${issues.join("; ")}`);
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
    pr: {
      repo: `${input.locator.owner}/${input.locator.repo}`,
      number: input.locator.number,
      title: input.meta.title,
      url: input.meta.url,
      sha: input.meta.sha,
      description: input.meta.body,
    },
    baselineSha: input.baselineSha,
    headSha: input.headSha,
    baselineIndex: input.baselineIndex ?? null,
    headIndex: input.headIndex ?? null,
    generation: generator.provenance(EFFORT),
  };
  warnIssues(validatePartition(delta.changedGroups, delta.chunks), log);
  return delta;
}
