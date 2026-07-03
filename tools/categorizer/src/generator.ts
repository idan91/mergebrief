import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod/v4";
import type { Effort, Generation } from "./types.js";

/** Progress sink — defaults to no-op so callers stay usable in tests. */
export type Logger = (message: string) => void;

/** One structured-generation request — the portable contract every adapter honors. */
export interface GenerateRequest<S extends z.ZodType> {
  schema: S;
  system: string;
  user: string;
  effort: Effort;
  /** Short label for progress logs, e.g. "brief" / "delta". */
  label: string;
  log?: Logger;
}

/**
 * The base contract all providers fit (ADR 0013): **structured generation** —
 * `(schema, system, user) → object valid against the schema`. Provider-specific
 * features (thinking, caching, …) live on each adapter, never in this signature.
 * A provider/model that can't meet this contract is not a valid adapter (the
 * structured-output floor is hard, not best-effort).
 */
export interface Generator {
  generate<S extends z.ZodType>(req: GenerateRequest<S>): Promise<z.infer<S>>;
  /** Provenance for an artifact this generator produced at the given effort. */
  provenance(effort: Effort): Generation;
}

/**
 * Anthropic adapter on the official SDK (the default per the claude-api skill):
 * Opus 4.8 with adaptive thinking, effort, prompt caching, and native
 * structured output. The system prompt (the taxonomy) is the stable prefix, so
 * it carries a cache_control breakpoint; the volatile diff goes in the user
 * turn after it. Streaming (not parse()) because adaptive thinking + a large
 * max_tokens trips the SDK's 10-minute guard.
 */
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 32000;

export class AnthropicGenerator implements Generator {
  private readonly client: Anthropic;

  constructor(client: Anthropic = new Anthropic()) {
    this.client = client;
  }

  provenance(effort: Effort): Generation {
    return { provider: "anthropic", model: MODEL, effort };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    const log = req.log ?? (() => {});
    const stream = this.client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(req.schema), effort: req.effort },
      system: [
        { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: req.user }],
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
        log(`writing ${req.label}… (${elapsed()})`);
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        outChars += event.delta.text.length;
      }
    });
    log(`thinking… (${req.label})`);
    const heartbeat = setInterval(() => {
      const size = outChars > 0 ? `, ${outChars} chars` : "";
      log(`…${phase} ${req.label} (${elapsed()}${size})`);
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
      throw new Error(`Model refused to produce the ${req.label}.`);
    }
    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error(
        `No structured output for ${req.label} (stop_reason=${response.stop_reason}).`,
      );
    }
    return parsed;
  }
}
