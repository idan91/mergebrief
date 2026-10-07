import type { Brief } from "brief-core/types";
import type { PropertyScore } from "./verdicts";

/**
 * One mechanical predicate over a parsed Brief. Properties anchor on
 * run-stable facts, group counts, file→group bindings, order relations,
 * attribute firings, never on chunk boundaries, which are model output.
 */
export interface EvalProperty {
  /** Stable id, the baseline join key. Kebab-case, unique per case. */
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
 * a FAIL with a note, visible, never a crash (one bad property must not
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
    const scored = scoreProperty(property, runs);
    notes.push(...scored.notes);
    scores.set(property.id, { passes: scored.passes, runs: runs.length });
  }

  return { scores, notes };
}

/** One property over every run: a throwing check is a fail plus a note. */
function scoreProperty(
  property: EvalProperty,
  runs: readonly Brief[],
): { passes: number; notes: string[] } {
  let passes = 0;
  const notes: string[] = [];

  for (const [runIndex, brief] of runs.entries()) {
    try {
      if (property.check(brief)) {
        passes += 1;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      notes.push(
        `property "${property.id}" threw on run ${runIndex + 1}: ${reason} (counted as fail)`,
      );
    }
  }

  return { passes, notes };
}
