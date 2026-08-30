// Failure classification for the generate task: a thrown error becomes the
// typed `GenerationFailure` the projection stores. Order is contractual —
// an explicit throw-site stamp wins, then the generator's own taxonomy,
// then transport probes, then `unknown{detail}`. A probe never overrides a
// stamp.
import { APIConnectionError } from "@anthropic-ai/sdk";
import { GeneratorError, GeneratorErrorKinds } from "generators";
import { GenerationFailureCodes, type GenerationFailure } from "persistence";

interface JobErrorOptions {
  readonly cause?: unknown;
  readonly failure?: GenerationFailure;
}

/**
 * A failure that retrying cannot fix (missing PR, unrenderable diff,
 * deterministic generation failure). Marked `failed` on the projection but
 * NOT rethrown to graphile — a retry would only burn spend.
 */
export class PermanentJobError extends Error {
  readonly failure?: GenerationFailure;

  constructor(message: string, options?: JobErrorOptions) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "PermanentJobError";
    if (options?.failure !== undefined) {
      this.failure = options.failure;
    }
  }
}

/**
 * The transient sibling: rethrown so graphile owns retry/backoff, while the
 * stamp still reaches the projection through `classifyFailure`.
 */
export class TransientJobError extends Error {
  readonly failure?: GenerationFailure;

  constructor(message: string, options?: JobErrorOptions) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "TransientJobError";
    if (options?.failure !== undefined) {
      this.failure = options.failure;
    }
  }
}

function transientFailure(cause: unknown): GenerationFailure {
  const status =
    typeof cause === "object" && cause !== null
      ? Reflect.get(cause, "status")
      : undefined;
  if (status === 429) {
    return { code: GenerationFailureCodes.PROVIDER_RATE_LIMIT };
  }
  if (status === 408) {
    return { code: GenerationFailureCodes.PROVIDER_TIMEOUT };
  }
  return { code: GenerationFailureCodes.PROVIDER_UNAVAILABLE };
}

function getErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyFailure(error: unknown): GenerationFailure {
  const stamped =
    error instanceof PermanentJobError || error instanceof TransientJobError;
  if (stamped && error.failure !== undefined) {
    return error.failure;
  }
  // The generator boundary wraps its original throw as `cause` — classify
  // the real failure, not the wrapper's message.
  const unwrapped = stamped && error.cause !== undefined ? error.cause : error;

  if (unwrapped instanceof GeneratorError) {
    switch (unwrapped.kind) {
      case GeneratorErrorKinds.AUTH:
        return { code: GenerationFailureCodes.PROVIDER_AUTH };
      case GeneratorErrorKinds.PROVIDER_TRANSIENT:
        // Adapters fold 408/429/5xx into one kind but keep the SDK error as
        // cause — recover the rate-limit/timeout distinction from it.
        return transientFailure(unwrapped.cause);
      case GeneratorErrorKinds.TIMEOUT:
        return { code: GenerationFailureCodes.PROVIDER_TIMEOUT };
      case GeneratorErrorKinds.SCHEMA_FLOOR:
        return { code: GenerationFailureCodes.OUTPUT_INVALID };
      case GeneratorErrorKinds.REFUSAL:
        return { code: GenerationFailureCodes.PROVIDER_REFUSAL };
      case GeneratorErrorKinds.CONFIG:
      case GeneratorErrorKinds.CLI_MISSING:
        // Config absorbs cli-missing: both are operator-fixable setup.
        return {
          code: GenerationFailureCodes.GENERATION_CONFIG,
          params: { detail: unwrapped.message },
        };
      case GeneratorErrorKinds.OPAQUE:
        return {
          code: GenerationFailureCodes.UNKNOWN,
          params: { detail: unwrapped.message },
        };
    }
  }
  if (unwrapped instanceof APIConnectionError) {
    return { code: GenerationFailureCodes.PROVIDER_UNAVAILABLE };
  }
  const status =
    typeof unwrapped === "object" && unwrapped !== null
      ? Reflect.get(unwrapped, "status")
      : undefined;
  if (typeof status === "number") {
    if (status === 429) {
      return { code: GenerationFailureCodes.PROVIDER_RATE_LIMIT };
    }
    if (status === 408) {
      return { code: GenerationFailureCodes.PROVIDER_TIMEOUT };
    }
    if (status === 401 || status === 403) {
      return { code: GenerationFailureCodes.PROVIDER_AUTH };
    }
    if (status >= 500) {
      return { code: GenerationFailureCodes.PROVIDER_UNAVAILABLE };
    }
  }
  return {
    code: GenerationFailureCodes.UNKNOWN,
    params: { detail: getErrorDetail(unwrapped) },
  };
}
