import {
  briefGenerationSchemaWith,
  DeltaBriefGenerationSchema,
  RevisionNarrativeGenerationSchema,
  type Brief,
  type CommitRange,
  type DeltaBrief,
  type PrRef,
  type ReviewComment,
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
import {
  AnthropicGenerator,
  type Effort,
  type Generator,
  type Logger,
} from "generators";
import type { Mutable } from "types/utils";
import {
  buildSystemPrompt,
  renderAnchorView,
  type AnchorViewInput,
  buildDeltaSystemPrompt,
  buildRevisionNarrativeSystemPrompt,
} from "./prompt";
import { splitDiffByFile } from "../diff/file-diff";
import {
  changedRangesFromFileDiffs,
  type RevisionChangeFile,
} from "../diff/revchanges";
import {
  buildConcernView,
  crossCheckFileTotals,
  diffLocTotals,
  deriveChunkLoc,
  deriveUnattributed,
  detectChunkOverlaps,
  unattributedTotals,
  type UnattributedFile,
} from "./loc";
import { snapChunkRanges } from "./snap-ranges";
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
  type PrimaryTicketFacts,
} from "./validate";
import type { FetchedPr, PrLocator, PrMetadata } from "../github";
import {
  isLinearPrStack,
  type ForkPrStack,
  type LinearPrStack,
  type PrStack,
  type PrStackMember,
} from "../pr-stack";
import type {
  ContextSnippet,
  PrimarySnippet,
  PrimaryTicketOutcome,
} from "../context/types";
import { toPrimaryTicket } from "../context/primary";
import { attributeSafe, stripKnownFences } from "./fences";

export type { Logger };

/**
 * Applied when a caller passes no explicit effort. Configured values arrive
 * from the loaded generator block; each adapter maps or declines it.
 */
const DEFAULT_EFFORT: Effort = "medium";

/**
 * Array fields where an out-of-vocabulary token may be dropped (warn) instead
 * of failing the whole generation, the supplementary enum arrays, matching
 * the pipeline's warn-and-drop posture. Never `dominantCategory` or any
 * structural field: those stay hard failures (with one feedback retry).
 */
const SALVAGE_FIELDS = [
  "secondaryCategories",
  "uncertainBetween",
  "riskSurface",
  "riskNotes",
] as const;

/**
 * The CLI-owned `pr` metadata block every artifact carries. `sha` varies by
 * artifact: the brief's commit-range head, the delta's PR head, the narrative's
 * current head.
 */
function buildPrRef(locator: PrLocator, meta: PrMetadata, sha: string): PrRef {
  const ref: PrRef = {
    repo: `${locator.owner}/${locator.repo}`,
    number: locator.number,
    title: meta.title,
    url: meta.url,
    sha,
    description: meta.body,
  };

  if (meta.state !== undefined) ref.state = meta.state;
  if (meta.draft !== undefined) ref.draft = meta.draft;
  if (meta.merged !== undefined) ref.merged = meta.merged;
  if (meta.headRef !== undefined) ref.headRef = meta.headRef;
  if (meta.baseRef !== undefined) ref.baseRef = meta.baseRef;
  if (meta.stack !== undefined) ref.stack = meta.stack;

  return ref;
}

/**
 * Render the untrusted linked-context section, fenced so it reads as data.
 * The body strip is the same `stripKnownFences` the verification corpus
 * applies: the two views must stay byte-identical.
 */
function renderLinked(links: readonly ContextSnippet[]): string {
  if (links.length === 0) return "(none)";
  return links
    .map((l) => {
      const url = attributeSafe(l.source);
      return `<linked_context url="${url}">\n${stripKnownFences(l.text)}\n</linked_context>`;
    })
    .join("\n\n");
}

/** What the alignment rules need: the primary's corpus URL and whether it was read. */
function derivePrimaryTicketFacts(
  outcome: PrimaryTicketOutcome | undefined,
): PrimaryTicketFacts | undefined {
  if (outcome === undefined) return undefined;
  if (outcome.status === "read")
    return { url: outcome.snippet.source, read: true };
  return { url: outcome.reference.url, read: false };
}

/** The read primary, when the fan-out produced one. */
function readPrimary(
  outcome: PrimaryTicketOutcome | undefined,
): PrimarySnippet | undefined {
  return outcome?.status === "read" ? outcome.snippet : undefined;
}

/**
 * The primary ticket's injected text: tracker header first, then the body,
 * stripped once. The rendered fence body and the corpus entry are both this
 * string, so the two stay byte-identical.
 */
function buildPrimaryTicketText(primary: PrimarySnippet): string {
  const header = primary.header === "" ? "" : `${primary.header}\n\n`;
  return stripKnownFences(`${header}${primary.text}`);
}

/**
 * Render the primary ticket in its own fence so the model cannot mistake it
 * for a design doc or a second ticket. `text` is `buildPrimaryTicketText`.
 */
function renderPrimaryTicket(
  primary: PrimarySnippet | undefined,
  text = primary === undefined ? "" : buildPrimaryTicketText(primary),
): string {
  if (primary === undefined) return "";
  const url = attributeSafe(primary.source);
  const key = attributeSafe(primary.key);
  const tracker = attributeSafe(primary.tracker);
  return `## Primary ticket\n<primary_ticket url="${url}" key="${key}" tracker="${tracker}">\n${text}\n</primary_ticket>\n\n`;
}

// --- Full brief -----------------------------------------------------------

/**
 * Derive prompts, schema names and post-parse validation from one accepted context.
 * Name/collision checks, changed-file scope filtering and the instruction budget fail open;
 * rejected artifacts must disappear from every consumer together.
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

  const context: Mutable<RepoContext> = { customAttributes: applicable };

  if (instructions !== undefined) context.instructions = instructions;

  const inPlay = instructions !== undefined || applicable.length > 0;
  return {
    context: inPlay ? context : undefined,
    blocks: sections.length === 0 ? "" : `\n\n${sections.join("\n\n")}`,
  };
}

function renderStackMember(member: PrStackMember): string {
  return `#${String(member.number)} "${member.title}"`;
}

function renderBranchesLine(meta: PrMetadata): string | undefined {
  const parts: string[] = [];
  if (meta.baseRef !== undefined && meta.baseRef !== "") {
    parts.push(`base=\`${meta.baseRef}\``);
  }
  if (meta.headRef !== undefined && meta.headRef !== "") {
    parts.push(`head=\`${meta.headRef}\``);
  }

  if (parts.length === 0) return undefined;
  return `Branches: ${parts.join(" ")}`;
}

function renderLinearStackLine(stack: LinearPrStack): string {
  const selfIndex = stack.index - 1;
  const parent = stack.members[selfIndex - 1];
  const child = stack.members[selfIndex + 1];

  const neighbours: string[] = [];
  if (parent !== undefined) {
    neighbours.push(`parent ${renderStackMember(parent)}`);
  }
  if (child !== undefined) {
    neighbours.push(`child ${renderStackMember(child)}`);
  }

  const position = `${String(stack.index)} of ${String(stack.members.length)}`;
  if (neighbours.length === 0) return `Stack: ${position}`;
  return `Stack: ${position} (${neighbours.join("; ")})`;
}

function renderForkStackLine(stack: ForkPrStack): string {
  const parts: string[] = [];
  if (stack.parent !== undefined) {
    parts.push(`parent ${renderStackMember(stack.parent)}`);
  }

  const children = stack.children
    .map((member) => renderStackMember(member))
    .join(", ");
  parts.push(`children ${children}`);

  return `Stack: ${parts.join("; ")}`;
}

function renderStackLine(stack: PrStack | undefined): string | undefined {
  if (stack === undefined) return undefined;
  if (isLinearPrStack(stack)) return renderLinearStackLine(stack);
  return renderForkStackLine(stack);
}

function renderBranchFacts(meta: PrMetadata): string {
  const lines: string[] = [];

  const branches = renderBranchesLine(meta);
  if (branches !== undefined) lines.push(branches);

  const stack = renderStackLine(meta.stack);
  if (stack !== undefined) lines.push(stack);

  if (lines.length === 0) return "";
  return `\n${lines.join("\n")}`;
}

function renderUser(
  pr: FetchedPr,
  repoBlocks = "",
  defuseForgedFences = false,
  anchorBlock = "",
  primaryBlock = renderPrimaryTicket(readPrimary(pr.primaryTicket)),
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
Title: ${clean(pr.meta.title)}${clean(renderBranchFacts(pr.meta))}

## Description
${clean(pr.meta.body.trim()) || "(no description)"}

${clean(primaryBlock)}## Linked context
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
  // Stripped once: the fence body and the corpus entry are the same string.
  const primary = readPrimary(pr.primaryTicket);
  const primaryText =
    primary === undefined ? "" : buildPrimaryTicketText(primary);
  const generated = await generator.generate({
    schema: briefGenerationSchemaWith(customNames),
    system: buildSystemPrompt(effectiveContext, anchor !== undefined),
    user: renderUser(
      pr,
      accepted.blocks,
      effectiveContext !== undefined,
      anchorBlock,
      renderPrimaryTicket(primary, primaryText),
    ),
    effort,
    label: "brief",
    salvageFields: SALVAGE_FIELDS,
    log: collector.log,
  });
  // Counts never come from the model: chunk loc = |ranges ∩ changed lines|,
  // concernView rolls up from that, and the remainder no chunk claims is
  // stamped as `unattributed`. All discrepancy signals are warn-only.
  const fileDiffs = splitDiffByFile(pr.diff);
  const changedFiles = changedRangesFromFileDiffs(fileDiffs);
  // Ranges snap over the statement tails the model left to the remainder
  // before anything counts them, so the overlap check sees final ranges.
  const snappedChunks = snapChunkRanges(generated.chunks, fileDiffs);
  const chunksWithLoc = deriveChunkLoc(snappedChunks, changedFiles);
  warnIssues(detectChunkOverlaps(chunksWithLoc), collector.log, "loc overlap");
  warnIssues(
    crossCheckFileTotals(changedFiles, pr.meta.files),
    collector.log,
    "loc cross-check",
  );
  // On anchored runs the model deliberately withholds frozen groups' chunks,
  // so a remainder computed here would mis-claim their lines as unattributed;
  // the worker stitch derives it over the merged chunk set instead.
  const unattributed =
    anchor === undefined
      ? deriveUnattributed(chunksWithLoc, changedFiles)
      : undefined;
  if (unattributed !== undefined) {
    warnIssues(coverageIssues(unattributed), collector.log, "loc coverage");
  }

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

  // Quotes must verify against the SAME sanitized view the prompt rendered,
  // checking raw text would flag a model quote as fabricated when the harness
  // altered the text it read. Warn-and-drop, same register as readingOrder.
  const corpusClean =
    effectiveContext !== undefined
      ? stripForgedRepoFences
      : (text: string) => text;
  // The primary ticket counts as an injected URL: ticketUrls membership and
  // the quote check work on it unchanged.
  const injectedUrls = pr.links.map((l) => l.source);
  const corpus = [
    { url: "", content: corpusClean(`${pr.meta.title}\n\n${pr.meta.body}`) },
    ...pr.links.map((l) => ({
      url: l.source,
      content: corpusClean(stripKnownFences(l.text)),
    })),
  ];
  if (primary !== undefined) {
    injectedUrls.push(primary.source);
    corpus.push({ url: primary.source, content: corpusClean(primaryText) });
  }
  // The wire shape is one tagged `items` array; fan it out to the stored five
  // buckets BEFORE validation so every per-bucket rule applies.
  const primaryFacts = derivePrimaryTicketFacts(pr.primaryTicket);
  const intentChecked = validateIntentCheck(
    fanOutIntentCheck(generated.intentCheck),
    generated.changeGroups,
    injectedUrls,
    corpus,
    carriedGroupIds,
    primaryFacts,
  );
  warnIssues(intentChecked.issues, collector.log, "intent check");
  // Harness data, stamped after validation: the model never sees it.
  const intentCheck =
    pr.primaryTicket === undefined
      ? intentChecked.intentCheck
      : {
          ...intentChecked.intentCheck,
          primaryTicket: toPrimaryTicket(pr.primaryTicket),
        };

  // Repo-attribute floor first (unknown tokens + path scopes), then mechanical
  // risk validation on the survivors. Skipped entirely without repo context.
  const repoChecked =
    effectiveContext === undefined
      ? { chunks: chunksWithLoc, issues: [] }
      : validateRepoAttributeTokens(
          chunksWithLoc,
          effectiveContext.customAttributes,
        );
  warnIssues(repoChecked.issues, collector.log, "repo attrs");

  const trio = validateRiskAttributes(repoChecked.chunks, fileDiffs);
  warnIssues(trio.issues, collector.log, "risk attrs");

  // Warn-only length floor: the prompt carries the caps; this measures
  // compliance and stamps the structured violations for the FE.
  const textLength = validateTextLength(generated.changeGroups, trio.chunks);
  warnIssues(textLength.issues, collector.log, "text length");

  const brief: Brief = {
    ...rest,
    chunks: trio.chunks,
    concernView: buildConcernView(trio.chunks),
    // Exact whole-diff totals: per-chunk sums double-count overlap lines
    // (by design), so header totals derive from the diff itself.
    diffTotals: diffLocTotals(changedFiles),
    intentCheck,
    pr: buildPrRef(pr.locator, pr.meta, commitRange.head),
    index,
    commitRange,
    generation: generator.origin(effort),
  };

  if (unattributed !== undefined) brief.unattributed = unattributed;
  if (keepReadingOrder) brief.readingOrder = readingOrder;

  warnIssues(
    validatePartition(brief.changeGroups, brief.chunks),
    collector.log,
  );

  const warnings = collector.warnings();
  if (warnings.length > 0) brief.generationWarnings = warnings;
  if (textLength.violations.length > 0) {
    brief.lengthViolations = textLength.violations;
  }

  return brief;
}

/** Warn line for a non-empty unattributed remainder (coverage gap). */
function coverageIssues(unattributed: UnattributedFile[]): string[] {
  if (unattributed.length === 0) return [];
  const gap = unattributedTotals(unattributed);
  return [
    `${gap.added} added / ${gap.deleted} removed changed line(s) unattributed to any chunk across ${unattributed.length} file(s)`,
  ];
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
  links?: ContextSnippet[];
  /** The primary ticket as context only; deltas carry no intent check. */
  primaryTicket?: PrimaryTicketOutcome | undefined;
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
      const safeBody = stripKnownFences(c.body);
      return `<review_comment>\nid:${c.id} ${c.file}${loc} @${c.author}${reply}\n${safeBody}\n</review_comment>`;
    })
    .join("\n\n");
}

function commentLocation(comment: ReviewComment): string {
  if (comment.startLine !== null && comment.line !== null) {
    return `:${comment.startLine}-${comment.line}`;
  }
  if (comment.line !== null) return `:${comment.line}`;
  if (comment.originalStartLine !== null && comment.originalLine !== null) {
    return `:original ${comment.originalStartLine}-${comment.originalLine}`;
  }
  if (comment.originalLine !== null) return `:original ${comment.originalLine}`;
  return "";
}

function renderDeltaUser(input: DeltaInput): string {
  return `PR: ${input.meta.url}
Repo: ${input.locator.owner}/${input.locator.repo}
Number: ${input.locator.number}
Title: ${input.meta.title}${renderBranchFacts(input.meta)}
Baseline SHA: ${input.baselineSha}
Head SHA: ${input.headSha}

## Description
${input.meta.body.trim() || "(no description)"}

${renderPrimaryTicket(readPrimary(input.primaryTicket))}## Linked context
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
  // Delta chunk loc derives from the incremental diff, same discipline as
  // the full brief; the delta artifact carries no concernView/unattributed.
  const fileDiffs = splitDiffByFile(input.incrementalDiff);
  const chunksWithLoc = deriveChunkLoc(
    generated.chunks,
    changedRangesFromFileDiffs(fileDiffs),
  );
  warnIssues(detectChunkOverlaps(chunksWithLoc), collector.log, "loc overlap");
  const trio = validateRiskAttributes(chunksWithLoc, fileDiffs);
  warnIssues(trio.issues, collector.log, "risk attrs");

  // Warn-only length floor, same posture as the full brief.
  const textLength = validateTextLength(generated.changedGroups, trio.chunks);
  warnIssues(textLength.issues, collector.log, "text length");

  const delta: DeltaBrief = {
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
    validatePartition(delta.changedGroups, delta.chunks),
    collector.log,
  );

  const warnings = collector.warnings();
  if (warnings.length > 0) delta.generationWarnings = warnings;
  if (textLength.violations.length > 0) {
    delta.lengthViolations = textLength.violations;
  }

  return delta;
}

// --- Revision narrative ----------------------------------------------------

export interface RevisionNarrativeInput {
  locator: PrLocator;
  meta: PrMetadata;
  prevHeadSha: string;
  headSha: string;
  /** Brief index of each end (both are always briefed, a narrative only
   * exists between two briefed heads). */
  prevIndex: number;
  headIndex: number;
  /** The prevHead→head incremental unified diff. */
  incrementalDiff: string;
  links?: ContextSnippet[];
  /** The primary ticket as context only. */
  primaryTicket?: PrimaryTicketOutcome | undefined;
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
 * group id/title/summary/categories and chunk file/ranges/group-id, never risk
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
Title: ${input.meta.title}${renderBranchFacts(input.meta)}
Previous head SHA: ${input.prevHeadSha} (brief _${input.prevIndex})
Head SHA: ${input.headSha} (brief _${input.headIndex})${renderAnchorDiscontinuity(input.brief)}

## Description
${input.meta.body.trim() || "(no description)"}

${renderPrimaryTicket(readPrimary(input.primaryTicket))}## Linked context
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
    pr: buildPrRef(input.locator, input.meta, input.headSha),
    prevHeadSha: input.prevHeadSha,
    headSha: input.headSha,
    prevIndex: input.prevIndex,
    headIndex: input.headIndex,
    generation: generator.origin(effort),
  };

  if (textLength.violations.length > 0) {
    narrative.lengthViolations = textLength.violations;
  }
  if (warnings.length > 0) narrative.generationWarnings = warnings;

  return narrative;
}
