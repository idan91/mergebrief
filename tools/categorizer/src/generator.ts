import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod/v4";
import { salvageDroppableEnums } from "./salvage.js";
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
  /**
   * Array fields whose invalid elements may be dropped (warn-and-drop) when
   * strict parsing fails. Anthropic structured output doesn't enforce `enum`
   * server-side (the SDK demotes it to description prose), so the model can
   * emit an out-of-vocabulary token; for supplementary fields that's not
   * worth killing a whole generation over. Structural failures and fields
   * not named here still hard-fail (after one retry).
   */
  salvageFields?: readonly string[];
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
 *
 * Parse-failure handling (the structured-output floor stays hard, but not
 * hair-trigger): salvage droppable enum slips per `salvageFields`; otherwise
 * retry ONCE with the validation errors fed back; the raw output of every
 * failed attempt is dumped to `<failureDir>/<label>-*.failed.json` so
 * failures are never opaque.
 */
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 32000;

export class AnthropicGenerator implements Generator {
  private readonly client: Anthropic;
  private readonly failureDir: string;
  /** Disambiguates dump filenames within one process (Date.now can collide). */
  private dumpCounter = 0;

  constructor(client: Anthropic = new Anthropic(), failureDir = "out") {
    this.client = client;
    this.failureDir = failureDir;
  }

  provenance(effort: Effort): Generation {
    return { provider: "anthropic", model: MODEL, effort };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    const log = req.log ?? (() => {});
    const baseMessages: Anthropic.MessageParam[] = [
      { role: "user", content: req.user },
    ];
    let feedback: { raw: string; error: string } | null = null;

    for (let attempt = 0; ; attempt++) {
      // On retry, the model sees its own failed output plus the validation
      // errors — mid-conversation assistant turns are fine (only last-turn
      // prefill is disallowed), and the cached system+user prefix is reused.
      const messages: Anthropic.MessageParam[] = feedback
        ? [
            ...baseMessages,
            { role: "assistant", content: feedback.raw },
            {
              role: "user",
              content:
                `Your previous response failed schema validation:\n${feedback.error}\n\n` +
                `Produce the corrected JSON object conforming exactly to the schema. ` +
                `Use ONLY tokens from the closed vocabularies — never invent a token.`,
            },
          ]
        : baseMessages;

      // Sequential by design: the retry needs the failed attempt's output.
      // eslint-disable-next-line no-await-in-loop
      const response = await this.request(req, messages, log);

      if (response.stop_reason === "refusal") {
        throw new Error(`Model refused to produce the ${req.label}.`);
      }

      let parseError: unknown;
      try {
        const parsed = response.parsed_output;
        if (parsed) return parsed;
        throw new Error(
          `No structured output for ${req.label} (stop_reason=${response.stop_reason}).`,
        );
      } catch (error) {
        parseError = error;
      }

      const raw = textContent(response);
      const salvaged =
        raw !== "" && req.salvageFields?.length
          ? salvageDroppableEnums(
              tryJsonParse(raw),
              req.schema,
              new Set(req.salvageFields),
            )
          : null;
      if (salvaged) {
        log(`⚠ salvaged ${req.label}: ${salvaged.issues.join("; ")}`);
        return salvaged.value;
      }

      const errorMessage =
        parseError instanceof Error ? parseError.message : String(parseError);
      const dumpPath = this.dumpFailure(req.label, raw, errorMessage);
      const dumpNote = dumpPath ? ` (raw output saved to ${dumpPath})` : "";

      if (attempt === 0 && raw !== "") {
        log(
          `⚠ ${req.label} failed schema validation — retrying once with error feedback${dumpNote}`,
        );
        feedback = { raw, error: errorMessage };
        continue;
      }

      throw new Error(`${errorMessage}${dumpNote}`, { cause: parseError });
    }
  }

  /** One streamed request with live progress + heartbeat logging. */
  private async request<S extends z.ZodType>(
    req: GenerateRequest<S>,
    messages: Anthropic.MessageParam[],
    log: Logger,
  ) {
    const stream = this.client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(req.schema), effort: req.effort },
      system: [
        { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
      ],
      messages,
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
    return response;
  }

  /**
   * Persist a failed attempt's raw output next to the artifacts so a schema
   * failure is debuggable after the fact (the Zod error alone doesn't show
   * what the model actually emitted). Best-effort — never throws.
   */
  private dumpFailure(
    label: string,
    raw: string,
    error: string,
  ): string | null {
    try {
      mkdirSync(this.failureDir, { recursive: true });
      const file = join(
        this.failureDir,
        `${label.replace(/\W+/g, "-")}-${Date.now()}-${this.dumpCounter++}.failed.json`,
      );
      writeFileSync(file, JSON.stringify({ error, raw }, null, 2));
      return file;
    } catch {
      return null;
    }
  }
}

/** The response's text content — the raw (possibly invalid) structured output. */
function textContent(response: { content: { type: string }[] }): string {
  return response.content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

/** JSON.parse that yields undefined (never throws) on malformed text. */
function tryJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
