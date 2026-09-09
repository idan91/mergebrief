import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "types";
import {
  BOUNDARY_RECORDS_PATH,
  LINT_CONFIG_PATH,
  ROOT_MANIFEST_PATH,
  SUPPRESSIONS_PATH,
} from "./consts";
import {
  compareBoundaryRecords,
  parseBoundaryRecords,
} from "./logic/boundaries";
import {
  listChangedFiles,
  readFileAtCommit,
  resolveBaseCommit,
  resolveRepoRoot,
} from "./logic/git";
import { listConfiguredRules } from "./logic/lint-config";
import { compareSuppressions, parseSuppressions } from "./logic/suppressions";
import type {
  BaselineVerdict,
  BaseError,
  BoundaryRecord,
  ParseError,
  SuppressionBaseline,
} from "./types";

const EMPTY_SUPPRESSIONS: SuppressionBaseline = new Map();

export interface GateReport {
  readonly baseCommit: string;
  readonly verdict: BaselineVerdict;
}

export type GateError = BaseError | ParseError;

function readWorkingFile(root: string, path: string): string | undefined {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return undefined;
  }
}

/** The lint command as the working tree spells it, for the escape-hatch check. */
function readLintScript(root: string): string {
  const text = readWorkingFile(root, ROOT_MANIFEST_PATH);
  if (text === undefined) return "";
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) return "";
  const scripts: unknown = Reflect.get(parsed, "scripts");
  if (typeof scripts !== "object" || scripts === null) return "";
  const lint: unknown = Reflect.get(scripts, "lint");
  return typeof lint === "string" ? lint : "";
}

function listBaselinedRules(
  baseline: SuppressionBaseline,
): ReadonlySet<string> {
  const rules = new Set<string>();
  for (const counts of baseline.values()) {
    for (const rule of counts.keys()) rules.add(rule);
  }
  return rules;
}

interface Baselines {
  readonly suppressions: SuppressionBaseline;
  readonly records: readonly BoundaryRecord[] | undefined;
}

function loadBaselines(
  suppressionsSource: string,
  suppressionsText: string | undefined,
  recordsSource: string,
  recordsText: string | undefined,
): Result<Baselines, ParseError> {
  let suppressions = EMPTY_SUPPRESSIONS;
  if (suppressionsText !== undefined) {
    const parsed = parseSuppressions(suppressionsSource, suppressionsText);
    if (!parsed.ok) return parsed;
    suppressions = parsed.value;
  }
  if (recordsText === undefined) {
    return { ok: true, value: { suppressions, records: undefined } };
  }
  const records = parseBoundaryRecords(recordsSource, recordsText);
  if (!records.ok) return records;
  return { ok: true, value: { suppressions, records: records.value } };
}

/**
 * Judge the working tree's two baseline files against the base commit's. Both
 * only ever lose entries, and a file this branch edits must leave none behind.
 * `cwd` may be any directory inside the repository.
 */
export function checkBaselines(
  cwd: string,
  baseRef: string,
): Result<GateReport, GateError> {
  const resolvedRoot = resolveRepoRoot(cwd);
  if (!resolvedRoot.ok) return resolvedRoot;
  const root = resolvedRoot.value;

  const base = resolveBaseCommit(root, baseRef);
  if (!base.ok) return base;
  const baseCommit = base.value;

  const head = loadBaselines(
    SUPPRESSIONS_PATH,
    readWorkingFile(root, SUPPRESSIONS_PATH),
    BOUNDARY_RECORDS_PATH,
    readWorkingFile(root, BOUNDARY_RECORDS_PATH),
  );
  if (!head.ok) return head;

  const recorded = loadBaselines(
    `${baseCommit}:${SUPPRESSIONS_PATH}`,
    readFileAtCommit(root, baseCommit, SUPPRESSIONS_PATH),
    `${baseCommit}:${BOUNDARY_RECORDS_PATH}`,
    readFileAtCommit(root, baseCommit, BOUNDARY_RECORDS_PATH),
  );
  if (!recorded.ok) return recorded;

  const configured = listConfiguredRules(
    readWorkingFile(root, LINT_CONFIG_PATH) ?? "",
    listBaselinedRules(recorded.value.suppressions),
  );
  const changed = listChangedFiles(root, baseCommit);
  if (!changed.ok) return changed;

  const suppressions = compareSuppressions(
    recorded.value.suppressions,
    head.value.suppressions,
    changed.value,
    configured,
  );
  const boundaries = compareBoundaryRecords(
    recorded.value.records,
    head.value.records,
    readLintScript(root),
  );

  return {
    ok: true,
    value: {
      baseCommit,
      verdict: {
        findings: [...suppressions.findings, ...boundaries.findings],
        retired: suppressions.retired,
        retiredBoundaryRecords: boundaries.retired,
      },
    },
  };
}
