import type { Logger } from "generators";
import {
  GenerationWarningKinds,
  type GenerationWarning,
  type WarningCollector,
} from "./types";

function formatGenerationWarning(warning: GenerationWarning): string {
  if (warning.kind === GenerationWarningKinds.VALIDATION) {
    return `⚠ ${warning.check} issues: ${warning.issues.join("; ")}`;
  }
  return warning.message;
}

/** The stored `generationWarnings` lines, one per warning, in report order. */
export function formatGenerationWarnings(
  warnings: readonly GenerationWarning[],
): string[] {
  return warnings.map(formatGenerationWarning);
}

/**
 * Collects one generation's typed warnings. A reported warning is also
 * logged; a generator warning is only recorded, since the generator logs its
 * own line.
 */
export function createWarningCollector(log: Logger): WarningCollector {
  const warnings: GenerationWarning[] = [];

  function report(warning: GenerationWarning): void {
    log(formatGenerationWarning(warning));
    warnings.push(warning);
  }

  return {
    recordGeneratorWarning: (warning) => {
      warnings.push(warning);
    },
    report,
    reportIssues: (check, issues) => {
      if (issues.length === 0) {
        return;
      }
      report({
        kind: GenerationWarningKinds.VALIDATION,
        check,
        issues: [...issues],
      });
    },
    listWarnings: () => [...warnings],
  };
}
