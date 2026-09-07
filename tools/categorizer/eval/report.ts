import type { ValueOf } from "types";
import type { CaseBaseline } from "./baseline";
import {
  verdictFor,
  Verdicts,
  type PropertyScore,
  type Verdict,
} from "./verdicts";

/**
 * Report building: pure, no I/O, no process exit. The regression count is the
 * ONLY automation surface; everything else is for a human reading the terminal
 * or pasting the markdown into a PR.
 */

/** The slice of a property the report needs, `EvalProperty` and
 * `PairEvalProperty` both satisfy it; the report never calls `check`. */
export interface PropertyDescriptor {
  id: string;
  description: string;
}

export interface CaseOutcome {
  caseId: string;
  runsRequested: number;
  /** Successful generations actually scored (failures are excluded). */
  runsScored: number;
  generationFailures: number;
  properties: readonly PropertyDescriptor[];
  scores: ReadonlyMap<string, PropertyScore>;
  baseline: CaseBaseline | null;
  notes: readonly string[];
}

export const BillingKinds = {
  /** Token-metered API, dollars computable when a price row exists. */
  API: "api",
  /** CLI adapters: no marginal cost, no meterable dollars, say so. */
  SUBSCRIPTION: "subscription",
} as const;
export type BillingKind = ValueOf<typeof BillingKinds>;

export interface InvocationUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface ReportInput {
  /** provider:model of this invocation's generator. */
  key: string;
  billing: { kind: BillingKind };
  cases: readonly CaseOutcome[];
  /** Summed onUsage reports; null when nothing was reported. */
  usage: InvocationUsage | null;
  /** Priced total, when the eval price config has a row for `key`. */
  costUsd: number | null;
}

/** `no-baseline` = property (or whole case) has nothing to compare against. */
export type PropertyVerdict = Verdict | "no-baseline";

export interface PropertyReportEntry {
  id: string;
  description: string;
  passes: number;
  runs: number;
  baselinePasses: number | null;
  verdict: PropertyVerdict;
}

export interface CaseReportEntry {
  caseId: string;
  runsRequested: number;
  runsScored: number;
  generationFailures: number;
  properties: PropertyReportEntry[];
  notes: string[];
}

export interface EvalReportJson {
  key: string;
  cases: CaseReportEntry[];
  usage: InvocationUsage | null;
  costUsd: number | null;
  regressions: number;
}

export interface BuiltReport {
  json: EvalReportJson;
  terminal: string;
  markdown: string;
  regressions: number;
}

/** Verdicts that merit a line even in an otherwise quiet report. */
const LOUD: ReadonlySet<PropertyVerdict> = new Set([
  Verdicts.REGRESSION,
  Verdicts.WARN,
  Verdicts.IMPROVEMENT,
  Verdicts.FLAKY_DELTA,
  Verdicts.INSUFFICIENT_RUNS,
]);

export function buildReport(input: ReportInput): BuiltReport {
  const cases = input.cases.map(buildCase);
  const regressions = cases
    .flatMap((c) => c.properties)
    .filter((p) => p.verdict === Verdicts.REGRESSION).length;
  const json: EvalReportJson = {
    key: input.key,
    cases,
    usage: input.usage,
    costUsd: input.costUsd,
    regressions,
  };
  const lines = renderLines(input, cases, regressions);
  return {
    json,
    terminal: lines.join("\n"),
    markdown: renderMarkdown(input, cases, regressions, lines),
    regressions,
  };
}

function buildCase(outcome: CaseOutcome): CaseReportEntry {
  // A baseline id with no matching property must not vanish silently, that
  // drops it from gating under a clean-looking report.
  const knownIds = new Set(outcome.properties.map((p) => p.id));
  const staleNotes = Object.keys(outcome.baseline?.properties ?? {})
    .filter((id) => !knownIds.has(id))
    .map(
      (id) =>
        `baseline entry "${id}" matches no property (renamed or removed?) — rebaseline to drop it`,
    );
  const properties = outcome.properties.map((property): PropertyReportEntry => {
    const score = outcome.scores.get(property.id) ?? {
      passes: 0,
      runs: outcome.runsScored,
    };
    const baselinePasses = outcome.baseline?.properties[property.id];
    const verdict: PropertyVerdict =
      outcome.baseline === null || baselinePasses === undefined
        ? "no-baseline"
        : verdictFor(
            { passes: baselinePasses, runs: outcome.baseline.runs },
            score,
          );
    return {
      id: property.id,
      description: property.description,
      passes: score.passes,
      runs: score.runs,
      baselinePasses: baselinePasses ?? null,
      verdict,
    };
  });
  return {
    caseId: outcome.caseId,
    runsRequested: outcome.runsRequested,
    runsScored: outcome.runsScored,
    generationFailures: outcome.generationFailures,
    properties,
    notes: [...outcome.notes, ...staleNotes],
  };
}

function renderLines(
  input: ReportInput,
  cases: CaseReportEntry[],
  regressions: number,
): string[] {
  const lines: string[] = [];
  const propertyCount = cases.reduce((n, c) => n + c.properties.length, 0);
  let anythingLoud = false;
  for (const entry of cases) {
    const loud = entry.properties.filter((p) => LOUD.has(p.verdict));
    const unbaselined = entry.properties.filter(
      (p) => p.verdict === "no-baseline",
    );
    const allUnbaselined =
      entry.properties.length > 0 &&
      unbaselined.length === entry.properties.length;
    if (
      loud.length === 0 &&
      unbaselined.length === 0 &&
      entry.generationFailures === 0 &&
      entry.notes.length === 0
    ) {
      continue; // quiet when clean
    }
    anythingLoud = true;
    lines.push(`${entry.caseId}:`);
    if (entry.generationFailures > 0) {
      lines.push(
        `  ${entry.generationFailures} generation failures — ` +
          `${entry.runsScored}/${entry.runsRequested} runs scored`,
      );
    }
    if (allUnbaselined) {
      // Characterization: without a comparison the pass counts ARE the
      // result, render every property instead of one summary line.
      lines.push(`  no baseline for this generator — characterization scores:`);
      for (const p of entry.properties) {
        lines.push(`  ${p.passes}/${p.runs}  ${p.id} — ${p.description}`);
      }
    } else if (unbaselined.length > 0) {
      // A partially-baselined case must never read as clean: a property added
      // without a rebaseline would otherwise fail silently forever.
      lines.push(
        `  ${unbaselined.length} propert${unbaselined.length === 1 ? "y has" : "ies have"} ` +
          `no baseline entry (${unbaselined.map((p) => p.id).join(", ")}) — run eval --rebaseline`,
      );
    }
    for (const p of loud) {
      lines.push(
        `  ${p.verdict.toUpperCase()}  ${p.id} — ${p.passes}/${p.runs}` +
          (p.baselinePasses === null ? "" : ` (baseline ${p.baselinePasses})`) +
          ` — ${p.description}`,
      );
    }
    for (const note of entry.notes) lines.push(`  note: ${note}`);
  }
  lines.push(
    `${cases.length} case${cases.length === 1 ? "" : "s"}, ` +
      `${propertyCount} properties — ` +
      describeRegressionOutcome(regressions, anythingLoud),
  );
  lines.push(renderCostLine(input));
  return lines;
}

function describeRegressionOutcome(
  regressions: number,
  anythingLoud: boolean,
): string {
  if (regressions > 0) {
    const plural = regressions === 1 ? "" : "S";
    return `${regressions} REGRESSION${plural}`;
  }
  if (anythingLoud) return "no regressions (see lines above)";
  return "no change vs baseline";
}

/** Exported for the rebaseline path, cost is shown on EVERY spend. */
export function renderCostLine(
  input: Pick<ReportInput, "key" | "billing" | "usage" | "costUsd">,
): string {
  if (input.billing.kind === BillingKinds.SUBSCRIPTION) {
    // The harness cannot verify which account the CLI authenticated with, so
    // it must never assert "subscription" as fact, an env API key may be
    // billing a different account entirely.
    return `cost: billed to the ${input.key} CLI's authenticated account — check its usage page`;
  }
  if (input.usage === null) {
    return `cost: no usage reported by this generator`;
  }
  const tokens =
    `${input.usage.calls} calls — tokens in:${input.usage.inputTokens} ` +
    `out:${input.usage.outputTokens} cache_read:${input.usage.cacheReadTokens}`;
  if (input.costUsd === null) {
    return `cost: ${tokens} (no price row for ${input.key} — tokens only)`;
  }
  return `cost: $${input.costUsd.toFixed(2)} — ${tokens}`;
}

function renderMarkdown(
  input: ReportInput,
  cases: CaseReportEntry[],
  regressions: number,
  terminalLines: string[],
): string {
  void cases;
  void regressions;
  return [
    `### Eval report (${input.key})`,
    "",
    "```",
    ...terminalLines,
    "```",
  ].join("\n");
}
