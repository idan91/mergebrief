import { GRAMMAR_GZIP_BYTES } from "./consts";
import type { FileGrammarRows, GrammarBudgetPlan, GrammarName } from "./types";

/**
 * Admits grammars in descending row order, skipping one whose closure the
 * remaining budget cannot pay so a smaller grammar behind it still loads.
 * Two admitted grammars sharing a module are charged for it twice, which
 * under-fills the budget rather than overspending it; the bundler's real
 * dedupe is not knowable here.
 */
export function planGrammarBudget(
  files: FileGrammarRows[],
  budgetBytes: number,
): GrammarBudgetPlan {
  const admitted: GrammarName[] = [];
  let spentBytes = 0;

  for (const grammar of rankGrammars(files)) {
    const next = spentBytes + GRAMMAR_GZIP_BYTES[grammar];
    if (next > budgetBytes) continue;

    admitted.push(grammar);
    spentBytes = next;
  }

  return { admitted, spentBytes };
}

function rankGrammars(files: FileGrammarRows[]): GrammarName[] {
  const rowsByGrammar = new Map<GrammarName, number>();

  for (const file of files) {
    const rows = rowsByGrammar.get(file.grammar) ?? 0;
    rowsByGrammar.set(file.grammar, rows + file.rowCount);
  }

  const ranked = [...rowsByGrammar.entries()].filter(([, rows]) => rows > 0);
  ranked.sort(compareByRowsThenName);

  return ranked.map(([grammar]) => grammar);
}

function compareByRowsThenName(
  left: [GrammarName, number],
  right: [GrammarName, number],
): number {
  if (left[1] !== right[1]) return right[1] - left[1];

  return left[0].localeCompare(right[0]);
}
