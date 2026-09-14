import type { Result } from "types/utils";
import { BOUNDARY_IGNORE_FLAG } from "../consts";
import {
  FindingKinds,
  ParseErrorCodes,
  type BoundaryRecord,
  type Finding,
  type ParseError,
} from "../types";

function readString(value: object, key: string): string | undefined {
  const found: unknown = Reflect.get(value, key);
  return typeof found === "string" ? found : undefined;
}

function toRecord(entry: unknown): BoundaryRecord | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const from = readString(entry, "from");
  const to = readString(entry, "to");
  const rule: unknown = Reflect.get(entry, "rule");
  if (from === undefined || to === undefined) return undefined;
  if (typeof rule !== "object" || rule === null) return undefined;
  const name = readString(rule, "name");
  if (name === undefined) return undefined;
  return { from, to, rule: name };
}

/** `.dependency-cruiser-known-violations.json` as a list of recorded edges. */
export function parseBoundaryRecords(
  source: string,
  text: string,
): Result<readonly BoundaryRecord[], ParseError> {
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
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: {
        code: ParseErrorCodes.WRONG_SHAPE,
        source,
        message: "expected an array of recorded violations",
      },
    };
  }
  const records: BoundaryRecord[] = [];
  for (const entry of raw) {
    const record = toRecord(entry);
    if (record === undefined) {
      return {
        ok: false,
        error: {
          code: ParseErrorCodes.WRONG_SHAPE,
          source,
          message: "a record is missing from, to, or rule.name",
        },
      };
    }
    records.push(record);
  }
  return { ok: true, value: records };
}

function keyOf(record: BoundaryRecord): string {
  return `${record.rule} ${record.from} -> ${record.to}`;
}

export interface BoundaryComparison {
  readonly findings: readonly Finding[];
  readonly retired: number;
}

/**
 * Boundary records only ever shrink, and once the file is gone the
 * unsuppressed graph is the gate: the escape-hatch flag must not survive its
 * own baseline, or the rules would silently stop being enforced.
 */
export function compareBoundaryRecords(
  base: readonly BoundaryRecord[] | undefined,
  head: readonly BoundaryRecord[] | undefined,
  lintScript: string,
): BoundaryComparison {
  const findings: Finding[] = [];
  const wired = lintScript.includes(BOUNDARY_IGNORE_FLAG);

  if (head === undefined) {
    if (wired) {
      findings.push({
        kind: FindingKinds.BOUNDARY_IGNORE_STILL_WIRED,
        subject: BOUNDARY_IGNORE_FLAG,
        detail:
          "the records file is gone, so the lint command must drop the flag",
      });
    }
    return { findings, retired: base?.length ?? 0 };
  }

  if (base === undefined) {
    findings.push({
      kind: FindingKinds.BOUNDARY_BASELINE_REINTRODUCED,
      subject: "boundary records",
      detail: `${head.length} recorded again after the baseline was retired`,
    });
    return { findings, retired: 0 };
  }

  const known = new Set(base.map(keyOf));
  for (const record of head) {
    const key = keyOf(record);
    if (known.has(key)) continue;
    findings.push({
      kind: FindingKinds.NEW_BOUNDARY_RECORD,
      subject: key,
      detail: "recorded on this branch; the records file only loses entries",
    });
  }
  return { findings, retired: Math.max(0, base.length - head.length) };
}
