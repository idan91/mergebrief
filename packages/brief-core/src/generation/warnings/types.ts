import { GeneratorWarningKinds, type GeneratorWarning } from "generators";
import type { ValueOf } from "types/utils";

export const GenerationWarningKinds = {
  ...GeneratorWarningKinds,
  VALIDATION: "validation",
  REPO_INSTRUCTIONS_OMITTED: "repo-instructions-omitted",
} as const;
/** @public */
export type GenerationWarningKind = ValueOf<typeof GenerationWarningKinds>;

/** A warn-only check over the generated output that found issues. */
export interface ValidationWarning {
  kind: typeof GenerationWarningKinds.VALIDATION;
  check: string;
  issues: readonly string[];
}

export interface RepoInstructionsOmittedWarning {
  kind: typeof GenerationWarningKinds.REPO_INSTRUCTIONS_OMITTED;
  message: string;
}

export type GenerationWarning =
  | GeneratorWarning
  | ValidationWarning
  | RepoInstructionsOmittedWarning;

export interface WarningCollector {
  /** Records a warning the generator already logged. */
  recordGeneratorWarning: (warning: GeneratorWarning) => void;
  report: (warning: RepoInstructionsOmittedWarning) => void;
  /** Reports nothing for an empty issue list. */
  reportIssues: (check: string, issues: readonly string[]) => void;
  listWarnings: () => GenerationWarning[];
}
