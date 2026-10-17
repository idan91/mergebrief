import { GeneratorError, GeneratorErrorKinds } from "generators";
import {
  CredentialFailureCodes,
  GitHubApiErrorCodes,
  type GitHubCallFailure,
} from "github";
import type { LogFields, Logger } from "logging";
import {
  InvalidArtifactBodyError,
  ScopeViolationError,
  type GenerationKind,
} from "persistence";
import {
  GenerationFailureCodes,
  GenerationStatuses,
  type GenerationStatus,
} from "types/generations";
import type { Result } from "types/utils";
import { PermanentJobError, TransientJobError } from "../../failure";
import {
  HTTP_STATUS_NOT_ACCEPTABLE,
  HTTP_STATUS_REQUEST_TIMEOUT,
  HTTP_STATUS_SERVER_ERROR_FLOOR,
  HTTP_STATUS_TOO_MANY_REQUESTS,
} from "../consts";
import type { GenerateTaskDeps } from "../types";

function isNotAcceptable(error: GitHubCallFailure): boolean {
  return "status" in error && error.status === HTTP_STATUS_NOT_ACCEPTABLE;
}

/** An unreadable credential is permanent: a retry reads the same token. */
export function isPermanentGitHubError(error: GitHubCallFailure): boolean {
  const isPermanent =
    error.code === GitHubApiErrorCodes.NOT_FOUND ||
    error.code === GitHubApiErrorCodes.UNAUTHORIZED ||
    error.code === GitHubApiErrorCodes.FORBIDDEN ||
    error.code === CredentialFailureCodes.CREDENTIAL_UNREADABLE ||
    isNotAcceptable(error);
  return isPermanent;
}

/** Unwrap a GitHub `Result`, converting failures into the right error class. */
export function throwOnGitHubFailure<T>(
  result: Result<T, GitHubCallFailure>,
): T {
  if (result.ok) {
    return result.value;
  }
  if (isPermanentGitHubError(result.error)) {
    throw new PermanentJobError(result.error.message, {
      failure: isNotAcceptable(result.error)
        ? { code: GenerationFailureCodes.DIFF_TOO_LARGE }
        : { code: GenerationFailureCodes.GITHUB_ACCESS },
    });
  }
  throw new TransientJobError(result.error.message, {
    failure: { code: GenerationFailureCodes.GITHUB_UNAVAILABLE },
  });
}

/**
 * Adapters wrap their SDK's transport failures, statusless connection errors
 * included, as `GeneratorError`; provider-transient is the only kind a retry
 * can help. A non-generator throw is transient on 408/429/5xx. Retrying
 * deterministic schema/refusal failures would spend again without a signal.
 */
function isTransientGenerationError(error: unknown): boolean {
  if (error instanceof GeneratorError) {
    return error.kind === GeneratorErrorKinds.PROVIDER_TRANSIENT;
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
 * Emitted when the failure is a provider call gone wrong, a `GeneratorError`
 * or any error carrying a numeric HTTP status.
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
    error instanceof GeneratorError || typeof status === "number";
  if (!isProviderFailure) {
    return;
  }
  // origin() is pure metadata; any effort yields the same provider name.
  const provider = deps.generator.origin(deps.effort ?? "medium").provider;
  const fields: LogFields = { evt: "provider.error", provider };

  if (typeof status === "number") {
    fields["status"] = status;
  }
  if (error instanceof GeneratorError) {
    fields["kind"] = error.kind;
  }

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
    // A step the call drives, not the generator, threw an already classified
    // error or a persistence refusal: it keeps its class and is no generator
    // outcome.
    const keepsItsClass =
      error instanceof PermanentJobError ||
      error instanceof TransientJobError ||
      error instanceof ScopeViolationError ||
      error instanceof InvalidArtifactBodyError;
    if (keepsItsClass) {
      throw error;
    }
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
