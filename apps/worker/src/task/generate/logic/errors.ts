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
import { GenerationFailureCodes } from "types/generations";
import { HttpStatuses } from "types/http";
import type { Result } from "types/utils";
import { PermanentJobError, TransientJobError } from "../../failure";
import {
  HTTP_STATUS_NOT_ACCEPTABLE,
  HTTP_STATUS_REQUEST_TIMEOUT,
  HTTP_STATUS_SERVER_ERROR_FLOOR,
  HTTP_STATUS_TOO_MANY_REQUESTS,
} from "../consts";
import {
  GeneratorCallOutcomes,
  type GenerateTaskDeps,
  type GeneratorCallOptions,
  type GeneratorCallOutcome,
} from "../types";
import { isRunSignal } from "./run-signals";

export function isNotAcceptable(error: GitHubCallFailure): boolean {
  return "status" in error && error.status === HTTP_STATUS_NOT_ACCEPTABLE;
}

/** A 406, or a checked diff GitHub served short: no retry reads it whole. */
export function isDiffTooLarge(error: GitHubCallFailure): boolean {
  return (
    isNotAcceptable(error) || error.code === GitHubApiErrorCodes.DIFF_INCOMPLETE
  );
}

/** GitHub's 422 on a diff it did not render in time. */
export function isRenderTimedOut(error: GitHubCallFailure): boolean {
  return (
    "status" in error && error.status === HttpStatuses.UNPROCESSABLE_CONTENT
  );
}

/** A span diff GitHub would not render whole: past its size, or its render timeout. */
export function isSpanUnrendered(error: GitHubCallFailure): boolean {
  const isUnrendered = isDiffTooLarge(error) || isRenderTimedOut(error);
  return isUnrendered;
}

/** An unreadable credential is permanent: a retry reads the same token. */
export function isPermanentGitHubError(error: GitHubCallFailure): boolean {
  const isPermanent =
    error.code === GitHubApiErrorCodes.NOT_FOUND ||
    error.code === GitHubApiErrorCodes.UNAUTHORIZED ||
    error.code === GitHubApiErrorCodes.FORBIDDEN ||
    error.code === CredentialFailureCodes.CREDENTIAL_UNREADABLE ||
    isDiffTooLarge(error);
  return isPermanent;
}

/** Content GitHub will never serve as file text: a symlink, directory or submodule, or bytes that are not UTF-8. */
const REPO_FILE_REFUSALS: ReadonlySet<string> = new Set([
  GitHubApiErrorCodes.NOT_A_BLOB,
  GitHubApiErrorCodes.NOT_TEXT,
]);

/** A file read no retry answers differently: a permanent failure, or content that is not file text. */
export function isRepoFileRefusedForGood(error: GitHubCallFailure): boolean {
  return isPermanentGitHubError(error) || REPO_FILE_REFUSALS.has(error.code);
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
      failure: isDiffTooLarge(result.error)
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

/** The call stopped at its output cap; `runGenerator` keeps that throw as `cause`. */
export function isOutputCut(error: unknown): boolean {
  const unwrapped =
    error instanceof PermanentJobError && error.cause !== undefined
      ? error.cause
      : error;
  const cut =
    unwrapped instanceof GeneratorError &&
    unwrapped.kind === GeneratorErrorKinds.OUTPUT_CUT;
  return cut;
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

/** A failure no retry can clear: a stamped permanent throw, or a persistence refusal. */
export function isPermanentFailure(error: unknown): boolean {
  return (
    error instanceof PermanentJobError ||
    error instanceof ScopeViolationError ||
    error instanceof InvalidArtifactBodyError
  );
}

/**
 * A throw the run already classified, or chose: a run signal, a stamped
 * failure, a persistence refusal. It crosses the generator boundary and the
 * multi-call hooks as it is.
 */
export function isClassifiedThrow(error: unknown): boolean {
  return (
    isRunSignal(error) ||
    isPermanentFailure(error) ||
    error instanceof TransientJobError
  );
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
  options: GeneratorCallOptions = {},
): Promise<T> {
  const startedAt = Date.now();
  const emit = (outcome: GeneratorCallOutcome): void => {
    log.info("generator call finished", {
      evt: "generation.complete",
      kind,
      outcome,
      durationMs: Date.now() - startedAt,
    });
  };
  try {
    const value = await call();
    emit(GeneratorCallOutcomes.SUCCEEDED);
    return value;
  } catch (error) {
    // A step the call drives, not the generator, threw a classified error or
    // a run signal: it keeps its class and is no generator outcome.
    if (isClassifiedThrow(error)) {
      throw error;
    }
    const skipped = options.outputCutIsSkip === true && isOutputCut(error);
    emit(
      skipped ? GeneratorCallOutcomes.SKIPPED : GeneratorCallOutcomes.FAILED,
    );
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
