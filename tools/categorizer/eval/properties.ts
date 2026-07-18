import type { Brief } from "../src/types";
import type { PropertyScore } from "./verdicts";

/**
 * One mechanical predicate over a parsed Brief (BRIEF-59 decision 2).
 * Properties anchor on run-stable facts — group counts, file→group
 * bindings, order relations, attribute firings — never on chunk
 * boundaries, which are themselves model output.
 */
export interface EvalProperty {
  /** Stable id — the baseline join key. Kebab-case, unique per case. */
  id: string;
  /** Human line for the report: what the property asserts. */
  description: string;
  check(brief: Brief): boolean;
}

export interface ScoredRuns {
  /** Property id → pass count over the scored runs. */
  scores: Map<string, PropertyScore>;
  /** Predicate-failure notes (a throwing property = fail + note). */
  notes: string[];
}

/**
 * Score every property against every run's Brief. A throwing predicate is
 * a FAIL with a note — visible, never a crash (one bad property must not
 * cost a 25-generation invocation) and never a silent pass.
 */
export function scoreRuns(
  properties: readonly EvalProperty[],
  runs: readonly Brief[],
): ScoredRuns {
  const ids = new Set<string>();
  for (const property of properties) {
    if (ids.has(property.id)) {
      throw new Error(`duplicate property id "${property.id}"`);
    }
    ids.add(property.id);
  }
  const scores = new Map<string, PropertyScore>();
  const notes: string[] = [];
  for (const property of properties) {
    let passes = 0;
    for (const [runIndex, brief] of runs.entries()) {
      try {
        if (property.check(brief)) passes += 1;
      } catch (error) {
        notes.push(
          `property "${property.id}" threw on run ${runIndex + 1}: ${
            error instanceof Error ? error.message : String(error)
          } (counted as fail)`,
        );
      }
    }
    scores.set(property.id, { passes, runs: runs.length });
  }
  return { scores, notes };
}
