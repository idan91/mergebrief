import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import type { Result, ValueOf } from "types/utils";

/**
 * How a run relates to the checked-in baseline: `compare` (the default
 * regression gate), `rebaseline` (overwrite; an explicit, reviewed commit),
 * or `none` (characterization: a generator key with no committed baseline,
 * e.g. a cross-model run; scores report, verdicts render as no-baseline).
 */
export const BaselineModes = {
  COMPARE: "compare",
  REBASELINE: "rebaseline",
  NONE: "none",
} as const;
export type BaselineMode = ValueOf<typeof BaselineModes>;

/**
 * A case's checked-in baseline: property pass counts from main at a given
 * provider:model key. Re-baselining is an explicit, reviewed commit;
 * `saveBaseline` writes sorted, newline-terminated JSON so the diff reads
 * like a snapshot update.
 */
export interface CaseBaseline {
  /** `${provider}:${model}` of the generator that produced it. */
  key: string;
  runs: number;
  /** Property id → pass count (out of `runs`). */
  properties: Record<string, number>;
}

const CaseBaselineSchema = z.object({
  key: z.string(),
  runs: z.number().int().positive(),
  properties: z.record(z.string(), z.number().int().nonnegative()),
});

/**
 * Absent file → `{ ok: true, value: null }` (a new case has no baseline
 * yet). A key mismatch or malformed file is a refusal; cross-model
 * comparison must fail loudly, never silently mislead.
 */
export function loadBaseline(
  path: string,
  expectedKey: string,
): Result<CaseBaseline | null, string> {
  if (!existsSync(path)) return { ok: true, value: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      ok: false,
      error: `unreadable baseline at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const parsed = CaseBaselineSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `malformed baseline at ${path}` };
  }
  if (parsed.data.key !== expectedKey) {
    return {
      ok: false,
      error:
        `baseline at ${path} is for "${parsed.data.key}" but this run uses ` +
        `"${expectedKey}" — re-baseline with --rebaseline or switch generators`,
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Refuse a cross-key run BEFORE any generation happens, so a mismatch cannot
 * spend live API money first. A case with no baseline yet passes; the
 * per-case load still runs later.
 */
export function preflightBaselineKeys(
  cases: ReadonlyArray<{ id: string; dir: string }>,
  expectedKey: string,
): Result<void, string> {
  for (const evalCase of cases) {
    const loaded = loadBaseline(
      join(evalCase.dir, "baseline.json"),
      expectedKey,
    );
    if (!loaded.ok) return loaded;
  }
  return { ok: true, value: undefined };
}

export function saveBaseline(path: string, baseline: CaseBaseline): void {
  const sorted: CaseBaseline = {
    key: baseline.key,
    runs: baseline.runs,
    properties: Object.fromEntries(
      Object.entries(baseline.properties).toSorted(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
  };
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
}
