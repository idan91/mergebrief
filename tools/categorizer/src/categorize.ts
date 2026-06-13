import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { BriefSchema, type Brief } from "./types.js";
import { buildSystemPrompt } from "./prompt.js";
import type { FetchedPr } from "./github.js";

/**
 * Opus 4.8 with adaptive thinking. The system prompt (the taxonomy) is the
 * stable prefix, so it carries a cache_control breakpoint; the volatile diff
 * goes in the user turn after it. Structured output is enforced with
 * messages.parse() + zodOutputFormat(BriefSchema).
 */
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 32000;

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

## Files changed
${fileList || "(none reported)"}

## Unified diff
${pr.diff}`;
}

export async function categorize(
  pr: FetchedPr,
  client: Anthropic = new Anthropic(),
): Promise<Brief> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { format: zodOutputFormat(BriefSchema) },
    system: [
      {
        type: "text",
        text: buildSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: renderUser(pr) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Model refused to categorize this PR.");
  }
  const brief = response.parsed_output;
  if (!brief) {
    throw new Error(
      `No structured output returned (stop_reason=${response.stop_reason}).`,
    );
  }

  // PR identifiers come from our own fetch, not the model — never trust the
  // model for repo/number/url/sha.
  brief.pr = {
    repo: `${pr.locator.owner}/${pr.locator.repo}`,
    number: pr.locator.number,
    title: pr.meta.title,
    url: pr.meta.url,
    sha: pr.meta.sha,
  };
  return brief;
}
