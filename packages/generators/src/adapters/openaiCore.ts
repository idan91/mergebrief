import { APIConnectionError, APIUserAbortError, OpenAIError } from "openai";
import type { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKinds } from "../contract/errors";
import {
  GeneratorWarningKinds,
  type GeneratorWarningSink,
} from "../contract/types";
import {
  runWithSchemaFloor,
  schemaFeedbackMessage,
  type RunWithSchemaFloorArgs,
} from "../validation/enforceSchema";
import type {
  GenerateRequest,
  Generator,
  Logger,
  TokenUsage,
} from "../contract/generator";
import { enumPreservingJsonSchema } from "../validation/jsonSchema";
import {
  stripInjectedNulls,
  withAllRequired,
} from "../validation/openaiStrict";
import type { Effort, Generation } from "../contract/generation";
import {
  joinUserText,
  redactProviderMessage,
  sanitizeProviderCause,
} from "./utils";

/**
 * Every response passes the shared schema floor; native strict schema is an extra layer.
 * Propagate aborts unchanged. Discover absent effort support on a parameter-naming 400,
 * retry once without it, then cache the gap and stamp effort null.
 * Never interpolate request bodies, headers or credentials into errors.
 */

/** One streamed chunk, the narrow shape the core reads. */
export interface OpenAiStreamChunk {
  choices?: {
    delta?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
  /** Final-chunk usage; present only when requested via stream_options. */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
    completion_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
}

/** The chat request the core issues (always streaming). */
export interface OpenAiChatRequest {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  response_format: {
    type: "json_schema";
    json_schema: {
      name: string;
      strict: true;
      schema: Record<string, unknown>;
    };
  };
  reasoning_effort?: Effort;
  stream: true;
  /** Sent iff the caller passed onUsage, zero wire change for callers that
   * don't observe usage. */
  stream_options?: { include_usage: true };
}

/** Per-call knobs a transport honors alongside the wire body. */
export interface StreamChatOptions {
  signal?: AbortSignal;
  /** The PER-REQUEST logger, not the construction-time process log. */
  log?: Logger;
  /** The PER-REQUEST sink: a wrapper's warnings reach the artifact through it. */
  onWarning?: GeneratorWarningSink;
}

/**
 * Provider wrappers add body extensions before the SDK call.
 * Keep this streaming boundary independent of provider-specific routing shapes.
 */
export interface OpenAiChatTransport {
  streamChat(
    body: OpenAiChatRequest,
    options: StreamChatOptions,
  ): Promise<AsyncIterable<OpenAiStreamChunk>>;
}

export interface OpenAiCompatibleCoreOptions {
  transport: OpenAiChatTransport;
  /** Origin provider token ("openai" | "openrouter"). */
  provider: string;
  model: string;
  failureDir: string;
  /**
   * Pre-seeded effort-knob knowledge (openrouter learns it from its
   * /models preflight, no discovery 400 needed). Omit for run-time
   * discovery.
   */
  initialEffortSupported?: boolean | undefined;
  /**
   * The parameter name a knob-rejection 400 would mention. The default
   * matches the OpenAI wire name; openrouter's transport translates the
   * knob to `reasoning`, so its rejections name THAT (transport-aware
   * backstop for a listing that lied about reasoning support).
   */
  knobRejectionMarker?: string | undefined;
}

/** Documented finish reasons; anything else renders as unrecognized,
 * the field is provider output and must not carry arbitrary text. */
const KNOWN_FINISH_REASONS = new Set([
  "stop",
  "length",
  "content_filter",
  "tool_calls",
  "function_call",
]);

function renderFinishReason(reason: string | null): string {
  if (reason === null) {
    return "none";
  }
  return KNOWN_FINISH_REASONS.has(reason) ? reason : "(unrecognized)";
}

const STREAM_OPTIONS_PARAMETER = "stream_options";

/** response_format.json_schema.name grammar: [a-zA-Z0-9_-]{1,64}. */
function schemaName(label: string): string {
  const cleaned = label.replaceAll(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return cleaned === "" ? "output" : cleaned;
}

export class OpenAiCompatibleCore implements Generator {
  private readonly transport: OpenAiChatTransport;
  private readonly provider: string;
  private readonly model: string;
  private readonly failureDir: string;
  /**
   * Instance-lifetime effort-knob cache: null = unknown, true/false once
   * discovered. Discovered-absent surfaces in the origin stamp as effort null.
   */
  private effortSupported: boolean | null;
  private readonly knobRejectionMarker: string;
  /** False once the provider rejected `stream_options`: usage goes unreported. */
  private usageSupported = true;

  constructor(options: OpenAiCompatibleCoreOptions) {
    this.transport = options.transport;
    this.provider = options.provider;
    this.model = options.model;
    this.failureDir = options.failureDir;
    this.effortSupported = options.initialEffortSupported ?? null;
    this.knobRejectionMarker =
      options.knobRejectionMarker ?? "reasoning_effort";
  }

  origin(effort: Effort): Generation {
    return {
      provider: this.provider,
      model: this.model,
      effort: this.effortSupported === false ? null : effort,
    };
  }

  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    const log = req.log ?? (() => {});

    let wireSchema: Record<string, unknown>;
    let openAiWireSchema: Record<string, unknown>;
    try {
      wireSchema = enumPreservingJsonSchema(req.schema);
      // OpenAI-lineage strict mode rejects optional properties ("'required'
      // ... must include every key in properties"), send the all-required
      // null-union variant, and strip the stand-in nulls back out below.
      openAiWireSchema = withAllRequired(wireSchema);
    } catch (error) {
      throw new GeneratorError(
        GeneratorErrorKinds.CONFIG,
        `schema for ${req.label} is not representable as a strict JSON schema: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        { cause: error },
      );
    }

    const baseMessages: OpenAiChatRequest["messages"] = [
      { role: "system", content: req.system },
      { role: "user", content: joinUserText(req) },
    ];

    const floor: RunWithSchemaFloorArgs<S> = {
      schema: req.schema,
      label: req.label,
      failureDir: this.failureDir,
      log,
      attempt: async (feedback) => {
        const messages: OpenAiChatRequest["messages"] = feedback
          ? [
              ...baseMessages,
              { role: "assistant", content: feedback.raw },
              { role: "user", content: schemaFeedbackMessage(feedback.error) },
            ]
          : baseMessages;
        const outcome = await this.request(
          req,
          openAiWireSchema,
          messages,
          log,
        );
        if (outcome.refusal !== null) {
          throw new GeneratorError(
            GeneratorErrorKinds.REFUSAL,
            `Model refused to produce the ${req.label}.`,
          );
        }
        if (outcome.finishReason === "length") {
          return { raw: outcome.raw, cut: true };
        }
        if (outcome.finishReason !== "stop") {
          // Only "stop" is a completed generation. EOF without a terminal
          // finish_reason is a truncated response; "content_filter" ends
          // AFTER partial output, content that happens to parse must never
          // pass the floor as complete.
          return {
            raw: outcome.raw,
            invalidReason: `Stream for ${req.label} ended with finish_reason=${renderFinishReason(outcome.finishReason)} (incomplete or filtered response).`,
            // Incomplete output must not become a completed generation via
            // enum salvage either, retry with the raw as feedback instead.
            salvageable: false,
          };
        }
        if (outcome.raw === "") {
          return {
            raw: "",
            invalidReason: `No output for ${req.label} (finish_reason=stop).`,
          };
        }
        // The null-union wire schema means a compliant model may emit null
        // where the domain schema says "absent", hand the floor a stripped
        // CANDIDATE (still validated there; the floor stays the mechanism).
        let candidate: unknown;
        try {
          candidate = JSON.parse(outcome.raw);
        } catch {
          candidate = undefined; // malformed, let the floor report the parse error
        }
        if (candidate !== undefined) {
          return {
            raw: outcome.raw,
            parsed: stripInjectedNulls(wireSchema, candidate),
          };
        }
        return { raw: outcome.raw };
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

  /** One streamed request; retries without reasoning_effort or
   * stream_options on a 400 that names the parameter (then remembers it is
   * absent), each at most once. */
  private async request<S extends z.ZodType>(
    req: GenerateRequest<S>,
    wireSchema: Record<string, unknown>,
    messages: OpenAiChatRequest["messages"],
    log: Logger,
  ): Promise<{
    raw: string;
    refusal: string | null;
    finishReason: string | null;
  }> {
    const body: OpenAiChatRequest = {
      model: this.model,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName(req.label),
          strict: true,
          schema: wireSchema,
        },
      },
      stream: true,
    };

    if (this.effortSupported !== false) {
      body.reasoning_effort = req.effort;
    }
    const requestsUsage = req.onUsage !== undefined && this.usageSupported;
    if (requestsUsage) {
      body.stream_options = { include_usage: true };
    }

    let attempt = body;
    for (;;) {
      try {
        return await this.consume(req, attempt, log);
      } catch (error) {
        // Every attempt, retries included, classifies at this boundary: a
        // 401/429/connection failure must not escape unclassified.
        const retry = this.dropRejectedParameter(req, attempt, error, log);
        if (retry === undefined) {
          throw classifyOpenAiError(error);
        }
        attempt = retry;
      }
    }
  }

  /**
   * The body without the optional parameter this 400 rejected, or undefined
   * when it rejected none of them. The decision follows THIS request's body,
   * not the shared cache: two concurrent first requests can both send a
   * parameter and both get the 400, and the second must still retry.
   * Discovery is independent of abort timing: the gap is known either way,
   * and an abort landing after the 400 is still an abort.
   */
  private dropRejectedParameter<S extends z.ZodType>(
    req: GenerateRequest<S>,
    body: OpenAiChatRequest,
    error: unknown,
    log: Logger,
  ): OpenAiChatRequest | undefined {
    const effortRejected =
      body.reasoning_effort !== undefined &&
      isParameterRejection(error, this.knobRejectionMarker);
    if (effortRejected) {
      this.effortSupported = false;
      if (req.signal?.aborted) {
        throw new APIUserAbortError();
      }
      const rejectedMessage = `warning: ${this.model} rejected reasoning_effort — retrying without it; origin will record effort: null`;
      log(rejectedMessage);
      req.onWarning?.({
        kind: GeneratorWarningKinds.EFFORT_REJECTED,
        message: rejectedMessage,
      });
      const { reasoning_effort: _dropped, ...rest } = body;
      return rest;
    }

    const usageRejected =
      body.stream_options !== undefined &&
      isParameterRejection(error, STREAM_OPTIONS_PARAMETER);
    if (usageRejected) {
      this.usageSupported = false;
      if (req.signal?.aborted) {
        throw new APIUserAbortError();
      }
      const rejectedMessage = `warning: ${this.model} rejected stream_options, retrying without it; usage goes unreported`;
      log(rejectedMessage);
      req.onWarning?.({
        kind: GeneratorWarningKinds.USAGE_REJECTED,
        message: rejectedMessage,
      });
      const { stream_options: _dropped, ...rest } = body;
      return rest;
    }
    return undefined;
  }

  /** Drive one stream to completion with heartbeat progress logging. */
  private async consume<S extends z.ZodType>(
    req: GenerateRequest<S>,
    body: OpenAiChatRequest,
    log: Logger,
  ): Promise<{
    raw: string;
    refusal: string | null;
    finishReason: string | null;
  }> {
    const start = Date.now();
    const elapsed = (): string =>
      `${((Date.now() - start) / 1000).toFixed(0)}s`;
    let collected = "";
    let refusal = "";
    let finishReason: string | null = null;
    let usage: OpenAiStreamChunk["usage"] = null;
    log(`requesting ${req.label} from ${this.provider}…`);
    const heartbeat = setInterval(() => {
      const size = collected.length > 0 ? `, ${collected.length} chars` : "";
      log(`…writing ${req.label} (${elapsed()}${size})`);
    }, 5000);
    try {
      // The ORIGINAL optional req.log crosses the boundary (not the normalized
      // no-op): a wrapper's `requestLog ?? constructionLog` fallback must
      // still fire for callers that gave no per-request logger.
      const streamOptions: StreamChatOptions = {};

      if (req.signal) {
        streamOptions.signal = req.signal;
      }
      if (req.log) {
        streamOptions.log = req.log;
      }
      if (req.onWarning) {
        streamOptions.onWarning = req.onWarning;
      }

      const stream = await this.transport.streamChat(body, streamOptions);
      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = chunk.usage;
        }
        const choice = chunk.choices?.[0];
        if (!choice) {
          continue;
        }
        if (typeof choice.delta?.content === "string") {
          collected += choice.delta.content;
        }
        if (typeof choice.delta?.refusal === "string") {
          refusal += choice.delta.refusal;
        }
        if (typeof choice.finish_reason === "string") {
          finishReason = choice.finish_reason;
        }
      }
      // SDK ≥6 can swallow an AbortError raised mid-body-read and end the
      // iterable normally, a partial (or even coincidentally valid) output
      // must never masquerade as a completed generation.
      if (req.signal?.aborted) {
        throw new APIUserAbortError();
      }
      // A mark-effort-supported discovery: the request carried the knob and
      // the provider accepted it.
      if (
        this.effortSupported === null &&
        body.reasoning_effort !== undefined
      ) {
        this.effortSupported = true;
      }
    } finally {
      clearInterval(heartbeat);
    }
    log(`done in ${elapsed()} — ${collected.length} chars`);
    // The chunk shape is DECLARED over unvalidated provider JSON, a
    // self-hosted "compatible" server can emit anything here. Guard like
    // the delta reads above; a malformed usage object reports nothing
    // rather than NaN.
    if (
      usage &&
      typeof usage.prompt_tokens === "number" &&
      typeof usage.completion_tokens === "number"
    ) {
      const cached = usage.prompt_tokens_details?.cached_tokens;
      const reasoning = usage.completion_tokens_details?.reasoning_tokens;
      const report: TokenUsage = {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        cacheReadTokens: typeof cached === "number" ? cached : 0,
      };

      // Absent ≠ 0: only a numeric report enters the field.
      if (typeof reasoning === "number") {
        report.reasoningTokens = reasoning;
      }

      req.onUsage?.(report);
    }
    return {
      raw: collected,
      refusal: refusal === "" ? null : refusal,
      finishReason,
    };
  }
}

/**
 * Discover a missing optional parameter from parameter-naming provider 400 text, never model output.
 * Also inspect OpenRouter metadata.raw for wrapped rejections so a broken advertised knob
 * degrades instead of failing as permanent config.
 */
function isParameterRejection(error: unknown, marker: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if (Reflect.get(error, "status") !== 400) {
    return false;
  }
  const message = Reflect.get(error, "message");
  if (typeof message === "string" && message.includes(marker)) {
    return true;
  }
  const extracted = extractedProviderRaw(error);
  return extracted !== null && extracted.raw.includes(marker);
}

/**
 * Map recognized SDK failures onto the shared taxonomy, same grid as the
 * Anthropic adapter: 401/403 → auth; 400/404 → config;
 * 408/429/5xx + connection-level → provider-transient. Aborts and
 * unrecognized rejections return UNCHANGED.
 */
export function classifyOpenAiError(error: unknown): unknown {
  if (error instanceof APIUserAbortError) {
    return error;
  }
  if (error instanceof APIConnectionError) {
    return new GeneratorError(
      GeneratorErrorKinds.PROVIDER_TRANSIENT,
      redactProviderMessage(error.message),
      // Sanitized like the HTTP branches: the wrapped fetch rejection can
      // carry credential-bearing URLs/headers in its nested chain.
      { cause: sanitizeProviderCause(error) },
    );
  }
  // Body-read connection failures surface from fetch as a statusless
  // TypeError CARRYING A CAUSE (undici attaches the socket error), those
  // are transient. A causeless TypeError is a programmer error and must
  // not be retried into a storm.
  if (error instanceof TypeError && Reflect.get(error, "cause") !== undefined) {
    return new GeneratorError(
      GeneratorErrorKinds.PROVIDER_TRANSIENT,
      "network failure while reading the provider response",
      { cause: sanitizeProviderCause(error) },
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
    if (error instanceof OpenAIError) {
      return new GeneratorError(
        GeneratorErrorKinds.OPAQUE,
        redactProviderMessage(error.message),
        { cause: sanitizeProviderCause(error) },
      );
    }
    return error;
  }
  // Provider error text may echo credentials or request contents. Redact before logging.
  // Attach only a sanitized cause summary; recursive cause logging would expose raw SDK fields.
  const detail = providerErrorDetail(error);
  const message = redactProviderMessage(
    (error instanceof Error
      ? error.message
      : `transport error (status ${status})`) + detail,
  );
  const cause = sanitizeProviderCause(error, status);
  if (status === 401 || status === 403) {
    return new GeneratorError(GeneratorErrorKinds.AUTH, message, { cause });
  }
  if (status === 400 || status === 404) {
    return new GeneratorError(GeneratorErrorKinds.CONFIG, message, { cause });
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new GeneratorError(GeneratorErrorKinds.PROVIDER_TRANSIENT, message, {
      cause,
    });
  }
  return new GeneratorError(GeneratorErrorKinds.OPAQUE, message, { cause });
}

/**
 * OpenRouter may hide its real provider rejection in APIError.error.metadata.raw.
 * Optional fields degrade to empty text. All extracted provider text is untrusted
 * and may enter messages only through redactProviderMessage.
 */
function extractedProviderRaw(
  error: unknown,
): { raw: string; providerName: string | null } | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const body = Reflect.get(error, "error");
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const metadata = Reflect.get(body, "metadata");
  if (typeof metadata !== "object" || metadata === null) {
    return null;
  }
  const raw = Reflect.get(metadata, "raw");
  if (typeof raw !== "string" || raw === "") {
    return null;
  }
  const provider = Reflect.get(metadata, "provider_name");
  return {
    raw,
    providerName:
      typeof provider === "string" && provider !== "" ? provider : null,
  };
}

/** `, <provider>: <raw>` suffix for classified messages, or "". */
function providerErrorDetail(error: unknown): string {
  const extracted = extractedProviderRaw(error);
  if (extracted === null) {
    return "";
  }
  return ` — ${extracted.providerName ?? "upstream provider"}: ${extracted.raw}`;
}
