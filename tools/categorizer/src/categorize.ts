import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import {
  BriefSchema,
  DeltaBriefSchema,
  type Brief,
  type DeltaBrief,
} from "./types.js";
import { buildSystemPrompt, buildDeltaSystemPrompt } from "./prompt.js";
import { validatePartition } from "./validate.js";
import type {
  FetchedPr,
  LinkedContext,
  PrLocator,
  PrMetadata,
  ReviewComment,
} from "./github.js";

/**
 * Opus 4.8 with adaptive thinking. The system prompt (the taxonomy) is the
 * stable prefix, so it carries a cache_control breakpoint; the volatile diff
 * goes in the user turn after it. Structured output is enforced with
 * messages.stream() + zodOutputFormat(...). Streaming (not parse()) because
 * adaptive thinking + a large max_tokens trips the SDK's 10-minute guard.
 */
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 32000;

/** Progress sink — defaults to no-op so the functions stay usable in tests. */
export type Logger = (message: string) => void;

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

/**
 * Shared streaming + structured-parse path with live progress logging. Both the
 * full brief and the delta use it — they differ only in system prompt, schema,
 * and user content.
 */
async function streamStructured<S extends z.ZodType>(
  client: Anthropic,
  schema: S,
  system: string,
  userContent: string,
  label: string,
  log: Logger,
): Promise<z.infer<S>> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { format: zodOutputFormat(schema), effort: "medium" },
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  // Live progress: phase + elapsed + output size. A heartbeat covers the long
  // silent stretches (e.g. extended thinking) where no deltas arrive.
  const start = Date.now();
  const elapsed = (): string => `${((Date.now() - start) / 1000).toFixed(0)}s`;
  let phase: "thinking" | "writing" = "thinking";
  let outChars = 0;
  stream.on("streamEvent", (event) => {
    if (
      event.type === "content_block_start" &&
      event.content_block.type === "text"
    ) {
      phase = "writing";
      log(`writing ${label}… (${elapsed()})`);
    } else if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      outChars += event.delta.text.length;
    }
  });
  log(`thinking… (${label})`);
  const heartbeat = setInterval(() => {
    const size = outChars > 0 ? `, ${outChars} chars` : "";
    log(`…${phase} ${label} (${elapsed()}${size})`);
  }, 5000);

  let response;
  try {
    response = await stream.finalMessage();
  } finally {
    clearInterval(heartbeat);
  }

  const u = response.usage;
  log(
    `done in ${elapsed()} — tokens in:${u.input_tokens} out:${u.output_tokens} ` +
      `cache_read:${u.cache_read_input_tokens ?? 0}`,
  );

  if (response.stop_reason === "refusal") {
    throw new Error(`Model refused to produce the ${label}.`);
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error(
      `No structured output for ${label} (stop_reason=${response.stop_reason}).`,
    );
  }
  return parsed;
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
  client: Anthropic = new Anthropic(),
  log: Logger = () => {},
): Promise<Brief> {
  const brief = await streamStructured(
    client,
    BriefSchema,
    buildSystemPrompt(),
    renderUser(pr),
    "brief",
    log,
  );
  // PR identifiers + description come from our own fetch, not the model.
  brief.pr = {
    repo: `${pr.locator.owner}/${pr.locator.repo}`,
    number: pr.locator.number,
    title: pr.meta.title,
    url: pr.meta.url,
    sha: pr.meta.sha,
    description: pr.meta.body,
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
      const loc = c.line != null ? `:${c.line}` : "";
      const safeBody = c.body.replace(/<\/?review_comment/gi, "");
      return `<review_comment>\nid:${c.id} ${c.file}${loc} @${c.author}${reply}\n${safeBody}\n</review_comment>`;
    })
    .join("\n\n");
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
  client: Anthropic = new Anthropic(),
  log: Logger = () => {},
): Promise<DeltaBrief> {
  const delta = await streamStructured(
    client,
    DeltaBriefSchema,
    buildDeltaSystemPrompt(),
    renderDeltaUser(input),
    "delta",
    log,
  );
  // Identifiers come from our own fetch, not the model.
  delta.pr = {
    repo: `${input.locator.owner}/${input.locator.repo}`,
    number: input.locator.number,
    title: input.meta.title,
    url: input.meta.url,
    sha: input.meta.sha,
    description: input.meta.body,
  };
  delta.baselineSha = input.baselineSha;
  delta.headSha = input.headSha;
  warnIssues(validatePartition(delta.changedGroups, delta.chunks), log);
  return delta;
}
