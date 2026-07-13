import { APIConnectionError, APIUserAbortError, OpenAIError } from "openai";
import type { z } from "zod/v4";
import { GeneratorError, GeneratorErrorKind } from "./errors";
import { runWithSchemaFloor, schemaFeedbackMessage } from "./floor";
import { redactSecrets } from "./harness";
import type { GenerateRequest, Generator, Logger } from "./generator";
import { enumPreservingJsonSchema } from "./outputFormat";
import type { Effort, Generation } from "./vocabulary";

/**
 * Shared core for OpenAI-compatible chat-completions providers (ADR 0030):
 * the openai adapter and the openrouter adapter (PR 8) differ in preflight,
 * headers and provenance — the streaming request, schema floor wiring, and
 * error taxonomy live here once.
 *
 * Invariants:
 * 1. The schema floor is hard — strict `json_schema` response_format is the
 *    native enforcement bonus layer; every answer runs `runWithSchemaFloor`.
 * 2. Abort rejections propagate UNTOUCHED (ADR 0006 #6) — the SDK's
 *    APIUserAbortError is recognized and passed through unchanged.
 * 3. Provenance is honest: `reasoning_effort` support is discovered at run
 *    time (a 400 naming the parameter → retry once without it and cache
 *    "no knob" for the instance's lifetime); once discovered absent, the
 *    stamp records `effort: null` (ADR 0013 #5 capability gap).
 * 4. No secrets in errors: messages carry provider-authored status text and
 *    parameter names, never keys (the SDK redacts auth headers itself; we
 *    never interpolate request bodies or headers).
 */

/** One streamed chunk — the narrow shape the core reads. */
export interface OpenAiStreamChunk {
  choices?: {
    delta?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
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
}

/**
 * The transport seam: adapters wrap the official `openai` client (or a
 * fetch-fixture-backed one in tests) into this one streaming call.
 * Provider-specific body extensions (openrouter's `provider` routing block,
 * PR 8) are the WRAPPER's job — it spreads them before calling the SDK, so
 * the core stays provider-shape-agnostic.
 */
export interface OpenAiChatTransport {
  streamChat(
    body: OpenAiChatRequest,
    options: { signal?: AbortSignal },
  ): Promise<AsyncIterable<OpenAiStreamChunk>>;
}

export interface OpenAiCompatibleCoreOptions {
  transport: OpenAiChatTransport;
  /** Provenance provider token ("openai" | "openrouter"). */
  provider: string;
  model: string;
  failureDir: string;
  /**
   * Pre-seeded effort-knob knowledge (openrouter learns it from its
   * /models preflight — no discovery 400 needed). Omit for run-time
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

/** Documented finish reasons; anything else renders as unrecognized —
 * the field is provider output and must not carry arbitrary text. */
const KNOWN_FINISH_REASONS = new Set([
  "stop",
  "length",
  "content_filter",
  "tool_calls",
  "function_call",
]);

function renderFinishReason(reason: string | null): string {
  if (reason === null) return "none";
  return KNOWN_FINISH_REASONS.has(reason) ? reason : "(unrecognized)";
}

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
   * discovered. Discovered-absent surfaces in provenance as effort null.
   */
  private effortSupported: boolean | null;
  private readonly knobRejectionMarker: string;

  constructor(options: OpenAiCompatibleCoreOptions) {
    this.transport = options.transport;
    this.provider = options.provider;
    this.model = options.model;
    this.failureDir = options.failureDir;
    this.effortSupported = options.initialEffortSupported ?? null;
    this.knobRejectionMarker = options.knobRejectionMarker ?? "reasoning_effort";
  }

  provenance(effort: Effort): Generation {
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

    const baseMessages: OpenAiChatRequest["messages"] = [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ];

    return runWithSchemaFloor({
      schema: req.schema,
      label: req.label,
      ...(req.salvageFields ? { salvageFields: req.salvageFields } : {}),
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
        const outcome = await this.request(req, wireSchema, messages, log);
        if (outcome.refusal !== null) {
          throw new GeneratorError(
            GeneratorErrorKind.REFUSAL,
            `Model refused to produce the ${req.label}.`,
          );
        }
        if (outcome.finishReason !== "stop") {
          // Only "stop" is a completed generation. EOF without a terminal
          // finish_reason is a truncated response; "length" and
          // "content_filter" end AFTER partial output — content that
          // happens to parse must never pass the floor as complete.
          return {
            raw: outcome.raw,
            invalidReason: `Stream for ${req.label} ended with finish_reason=${renderFinishReason(outcome.finishReason)} (incomplete or filtered response).`,
            // Incomplete output must not become a completed generation via
            // enum salvage either — retry with the raw as feedback instead.
            salvageable: false,
          };
        }
        if (outcome.raw === "") {
          return {
            raw: "",
            invalidReason: `No output for ${req.label} (finish_reason=stop).`,
          };
        }
        return { raw: outcome.raw };
      },
    });
  }

  /** One streamed request; retries ONCE without reasoning_effort on a 400
   * that names the parameter (then remembers the knob is absent). */
  private async request<S extends z.ZodType>(
    req: GenerateRequest<S>,
    wireSchema: Record<string, unknown>,
    messages: OpenAiChatRequest["messages"],
    log: Logger,
  ): Promise<{ raw: string; refusal: string | null; finishReason: string | null }> {
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
      ...(this.effortSupported !== false
        ? { reasoning_effort: req.effort }
        : {}),
      stream: true,
    };

    try {
      return await this.consume(req, body, log);
    } catch (error) {
      // The retry decision follows THIS request's knob usage, not the
      // shared cache: two concurrent first requests can both send the knob
      // and both get the 400 — the second must still retry even though its
      // sibling already flipped the cache (setting it again is idempotent).
      if (
        body.reasoning_effort !== undefined &&
        isEffortKnobRejection(error, this.knobRejectionMarker)
      ) {
        // Discovery is INDEPENDENT of abort timing: the knob's absence is
        // now known either way (later calls must not resend it), and an
        // abort landing between the 400 and this catch is still an abort —
        // never a CONFIG error built from an internal discovery response.
        this.effortSupported = false;
        if (req.signal?.aborted) {
          throw new APIUserAbortError();
        }
        log(
          `warning: ${this.model} rejected reasoning_effort — retrying without it; provenance will record effort: null`,
        );
        const { reasoning_effort: _dropped, ...rest } = body;
        try {
          return await this.consume(req, rest, log);
        } catch (retryError) {
          // The retry needs its own classification boundary — a 401/429/
          // connection failure here must not escape unclassified.
          throw classifyOpenAiError(retryError);
        }
      }
      throw classifyOpenAiError(error);
    }
  }

  /** Drive one stream to completion with heartbeat progress logging. */
  private async consume<S extends z.ZodType>(
    req: GenerateRequest<S>,
    body: OpenAiChatRequest,
    log: Logger,
  ): Promise<{ raw: string; refusal: string | null; finishReason: string | null }> {
    const start = Date.now();
    const elapsed = (): string => `${((Date.now() - start) / 1000).toFixed(0)}s`;
    let collected = "";
    let refusal = "";
    let finishReason: string | null = null;
    log(`requesting ${req.label} from ${this.provider}…`);
    const heartbeat = setInterval(() => {
      const size = collected.length > 0 ? `, ${collected.length} chars` : "";
      log(`…writing ${req.label} (${elapsed()}${size})`);
    }, 5000);
    try {
      const stream = await this.transport.streamChat(
        body,
        req.signal ? { signal: req.signal } : {},
      );
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;
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
      // iterable normally — a partial (or even coincidentally valid) output
      // must never masquerade as a completed generation.
      if (req.signal?.aborted) {
        throw new APIUserAbortError();
      }
      // A mark-effort-supported discovery: the request carried the knob and
      // the provider accepted it.
      if (this.effortSupported === null && body.reasoning_effort !== undefined) {
        this.effortSupported = true;
      }
    } finally {
      clearInterval(heartbeat);
    }
    log(`done in ${elapsed()} — ${collected.length} chars`);
    return { raw: collected, refusal: refusal === "" ? null : refusal, finishReason };
  }
}

/** True for a 400 whose provider message names the effort knob's wire
 * parameter. The text is PROVIDER-authored status prose (never model
 * output) — sniffing it is the documented discovery mechanism. */
function isEffortKnobRejection(error: unknown, marker: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (Reflect.get(error, "status") !== 400) return false;
  const message = Reflect.get(error, "message");
  return typeof message === "string" && message.includes(marker);
}

/**
 * Map recognized SDK failures onto the shared taxonomy (decision 5), same
 * grid as the Anthropic adapter: 401/403 → auth; 400/404 → config;
 * 408/429/5xx + connection-level → provider-transient. Aborts and
 * unrecognized rejections return UNCHANGED.
 */
export function classifyOpenAiError(error: unknown): unknown {
  if (error instanceof APIUserAbortError) return error;
  if (error instanceof APIConnectionError) {
    return new GeneratorError(
      GeneratorErrorKind.PROVIDER_TRANSIENT,
      safeProviderMessage(error.message),
      // Sanitized like the HTTP branches: the wrapped fetch rejection can
      // carry credential-bearing URLs/headers in its nested chain.
      { cause: sanitizedStatuslessCause(error) },
    );
  }
  // Body-read connection failures surface from fetch as a statusless
  // TypeError CARRYING A CAUSE (undici attaches the socket error) — those
  // are transient. A causeless TypeError is a programmer error and must
  // not be retried into a storm.
  if (
    error instanceof TypeError &&
    Reflect.get(error, "cause") !== undefined
  ) {
    return new GeneratorError(
      GeneratorErrorKind.PROVIDER_TRANSIENT,
      "network failure while reading the provider response",
      { cause: sanitizedStatuslessCause(error) },
    );
  }
  if (typeof error !== "object" || error === null) return error;
  if (Reflect.get(error, "name") === "APIUserAbortError") return error;
  const status = Reflect.get(error, "status");
  if (typeof status !== "number") {
    if (error instanceof OpenAIError) {
      return new GeneratorError(
        GeneratorErrorKind.OPAQUE,
        safeProviderMessage(error.message),
        { cause: sanitizedStatuslessCause(error) },
      );
    }
    return error;
  }
  // Provider-authored message text can echo request contents (a compatible
  // server may quote headers back) — redact before it enters an error the
  // app will log. The cause is a SANITIZED summary, not the raw SDK error:
  // Node's console.error prints cause chains recursively, so a raw cause
  // (whose .message and parsed .error body are unredacted) would undo the
  // redaction at any full-object log sink downstream.
  const message = safeProviderMessage(
    error instanceof Error ? error.message : `transport error (status ${status})`,
  );
  const cause = sanitizedCause(error, status);
  if (status === 401 || status === 403) {
    return new GeneratorError(GeneratorErrorKind.AUTH, message, { cause });
  }
  if (status === 400 || status === 404) {
    return new GeneratorError(GeneratorErrorKind.CONFIG, message, { cause });
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new GeneratorError(GeneratorErrorKind.PROVIDER_TRANSIENT, message, {
      cause,
    });
  }
  return new GeneratorError(GeneratorErrorKind.OPAQUE, message, { cause });
}

/** Redact-then-bound provider message text before it enters app errors. */
function safeProviderMessage(message: string): string {
  return redactSecrets(message).slice(0, 300);
}

/** Status + redacted text only — the raw body is exactly what can leak. */
function sanitizedCause(error: unknown, status: number): Error {
  const name =
    error instanceof Error ? error.constructor.name : "TransportError";
  const message = error instanceof Error ? error.message : "";
  return new Error(`${name} (status ${status}): ${safeProviderMessage(message)}`);
}

/** Same, for statusless failures — the nested chain is dropped entirely. */
function sanitizedStatuslessCause(error: Error): Error {
  return new Error(
    `${error.constructor.name}: ${safeProviderMessage(error.message)}`,
  );
}
