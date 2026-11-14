import type { GenerateRequest } from "../contract/generator";
import { redactSecrets } from "../harness/redact";
import type { z } from "zod/v4";

/**
 * 800 not 300: Azure's strict-schema 400 puts the decisive detail (which
 * property broke the rule) past the 300-char mark.
 */
const PROVIDER_MESSAGE_MAX_CHARS = 800;

/** Every SDK client's log level, whatever its env asks: at `debug` an SDK prints request bodies to the console. */
export const SDK_LOG_LEVEL = "warn";

/** Provider message text as it may enter an app error: redacted, then bounded. */
export function redactProviderMessage(message: string): string {
  return redactSecrets(message).slice(0, PROVIDER_MESSAGE_MAX_CHARS);
}

/** An SDK error's class, redacted message and status, which the worker reads to tell a rate limit from a timeout. */
export function sanitizeProviderCause(error: unknown, status?: number): Error {
  const name =
    error instanceof Error ? error.constructor.name : "TransportError";
  const message =
    error instanceof Error ? redactProviderMessage(error.message) : "";
  if (status === undefined) {
    return new Error(`${name}: ${message}`);
  }

  const cause = new Error(`${name} (status ${status}): ${message}`);
  return Object.assign(cause, { status });
}

/** The user text for an adapter without content blocks: the shared prefix, a blank line, then the request's own text. */
export function joinUserText<S extends z.ZodType>(
  req: Pick<GenerateRequest<S>, "user" | "userPrefix">,
): string {
  if (req.userPrefix === undefined) {
    return req.user;
  }
  return `${req.userPrefix}\n\n${req.user}`;
}

/** Every current Claude model writes up to 128K output tokens; Haiku 4.5 and the 4.5 generation stop at 64K. */
const WIDE_OUTPUT_CLAUDE_MODEL =
  /claude-(?:fable|mythos|opus|sonnet|haiku)-(?:[5-9]|4-[6-9])(?!\d)/;
const WIDE_OUTPUT_MAX_TOKENS = 128_000;
/** The cap the anthropic adapter sends a request with none, and the ceiling of a model this table does not know. */
export const CLAUDE_OUTPUT_MAX_TOKENS = 64_000;

/**
 * The most output tokens a request to a Claude model id may ask for. An id
 * the table does not know gets 64K, which every Claude model still served
 * accepts; a provider prefix (`anthropic.`, `us.anthropic.`) is tolerated.
 */
export function readClaudeOutputCeiling(model: string): number {
  return WIDE_OUTPUT_CLAUDE_MODEL.test(model)
    ? WIDE_OUTPUT_MAX_TOKENS
    : CLAUDE_OUTPUT_MAX_TOKENS;
}
