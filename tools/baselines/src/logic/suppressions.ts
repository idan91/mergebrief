import type { Result } from "types/utils";
import {
  ChangeKinds,
  FindingKinds,
  ParseErrorCodes,
  RetirementReasons,
  type ChangedFile,
  type Finding,
  type ParseError,
  type RetiredSuppression,
  type SuppressionBaseline,
} from "../types";

function isCountEntry(value: unknown): value is { count: number } {
  if (typeof value !== "object" || value === null) return false;
  const count: unknown = Reflect.get(value, "count");
  return typeof count === "number" && Number.isInteger(count) && count >= 0;
}

function wrongShape(
  source: string,
  message: string,
): Result<never, ParseError> {
  return {
    ok: false,
    error: { code: ParseErrorCodes.WRONG_SHAPE, source, message },
  };
}

/** `oxlint-suppressions.json` as `path -> rule -> count`. */
export function parseSuppressions(
  source: string,
  text: string,
): Result<SuppressionBaseline, ParseError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    return {
      ok: false,
      error: { code: ParseErrorCodes.UNREADABLE, source, message },
    };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return wrongShape(source, "expected an object keyed by file path");
  }

  const parsed = new Map<string, ReadonlyMap<string, number>>();
  for (const [path, rules] of Object.entries(raw)) {
    if (typeof rules !== "object" || rules === null || Array.isArray(rules)) {
      return wrongShape(source, `${path} does not carry a rule map`);
    }
    const counts = new Map<string, number>();
    for (const [rule, entry] of Object.entries(rules)) {
      if (!isCountEntry(entry)) {
        return wrongShape(source, `${path} ${rule} has no integer count`);
      }
      counts.set(rule, entry.count);
    }
    parsed.set(path, counts);
  }
  return { ok: true, value: parsed };
}

function countFor(
  baseline: SuppressionBaseline,
  path: string,
  rule: string,
): number {
  return baseline.get(path)?.get(rule) ?? 0;
}

/** Per-rule totals, which is how debt moved between files still shows up. */
function totalByRule(
  baseline: SuppressionBaseline,
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const counts of baseline.values()) {
    for (const [rule, count] of counts) {
      totals.set(rule, (totals.get(rule) ?? 0) + count);
    }
  }
  return totals;
}

function findGrowth(
  base: SuppressionBaseline,
  head: SuppressionBaseline,
  renamedFrom: ReadonlyMap<string, string>,
): readonly Finding[] {
  const findings: Finding[] = [];
  for (const [path, counts] of head) {
    const sourcePath = renamedFrom.get(path) ?? path;
    for (const [rule, count] of counts) {
      const before = countFor(base, sourcePath, rule);
      if (before === 0) {
        findings.push({
          kind: FindingKinds.NEW_SUPPRESSION,
          subject: `${path} ${rule}`,
          detail: `${count} newly suppressed; the baseline only ever loses entries`,
        });
        continue;
      }
      if (count > before) {
        findings.push({
          kind: FindingKinds.GROWN_SUPPRESSION,
          subject: `${path} ${rule}`,
          detail: `${before} suppressed at the base, ${count} now`,
        });
      }
    }
  }
  return findings;
}

function findRuleTotalGrowth(
  base: SuppressionBaseline,
  head: SuppressionBaseline,
): readonly Finding[] {
  const findings: Finding[] = [];
  const baseTotals = totalByRule(base);
  for (const [rule, total] of totalByRule(head)) {
    const before = baseTotals.get(rule) ?? 0;
    if (total > before) {
      findings.push({
        kind: FindingKinds.GROWN_RULE_TOTAL,
        subject: rule,
        detail: `${before} suppressed at the base, ${total} now, across all files`,
      });
    }
  }
  return findings;
}

function findStaleDeletion(
  head: SuppressionBaseline,
  path: string,
): Finding | undefined {
  const stale = head.get(path);
  if (stale === undefined) return undefined;
  return {
    kind: FindingKinds.STALE_DELETION,
    subject: path,
    detail: `gone from the tree, but the baseline still carries ${[...stale.keys()].join(", ")}`,
  };
}

function findCarriedDebt(
  head: SuppressionBaseline,
  path: string,
  edited: string,
): readonly Finding[] {
  const carried = head.get(path);
  if (carried === undefined) return [];
  return [...carried].map(([rule, count]) => ({
    kind: FindingKinds.UNCLEANED_EDIT,
    subject: `${path} ${rule}`,
    detail: `this branch edits ${edited}, so its ${count} suppressed ${rule} violations must go`,
  }));
}

/**
 * Cleanup-on-edit, plus the two ways a path can go stale. A rename is checked
 * under BOTH names: leaving the old key behind would otherwise let a rename
 * carry the debt out of reach of the edited-file check.
 */
function findUncleanedEdits(
  head: SuppressionBaseline,
  changed: readonly ChangedFile[],
): readonly Finding[] {
  const findings: Finding[] = [];
  for (const file of changed) {
    if (file.kind === ChangeKinds.DELETED) {
      const stale = findStaleDeletion(head, file.path);
      if (stale !== undefined) findings.push(stale);
      continue;
    }
    findings.push(...findCarriedDebt(head, file.path, file.path));
    if (file.previousPath === undefined) continue;
    findings.push(...findCarriedDebt(head, file.previousPath, file.path));
  }
  return findings;
}

function reasonFor(
  rule: string,
  path: string,
  deletedPaths: ReadonlySet<string>,
  configuredRules: ReadonlySet<string>,
): RetiredSuppression["reason"] {
  if (deletedPaths.has(path)) return RetirementReasons.DELETED;
  if (!configuredRules.has(rule)) return RetirementReasons.POLICY;
  return RetirementReasons.FIXED;
}

function listRetired(
  base: SuppressionBaseline,
  head: SuppressionBaseline,
  renamedTo: ReadonlyMap<string, string>,
  deletedPaths: ReadonlySet<string>,
  configuredRules: ReadonlySet<string>,
): readonly RetiredSuppression[] {
  const retired: RetiredSuppression[] = [];
  for (const [path, counts] of base) {
    const headPath = renamedTo.get(path) ?? path;
    for (const [rule, before] of counts) {
      const after = countFor(head, headPath, rule);
      if (after >= before) continue;
      retired.push({
        path,
        rule,
        before,
        after,
        reason: reasonFor(rule, path, deletedPaths, configuredRules),
      });
    }
  }
  return retired;
}

export interface SuppressionComparison {
  readonly findings: readonly Finding[];
  readonly retired: readonly RetiredSuppression[];
}

/**
 * Judge the working tree's suppressions against the base commit's. The three
 * refusals are a new entry, a grown count, and an edited file that kept its
 * debt; a rule total that grew is the fourth, because moving debt between
 * files hides growth from all three.
 */
export function compareSuppressions(
  base: SuppressionBaseline,
  head: SuppressionBaseline,
  changed: readonly ChangedFile[],
  configuredRules: ReadonlySet<string>,
): SuppressionComparison {
  const renamedFrom = new Map<string, string>();
  const renamedTo = new Map<string, string>();
  const deletedPaths = new Set<string>();
  for (const file of changed) {
    if (file.kind === ChangeKinds.RENAMED && file.previousPath !== undefined) {
      renamedFrom.set(file.path, file.previousPath);
      renamedTo.set(file.previousPath, file.path);
    }
    if (file.kind === ChangeKinds.DELETED) deletedPaths.add(file.path);
  }

  const findings = [
    ...findGrowth(base, head, renamedFrom),
    ...findRuleTotalGrowth(base, head),
    ...findUncleanedEdits(head, changed),
  ];
  const retired = listRetired(
    base,
    head,
    renamedTo,
    deletedPaths,
    configuredRules,
  );
  return { findings, retired };
}
