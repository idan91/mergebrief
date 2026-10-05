import { APIConnectionError } from "@anthropic-ai/sdk";
import { GeneratorError, GeneratorErrorKinds } from "generators";
import { GitHubApiErrorCodes } from "github";
import type { LogFields, Logger } from "logging";
import type { GenerationKind } from "persistence";
import {
  GenerationFailureCodes,
  GenerationStatuses,
  type GenerationStatus,
} from "types/generations";
import type { Result } from "types/utils";
import { PermanentJobError, TransientJobError } from "../../failure";
import type { GitHubApiError } from "../../github-port";
import {
  HTTP_STATUS_NOT_ACCEPTABLE,
  HTTP_STATUS_REQUEST_TIMEOUT,
  HTTP_STATUS_SERVER_ERROR_FLOOR,
  HTTP_STATUS_TOO_MANY_REQUESTS,
} from "../consts";
import type { GenerateTaskDeps } from "../types";

export function isPermanentGitHubError(error: GitHubApiError): boolean {
  const isPermanent =
    error.code === GitHubApiErrorCodes.NOT_FOUND ||
    error.code === GitHubApiErrorCodes.UNAUTHORIZED ||
    error.code === GitHubApiErrorCodes.FORBIDDEN ||
    error.status === HTTP_STATUS_NOT_ACCEPTABLE;
  return isPermanent;
}

/** Unwrap a GitHub `Result`, converting failures into the right error class. */
export function throwOnGitHubFailure<T>(result: Result<T, GitHubApiError>): T {
  if (result.ok) {
    return result.value;
  }
  if (isPermanentGitHubError(result.error)) {
    throw new PermanentJobError(result.error.message, {
      failure:
        result.error.status === HTTP_STATUS_NOT_ACCEPTABLE
          ? { code: GenerationFailureCodes.DIFF_TOO_LARGE }
          : { code: GenerationFailureCodes.GITHUB_ACCESS },
    });
  }
  throw new TransientJobError(result.error.message, {
    failure: { code: GenerationFailureCodes.GITHUB_UNAVAILABLE },
  });
}

/**
 * Treat 429/5xx/408 and SDK APIConnectionError as transient. The latter has no status
 * and a plain Error name, so it needs instanceof. Retrying deterministic schema/refusal
 * failures would spend again without a recovery signal.
 */
function isTransientGenerationError(error: unknown): boolean {
  // Adapters classify their own transport failures: provider-transient is the
  // only kind a retry can help.
  if (error instanceof GeneratorError) {
    return error.kind === GeneratorErrorKinds.PROVIDER_TRANSIENT;
  }
  if (error instanceof APIConnectionError) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const status = Reflect.get(error, "status");
  if (typeof status === "number") {
    const isRetryableStatus =
      status === HTTP_STATUS_REQUEST_TIMEOUT ||
      status === HTTP_STATUS_TOO_MANY_REQUESTS ||
      status >= HTTP_STATUS_SERVER_ERROR_FLOOR;
    return isRetryableStatus;
  }
  return false;
}

/**
 * Emitted when the failure is a provider call gone wrong, a `GeneratorError`,
 * the SDK's connection error, or any error carrying a numeric HTTP status.
 * Message-only posture: fields carry classification, never the raw error
 * object (cause chains may hold request contents).
 */
export function emitProviderError(
  log: Logger,
  deps: GenerateTaskDeps,
  thrown: unknown,
): void {
  // A permanent classification wraps the original throw, read through it.
  const error =
    thrown instanceof PermanentJobError && thrown.cause !== undefined
      ? thrown.cause
      : thrown;
  const status =
    typeof error === "object" && error !== null
      ? Reflect.get(error, "status")
      : undefined;
  const isProviderFailure =
    error instanceof GeneratorError ||
    error instanceof APIConnectionError ||
    typeof status === "number";
  if (!isProviderFailure) {
    return;
  }
  // origin() is pure metadata; any effort yields the same provider name.
  const provider = deps.generator.origin(deps.effort ?? "medium").provider;
  const fields: LogFields = { evt: "provider.error", provider };

  if (typeof status === "number") fields["status"] = status;
  if (error instanceof GeneratorError) fields["kind"] = error.kind;

  log.error(error instanceof Error ? error.message : String(error), fields);
}

/**
 * Run a generator call, classifying its throw as transient or permanent, and
 * time it. Nothing downstream records how long a model call took: the
 * generation row's `updated_at` is the last write of any phase, so a finished
 * brief and a timeout are indistinguishable in duration after the fact.
 */
export async function runGenerator<T>(
  call: () => Promise<T>,
  log: Logger,
  kind: GenerationKind,
): Promise<T> {
  const startedAt = Date.now();
  const emit = (outcome: GenerationStatus): void => {
    log.info("generator call finished", {
      evt: "generation.complete",
      kind,
      outcome,
      durationMs: Date.now() - startedAt,
    });
  };
  try {
    const value = await call();
    emit(GenerationStatuses.SUCCEEDED);
    return value;
  } catch (error) {
    emit(GenerationStatuses.FAILED);
    if (isTransientGenerationError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    // Preserve the original as `cause`: the provider.error event reads the
    // classification (GeneratorError kind / HTTP status) off it.
    throw new PermanentJobError(
      error instanceof Error ? error.message : String(error),
      {
        cause: error,
      },
    );
  }
}
