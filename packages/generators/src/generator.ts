import Anthropic, {
  AnthropicError,
  APIConnectionError,
  RetryableError,
} from "@anthropic-ai/sdk";
import type { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKind } from "./errors";
import { runWithSchemaFloor, schemaFeedbackMessage } from "./floor";
import { enumPreservingJsonSchema } from "./outputFormat";
import type { Effort, Generation } from "./vocabulary";

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
   * strict parsing fails. Closed vocabularies are now enforced server-side via
   * the hand-built enum-preserving schema (`enumPreservingJsonSchema`), so an
   * out-of-vocabulary token can no longer be decoded in the first place. Salvage
   * stays as defense-in-depth for what enforcement doesn't cover — structural
   * failures, refusals, and any residual slip — dropping bad elements of
   * supplementary fields rather than killing a whole generation. Structural
   * failures and fields not named here still hard-fail (after one retry).
   */
  salvageFields?: readonly string[];
  /**
   * Cooperative cancellation (ADR 0006 #6): aborting stops the underlying
   * stream (and output-token billing) mid-call. The abort rejection
   * propagates to the caller UNTOUCHED — no salvage, no feedback retry, no
   * failure dump: an abort is not a generation failure.
   */
  signal?: AbortSignal;
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

// ---------------------------------------------------------------------------
// The structural slice of the SDK client the adapter touches — lets tests
// fake it with `satisfies` instead of double assertions, while the real
// `Anthropic` instance remains assignable unchanged.
// ---------------------------------------------------------------------------

/** The response fields the adapter reads off a finished stream. */
export interface AnthropicStreamResponse {
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
  };
  content: { type: string }[];
}

/** The stream-handle surface the adapter drives. */
export interface AnthropicStreamHandle {
  on(
    event: "streamEvent",
    listener: (event: Anthropic.MessageStreamEvent) => void,
  ): unknown;
  finalMessage(): Promise<AnthropicStreamResponse>;
}

/** The client surface the adapter needs — `Anthropic` satisfies it as-is. */
export interface AnthropicStreamingClient {
  messages: {
    stream(
      body: Parameters<Anthropic["messages"]["stream"]>[0],
      options?: { signal?: AbortSignal },
    ): AnthropicStreamHandle;
  };
}

/**
 * Anthropic adapter on the official SDK (the default per the claude-api skill):
 * Opus 4.8 with adaptive thinking, effort, prompt caching, and native
 * structured output. The system prompt (the taxonomy) is the stable prefix, so
 * it carries a cache_control breakpoint; the volatile diff goes in the user
 * turn after it. Streaming (not parse()) because adaptive thinking + a large
 * max_tokens trips the SDK's 10-minute guard.
 *
 * Parse-failure handling is the shared schema-floor pipeline
 * (`runWithSchemaFloor`): salvage droppable enum slips per `salvageFields`;
 * otherwise retry ONCE with the validation errors fed back; the raw output
 * of every failed attempt is dumped to `<failureDir>/<label>-*.failed.json`
 * so failures are never opaque.
 *
 * The wire format carries the enum-preserving JSON schema WITHOUT a client
 * `parse` callback: SDK ≥0.101 parses eagerly at message_stop and a `parse`
 * member would turn an invalid output into a stream REJECTION — skipping
 * salvage, retry, and dump entirely. The pipeline owns validation; the SDK's
 * residual JSON.parse rejection (non-JSON output, e.g. max_tokens truncation)
 * is caught below and converted into a pipeline-visible failed attempt.
 */
const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 32000;

export class AnthropicGenerator implements Generator {
  private readonly client: AnthropicStreamingClient;
  private readonly failureDir: string;
  private readonly model: string;

  constructor(
    client: AnthropicStreamingClient = new Anthropic(),
    failureDir = "out",
    model: string = DEFAULT_MODEL,
  ) {
    this.client = client;
    this.failureDir = failureDir;
    this.model = model;
  }

  provenance(effort: Effort): Generation {
    return { provider: "anthropic", model: this.model, effort };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    const log = req.log ?? (() => {});
    const baseMessages: Anthropic.MessageParam[] = [
      { role: "user", content: req.user },
    ];

    // Built once per generate(): an unrepresentable schema is a programmer/
    // config error (taxonomy kind config), not a generation failure.
    let wireSchema: Record<string, unknown>;
    try {
      wireSchema = enumPreservingJsonSchema(req.schema);
    } catch (error) {
      throw new GeneratorError(
        GeneratorErrorKind.CONFIG,
        `schema for ${req.label} is not representable as a strict JSON schema: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        { cause: error },
      );
    }

    return runWithSchemaFloor({
      schema: req.schema,
      label: req.label,
      ...(req.salvageFields ? { salvageFields: req.salvageFields } : {}),
      failureDir: this.failureDir,
      log,
      attempt: async (feedback) => {
        // On retry, the model sees its own failed output plus the validation
        // errors — mid-conversation assistant turns are fine (only last-turn
        // prefill is disallowed), and the cached system+user prefix is reused.
        const messages: Anthropic.MessageParam[] = feedback
          ? [
              ...baseMessages,
              { role: "assistant", content: feedback.raw },
              { role: "user", content: schemaFeedbackMessage(feedback.error) },
            ]
          : baseMessages;

        const outcome = await this.request(req, wireSchema, messages, log);
        if ("sdkParseFailure" in outcome) {
          // The SDK's eager JSON.parse rejected (non-JSON output): hand the
          // delta-accumulated raw to the pipeline as a failed attempt so
          // salvage/retry/dump still run.
          return { raw: outcome.raw, invalidReason: outcome.sdkParseFailure };
        }

        const response = outcome.response;
        if (response.stop_reason === "refusal") {
          throw new GeneratorError(
            GeneratorErrorKind.REFUSAL,
            `Model refused to produce the ${req.label}.`,
          );
        }

        const raw = textContent(response);
        if (raw === "") {
          // Preserve the pre-pipeline diagnostic for a no-text response.
          return {
            raw,
            invalidReason: `No structured output for ${req.label} (stop_reason=${response.stop_reason}).`,
          };
        }
        // The pipeline owns validation (identical message shapes via
        // parseStructuredText), so only the raw text crosses the seam.
        return { raw };
      },
    });
  }

  /** One streamed request with live progress + heartbeat logging. */
  private async request<S extends z.ZodType>(
    req: GenerateRequest<S>,
    wireSchema: Record<string, unknown>,
    messages: Anthropic.MessageParam[],
    log: Logger,
  ): Promise<
    | { response: AnthropicStreamResponse }
    | { sdkParseFailure: string; raw: string }
  > {
    // The request options' `signal` aborts the HTTP stream itself — the SDK
    // rejects with APIUserAbortError and no further output tokens are billed.
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        output_config: {
          // Schema only — never a client parse callback (see class docs).
          format: { type: "json_schema", schema: wireSchema },
          effort: req.effort,
        },
        system: [
          { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
        ],
        messages,
      },
      req.signal ? { signal: req.signal } : undefined,
    );

    // Live progress: phase + elapsed + output size. A heartbeat covers the long
    // silent stretches (e.g. extended thinking) where no deltas arrive. The
    // accumulated text doubles as the raw output when the SDK's eager parse
    // rejects the final message before we can read it.
    const start = Date.now();
    const elapsed = (): string => `${((Date.now() - start) / 1000).toFixed(0)}s`;
    let phase: "thinking" | "writing" = "thinking";
    let collected = "";
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
        collected += event.delta.text;
      }
    });
    log(`thinking… (${req.label})`);
    const heartbeat = setInterval(() => {
      const size = collected.length > 0 ? `, ${collected.length} chars` : "";
      log(`…${phase} ${req.label} (${elapsed()}${size})`);
    }, 5000);

    let response: AnthropicStreamResponse;
    try {
      response = await stream.finalMessage();
    } catch (error) {
      if (
        error instanceof AnthropicError &&
        error.message.startsWith("Failed to parse structured output")
      ) {
        return { sdkParseFailure: error.message, raw: collected };
      }
      // Recognized SDK failures adopt the shared taxonomy (decision 5);
      // anything unrecognized — most importantly aborts — propagates
      // UNTOUCHED (ADR 0006 #6).
      throw classifySdkError(error);
    } finally {
      clearInterval(heartbeat);
    }

    const u = response.usage;
    log(
      `done in ${elapsed()} — tokens in:${u.input_tokens} out:${u.output_tokens} ` +
        `cache_read:${u.cache_read_input_tokens ?? 0}`,
    );
    return { response };
  }
}

/**
 * Map recognized SDK failures onto the shared taxonomy (decision 5):
 * 401/403 → auth; 400/404 (bad model, unsupported request shape) → config;
 * 408/429/5xx after the SDK's own retries, and connection-level failures →
 * provider-transient. Unrecognized errors (aborts, custom rejections)
 * return UNCHANGED so they propagate untouched.
 */
function classifySdkError(error: unknown): unknown {
  // Statusless-but-retryable SDK failures (connection errors, middleware
  // RetryableError surfacing after retry exhaustion) are provider-transient.
  if (error instanceof APIConnectionError || error instanceof RetryableError) {
    return new GeneratorError(
      GeneratorErrorKind.PROVIDER_TRANSIENT,
      error.message,
      { cause: error },
    );
  }
  if (typeof error !== "object" || error === null) return error;
  if (Reflect.get(error, "name") === "APIUserAbortError") return error;
  const status = Reflect.get(error, "status");
  if (typeof status !== "number") return wrapStatuslessSdkError(error);
  // SDK Error messages are provider-authored status descriptions (never
  // credential-bearing); a non-Error carrier gets a fixed message instead
  // of echoing arbitrary object contents.
  const message =
    error instanceof Error ? error.message : `transport error (status ${status})`;
  if (status === 401 || status === 403) {
    return new GeneratorError(GeneratorErrorKind.AUTH, message, { cause: error });
  }
  if (status === 400 || status === 404) {
    return new GeneratorError(GeneratorErrorKind.CONFIG, message, { cause: error });
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new GeneratorError(GeneratorErrorKind.PROVIDER_TRANSIENT, message, {
      cause: error,
    });
  }
  return new GeneratorError(GeneratorErrorKind.OPAQUE, message, { cause: error });
}

/**
 * Statusless SDK failures that aren't aborts (e.g. "stream ended without a
 * message") still belong to the taxonomy — opaque, original as cause.
 */
function wrapStatuslessSdkError(error: unknown): unknown {
  if (error instanceof AnthropicError) {
    return new GeneratorError(GeneratorErrorKind.OPAQUE, error.message, {
      cause: error,
    });
  }
  return error;
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
