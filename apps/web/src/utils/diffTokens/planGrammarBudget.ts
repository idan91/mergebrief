import { GRAMMAR_MODULE_GZIP_BYTES, GRAMMAR_SIBLING_MODULES } from "./consts";
import type {
  FileGrammarRows,
  GrammarBudgetPlan,
  GrammarModuleName,
  GrammarName,
} from "./types";

/**
 * Admits grammars in descending row order, skipping one whose unpaid modules
 * the remaining budget cannot pay so a smaller grammar behind it still loads.
 * A module two admitted grammars share is charged once, as the bundler ships
 * it once.
 */
export function planGrammarBudget(
  files: FileGrammarRows[],
  budgetBytes: number,
): GrammarBudgetPlan {
  const admitted: GrammarName[] = [];
  const paidModules = new Set<GrammarModuleName>();
  let spentBytes = 0;

  for (const grammar of rankGrammars(files)) {
    const unpaidModules = listUnpaidModules(grammar, paidModules);
    const next = spentBytes + sumModuleBytes(unpaidModules);
    if (next > budgetBytes) {
      continue;
    }

    admitted.push(grammar);
    spentBytes = next;
    for (const unpaid of unpaidModules) {
      paidModules.add(unpaid);
    }
  }

  return { admitted, spentBytes };
}

function listUnpaidModules(
  grammar: GrammarName,
  paidModules: ReadonlySet<GrammarModuleName>,
): GrammarModuleName[] {
  const siblings = GRAMMAR_SIBLING_MODULES[grammar] ?? [];
  const closure: GrammarModuleName[] = [grammar, ...siblings];

  return closure.filter((loaded) => !paidModules.has(loaded));
}

function sumModuleBytes(modules: GrammarModuleName[]): number {
  let total = 0;
  for (const loaded of modules) {
    total += GRAMMAR_MODULE_GZIP_BYTES[loaded];
  }

  return total;
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
  if (left[1] !== right[1]) {
    return right[1] - left[1];
  }

  return left[0].localeCompare(right[0]);
}
