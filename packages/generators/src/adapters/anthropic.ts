import Anthropic, {
  AnthropicError,
  APIConnectionError,
  RetryableError,
  type ClientOptions,
} from "@anthropic-ai/sdk";
import type { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKinds } from "../contract/errors";
import type { GenerateRequest, Generator, Logger } from "../contract/generator";
import {
  runWithSchemaFloor,
  schemaFeedbackMessage,
  type RunWithSchemaFloorArgs,
} from "../validation/enforceSchema";
import { enumPreservingJsonSchema } from "../validation/jsonSchema";
import type { Effort, Generation } from "../contract/generation";

// Keep the real SDK assignable while tests fake this narrow slice with satisfies.

/** The response fields the adapter reads off a finished stream. */
export interface AnthropicStreamResponse {
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
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

/** The client surface the adapter needs, `Anthropic` satisfies it as-is. */
export interface AnthropicStreamingClient {
  messages: {
    stream(
      body: Parameters<Anthropic["messages"]["stream"]>[0],
      options?: { signal?: AbortSignal },
    ): AnthropicStreamHandle;
  };
}

/**
 * Cache the stable system prefix and stream to avoid the SDK's adaptive-thinking timeout guard.
 * Send schema without an SDK parse callback: eager parsing would bypass salvage/retry/dump.
 * Convert residual JSON parsing rejections into floor-visible attempts.
 * The shared schema floor owns validation regardless of native structured-output enforcement.
 */
const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_OUTPUT_TOKENS = 64000;
const CUT_STOP_REASON: Anthropic.StopReason = "max_tokens";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";

export interface AnthropicClientOptions {
  apiKey: string;
  /** The Instance config's gateway host root, without `/v1`; the canonical host when absent. */
  baseUrl?: string | undefined;
  /** Injected for fetch-level test fixtures. */
  fetch?: typeof globalThis.fetch;
}

/**
 * An explicit `baseURL` and a null `authToken` keep the SDK from reading
 * `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`; `ANTHROPIC_CUSTOM_HEADERS`
 * still merges over the auth headers.
 */
export function createAnthropicClient(
  options: AnthropicClientOptions,
): Anthropic {
  const clientOptions: ClientOptions = {
    apiKey: options.apiKey,
    authToken: null,
    baseURL: options.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL,
  };

  if (options.fetch) {
    clientOptions.fetch = options.fetch;
  }
  return new Anthropic(clientOptions);
}

export class AnthropicGenerator implements Generator {
  private readonly client: AnthropicStreamingClient;
  private readonly failureDir: string;
  private readonly model: string;

  constructor(
    client: AnthropicStreamingClient,
    failureDir = "out",
    model: string = DEFAULT_MODEL,
  ) {
    this.client = client;
    this.failureDir = failureDir;
    this.model = model;
  }

  origin(effort: Effort): Generation {
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
        GeneratorErrorKinds.CONFIG,
        `schema for ${req.label} is not representable as a strict JSON schema: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        { cause: error },
      );
    }

    const floor: RunWithSchemaFloorArgs<S> = {
      schema: req.schema,
      label: req.label,
      failureDir: this.failureDir,
      log,
      attempt: async (feedback) => {
        // On retry, the model sees its own failed output plus the validation
        // errors, mid-conversation assistant turns are fine (only last-turn
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
          // salvage/retry/dump still run, unless the stream stopped at the cap.
          if (outcome.stopReason === CUT_STOP_REASON) {
            return { raw: outcome.raw, cut: true };
          }
          return { raw: outcome.raw, invalidReason: outcome.sdkParseFailure };
        }

        const response = outcome.response;
        if (response.stop_reason === CUT_STOP_REASON) {
          return { raw: textContent(response), cut: true };
        }
        if (response.stop_reason === "refusal") {
          throw new GeneratorError(
            GeneratorErrorKinds.REFUSAL,
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
        // parseStructuredText), so only the raw text crosses the boundary.
        return { raw };
      },
    };

    if (req.salvageFields) {
      floor.salvageFields = req.salvageFields;
    }
    if (req.onWarning) {
      floor.onWarning = req.onWarning;
    }
    if (req.redact) {
      floor.redact = req.redact;
    }
    if (req.screenAttempt) {
      floor.screenAttempt = req.screenAttempt;
    }

    return runWithSchemaFloor(floor);
  }

  /** One streamed request with live progress + heartbeat logging. */
  private async request<S extends z.ZodType>(
    req: GenerateRequest<S>,
    wireSchema: Record<string, unknown>,
    messages: Anthropic.MessageParam[],
    log: Logger,
  ): Promise<
    | { response: AnthropicStreamResponse }
    | {
        sdkParseFailure: string;
        raw: string;
        stopReason: Anthropic.StopReason | undefined;
      }
  > {
    // The request options' `signal` aborts the HTTP stream itself, the SDK
    // rejects with APIUserAbortError and no further output tokens are billed.
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        thinking: { type: "adaptive" },
        output_config: {
          // Schema only, never a client parse callback (see class docs).
          format: { type: "json_schema", schema: wireSchema },
          effort: req.effort,
        },
        system: [
          {
            type: "text",
            text: req.system,
            cache_control: { type: "ephemeral" },
          },
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
    const elapsed = (): string =>
      `${((Date.now() - start) / 1000).toFixed(0)}s`;
    let phase: "thinking" | "writing" = "thinking";
    let collected = "";
    let stopReason: Anthropic.StopReason | undefined;
    // Usage accumulated from stream events: the fallback source when the
    // SDK's eager parse rejects finalMessage(), the truncated attempt is
    // the EXPENSIVE one, and its spend must not vanish from onUsage sums.
    // Boxed because closure writes don't survive TS's flow narrowing.
    const streamUsage: {
      current: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      } | null;
    } = { current: null };
    stream.on("streamEvent", (event) => {
      if (event.type === "message_start") {
        streamUsage.current = {
          input: event.message.usage.input_tokens,
          output: event.message.usage.output_tokens,
          cacheRead: event.message.usage.cache_read_input_tokens ?? 0,
          cacheWrite: event.message.usage.cache_creation_input_tokens ?? 0,
        };
      } else if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason ?? undefined;
        // Cumulative per the API: overwrite, never add.
        if (streamUsage.current) {
          streamUsage.current.output = event.usage.output_tokens;
        }
      } else if (
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
        // The stream completed and was billed, the rejection is the SDK's
        // parse, not the request. Report what the events carried.
        if (streamUsage.current) {
          req.onUsage?.({
            inputTokens: streamUsage.current.input,
            outputTokens: streamUsage.current.output,
            cacheReadTokens: streamUsage.current.cacheRead,
            cacheWriteTokens: streamUsage.current.cacheWrite,
          });
        }
        return { sdkParseFailure: error.message, raw: collected, stopReason };
      }
      // Recognized SDK failures adopt the shared taxonomy; anything
      // unrecognized, most importantly aborts, propagates UNTOUCHED.
      throw classifySdkError(error);
    } finally {
      clearInterval(heartbeat);
    }

    const u = response.usage;
    log(
      `done in ${elapsed()} — tokens in:${u.input_tokens} out:${u.output_tokens} ` +
        `cache_read:${u.cache_read_input_tokens ?? 0}`,
    );
    req.onUsage?.({
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    });
    return { response };
  }
}

/**
 * Classify recognized SDK auth/config/transient failures after SDK retries.
 * Unknown failures, aborts and custom rejections must propagate unchanged.
 */
function classifySdkError(error: unknown): unknown {
  // Statusless-but-retryable SDK failures (connection errors, middleware
  // RetryableError surfacing after retry exhaustion) are provider-transient.
  if (error instanceof APIConnectionError || error instanceof RetryableError) {
    return new GeneratorError(
      GeneratorErrorKinds.PROVIDER_TRANSIENT,
      error.message,
      { cause: error },
    );
  }
  if (typeof error !== "object" || error === null) {
    return error;
  }
  if (Reflect.get(error, "name") === "APIUserAbortError") {
    return error;
  }
  const status = Reflect.get(error, "status");
  if (typeof status !== "number") {
    return wrapStatuslessSdkError(error);
  }
  // SDK Error messages are provider-authored status descriptions (never
  // credential-bearing); a non-Error value gets a fixed message instead
  // of echoing arbitrary object contents.
  const message =
    error instanceof Error
      ? error.message
      : `transport error (status ${status})`;
  if (status === 401 || status === 403) {
    return new GeneratorError(GeneratorErrorKinds.AUTH, message, {
      cause: error,
    });
  }
  if (status === 400 || status === 404) {
    return new GeneratorError(GeneratorErrorKinds.CONFIG, message, {
      cause: error,
    });
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new GeneratorError(GeneratorErrorKinds.PROVIDER_TRANSIENT, message, {
      cause: error,
    });
  }
  return new GeneratorError(GeneratorErrorKinds.OPAQUE, message, {
    cause: error,
  });
}

/**
 * Statusless SDK failures that aren't aborts (e.g. "stream ended without a
 * message") still belong to the taxonomy, opaque, original as cause.
 */
function wrapStatuslessSdkError(error: unknown): unknown {
  if (error instanceof AnthropicError) {
    return new GeneratorError(GeneratorErrorKinds.OPAQUE, error.message, {
      cause: error,
    });
  }
  return error;
}

/** The response's text content, the raw (possibly invalid) structured output. */
function textContent(response: { content: { type: string }[] }): string {
  return response.content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}
