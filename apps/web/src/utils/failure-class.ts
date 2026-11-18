import {
  GenerationFailureClassByCode,
  GenerationFailureClasses,
  GenerationStatuses,
  type GenerationFailureClass,
  type GenerationFailureCode,
  type GenerationStatus,
} from "types";

import type { UnknownValue } from "./open-enum/types";

/** A code this bundle does not know is the server's to judge, so it reads as transient. */
export function readFailureClass(
  errorCode: GenerationFailureCode | undefined,
): GenerationFailureClass {
  if (errorCode === undefined) {
    return GenerationFailureClasses.TRANSIENT;
  }
  return GenerationFailureClassByCode[errorCode];
}

/** The latest generation as a rerun offer reads it. */
export interface RerunFacts {
  readonly status: GenerationStatus | UnknownValue;
  readonly errorCode?: GenerationFailureCode | undefined;
}

/** The head failed in a way a repeat run of the same head fails again. */
export function isRerunHopeless(generation: RerunFacts | undefined): boolean {
  if (generation?.status !== GenerationStatuses.FAILED) {
    return false;
  }
  const failureClass = readFailureClass(generation.errorCode);
  return failureClass === GenerationFailureClasses.CANNOT_HELP;
}
