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
  // Fetched link bodies are untrusted third-party text. Fence each in a tag
  // (and strip any nested fence so the content can't break out) so the model
  // treats it as data, not instructions. See the system prompt's warning.
  const linked = pr.links.length
    ? pr.links
        .map((l) => {
          const safe = l.content.replace(/<\/?linked_context/gi, "");
          return `<linked_context url="${l.url}">\n${safe}\n</linked_context>`;
        })
        .join("\n\n")
    : "(none)";
  return `PR: ${pr.meta.url}
Repo: ${pr.locator.owner}/${pr.locator.repo}
Number: ${pr.locator.number}
Title: ${pr.meta.title}

## Description
${pr.meta.body.trim() || "(no description)"}

## Linked context
${linked}

## Files changed
${fileList || "(none reported)"}

## Unified diff
${pr.diff}`;
}

/** Progress sink — defaults to no-op so the function stays usable in tests. */
export type Logger = (message: string) => void;

export async function categorize(
  pr: FetchedPr,
  client: Anthropic = new Anthropic(),
  log: Logger = () => {},
): Promise<Brief> {
  // Stream rather than parse(): with adaptive thinking + a large max_tokens the
  // SDK refuses a non-streaming request that may exceed its 10-minute timeout.
  // finalMessage() still yields parsed_output from the zodOutputFormat schema.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { format: zodOutputFormat(BriefSchema), effort: 'medium' },
    system: [
      {
        type: "text",
        text: buildSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: renderUser(pr) }],
  });

  // Live progress: which phase the model is in, how long it has run, and how
  // much output it has emitted. A heartbeat covers the long silent stretches
  // (e.g. extended thinking) where no deltas arrive for a while.
  const start = Date.now();
  const elapsed = (): string => `${((Date.now() - start) / 1000).toFixed(0)}s`;
  let phase: "thinking" | "writing brief" = "thinking";
  let outChars = 0;
  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start" && event.content_block.type === "text") {
      phase = "writing brief";
      log(`writing brief… (${elapsed()})`);
    } else if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      outChars += event.delta.text.length;
    }
  });
  log("thinking…");
  const heartbeat = setInterval(() => {
    const size = outChars > 0 ? `, ${outChars} chars` : "";
    log(`…${phase} (${elapsed()}${size})`);
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
    throw new Error("Model refused to categorize this PR.");
  }
  const brief = response.parsed_output;
  if (!brief) {
    throw new Error(
      `No structured output returned (stop_reason=${response.stop_reason}).`,
    );
  }

  // PR identifiers + description come from our own fetch, not the model —
  // never trust the model for repo/number/url/sha or the verbatim description.
  brief.pr = {
    repo: `${pr.locator.owner}/${pr.locator.repo}`,
    number: pr.locator.number,
    title: pr.meta.title,
    url: pr.meta.url,
    sha: pr.meta.sha,
    description: pr.meta.body,
  };
  return brief;
}
