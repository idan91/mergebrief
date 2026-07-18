import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod/v4";
import type { Result } from "types";

/**
 * A case's checked-in baseline: property pass counts from main at a given
 * provider:model key (BRIEF-59 decision 5). Re-baselining is an explicit,
 * reviewed commit — `saveBaseline` writes sorted, newline-terminated JSON
 * so the diff reads like a snapshot update.
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
 * yet). A key mismatch or malformed file is a refusal — cross-model
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
