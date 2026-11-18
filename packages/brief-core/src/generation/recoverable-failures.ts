import {
  GeneratorError,
  GeneratorErrorKinds,
  type GeneratorErrorKind,
} from "generators";

/**
 * Failures of a late call's own answer or provider, which cost the brief only
 * the section that call writes. Aborts, run signals and the worker's secret
 * guard are not `GeneratorError`s, so they still end the run.
 */
const RECOVERABLE_FAILURES: ReadonlySet<GeneratorErrorKind> = new Set([
  GeneratorErrorKinds.SCHEMA_FLOOR,
  GeneratorErrorKinds.REFUSAL,
  GeneratorErrorKinds.OUTPUT_CUT,
  GeneratorErrorKinds.PROVIDER_TRANSIENT,
  GeneratorErrorKinds.TIMEOUT,
  GeneratorErrorKinds.OPAQUE,
]);

export function isRecoverableFailure(error: unknown): error is GeneratorError {
  const isGeneratorError = error instanceof GeneratorError;
  return isGeneratorError && RECOVERABLE_FAILURES.has(error.kind);
}
