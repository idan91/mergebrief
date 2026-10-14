// The mapping gate's logic, pure so the suite can drive it: take the operation
// ids and parse the CLI map, then enforce exhaustiveness in both directions:
// every operation carries exactly one entry (a command that EXISTS in the
// CLI's command tree, an unexpired fully-documented gap, or a reasoned
// web-only note); every map key names an operation. Expected failures return
// Result; the bin boundary owns exit codes.
import { createHash } from "node:crypto";
import {
  ProductActionIds,
  ProductOperations,
  ProductQueryIds,
  formatProductEndpoint,
} from "contract";
import type { Result } from "types/utils";
import { z } from "zod/v4";

/** A shape-valid `YYYY-MM-DD` can still name month 13 or day 32; reject those. */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const gapSchema = z
  .object({
    reason: z.string().min(1),
    owner: z.string().min(1),
    ticket: z.string().regex(/^BRIEF-\d+$/),
    expiry: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isRealCalendarDate, {
        message: "expiry must be a real calendar date",
      }),
  })
  .strict();

/** Permanent, browser-only: a written reason and an owner, no expiry. */
const webOnlySchema = z
  .object({ reason: z.string().min(1), owner: z.string().min(1) })
  .strict();

const entrySchema = z.union([
  z.object({ command: z.string().min(1) }).strict(),
  z.object({ gap: gapSchema }).strict(),
  z.object({ webOnly: webOnlySchema }).strict(),
]);

const mapSchema = z.record(z.string(), entrySchema);

const BIN_NAME = "mergebrief";

export interface OperationsMapSummary {
  readonly commands: number;
  readonly gaps: number;
  readonly webOnly: number;
}

export interface CheckOperationsMapInput {
  /** Every operation id the api serves, from the contract's table. */
  readonly operationIds: readonly string[];
  readonly mapRaw: string;
  /** ISO `YYYY-MM-DD`; a gap whose `expiry` is before it has expired. */
  readonly today: string;
  /** Command paths the real CLI registers, e.g. `pr`, `auth login`. */
  readonly commandPaths: ReadonlySet<string>;
}

/** One line per issue; the gate's other output is one line per problem. */
function zodLines(label: string, error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return `${label}: ${path === "" ? "<root>" : path}: ${issue.message}`;
  });
}

function parseJson(raw: string, label: string): Result<unknown, string> {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `${label}: invalid JSON: ${detail}` };
  }
}

/**
 * Top-level object keys in source order. `JSON.parse` keeps only the last of a
 * duplicate pair, so the raw text is the only place a duplicate is still
 * visible. Returns undefined when the root is not an object.
 */
function rawTopLevelKeys(raw: string): readonly string[] | undefined {
  const keys: string[] = [];
  let depth = 0;
  let index = 0;
  let sawRootObject = false;

  while (index < raw.length) {
    const char = raw[index];
    if (char === "{" || char === "[") {
      depth += 1;
      if (depth === 1 && char === "{") {
        sawRootObject = true;
      }
      index += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      index += 1;
      continue;
    }
    if (char !== '"') {
      index += 1;
      continue;
    }

    let end = index + 1;
    let literal = "";
    while (end < raw.length && raw[end] !== '"') {
      if (raw[end] === "\\") {
        literal += raw.slice(end, end + 2);
        end += 2;
        continue;
      }
      literal += raw[end];
      end += 1;
    }
    let after = end + 1;
    while (after < raw.length && /\s/.test(raw[after] ?? "")) {
      after += 1;
    }
    if (depth === 1 && raw[after] === ":") {
      keys.push(JSON.parse(`"${literal}"`));
    }
    index = end + 1;
  }

  return sawRootObject ? keys : undefined;
}

function duplicateKeyErrors(raw: string, label: string): readonly string[] {
  const keys = rawTopLevelKeys(raw);
  if (keys === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      duplicated.add(key);
    }
    seen.add(key);
  }
  return [...duplicated].map(
    (key) => `${label}: duplicate key "${key}", one entry per operation`,
  );
}

/** `mergebrief auth login <x>` → `auth login`; a placeholder ends the path. */
function parseCommandPath(command: string): string | undefined {
  const [bin, ...rest] = command.trim().split(/\s+/);
  if (bin !== BIN_NAME) {
    return undefined;
  }
  const path: string[] = [];
  for (const token of rest) {
    if (token.startsWith("<") || token.startsWith("[")) {
      break;
    }
    path.push(token);
  }
  return path.join(" ");
}

export function checkOperationsMap({
  operationIds,
  mapRaw,
  today,
  commandPaths,
}: CheckOperationsMapInput): Result<OperationsMapSummary, readonly string[]> {
  const mapJson = parseJson(mapRaw, "operations map");
  if (!mapJson.ok) {
    return { ok: false, error: [mapJson.error] };
  }

  const map = mapSchema.safeParse(mapJson.value);
  if (!map.success) {
    return { ok: false, error: zodLines("operations map", map.error) };
  }

  const duplicates = duplicateKeyErrors(mapRaw, "operations map");
  if (duplicates.length > 0) {
    return { ok: false, error: duplicates };
  }

  const errors: string[] = [];
  // A plain record lookup would reach Object.prototype for ids like
  // "constructor", which the registry's kebab-case rule allows.
  const entries = new Map(Object.entries(map.data));
  const knownIds = new Set(operationIds);
  let commands = 0;
  let gaps = 0;
  let webOnly = 0;

  for (const id of operationIds) {
    const entry = entries.get(id);
    if (entry === undefined) {
      errors.push(
        `"${id}" has no CLI command, documented gap, or web-only entry`,
      );
      continue;
    }
    if ("webOnly" in entry) {
      webOnly += 1;
      continue;
    }
    if ("command" in entry) {
      commands += 1;
      const path = parseCommandPath(entry.command);
      if (path === undefined) {
        errors.push(
          `"${id}" command "${entry.command}" must start with "${BIN_NAME}"`,
        );
        continue;
      }
      if (!commandPaths.has(path)) {
        errors.push(
          `"${id}" command "${entry.command}" is not a registered CLI command`,
        );
      }
      continue;
    }
    gaps += 1;
    if (entry.gap.expiry < today) {
      errors.push(
        `"${id}" gap expired ${entry.gap.expiry} (${entry.gap.ticket})`,
      );
    }
  }

  for (const id of entries.keys()) {
    if (!knownIds.has(id)) {
      errors.push(`map key "${id}" names no operation in the table`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, error: errors };
  }
  return { ok: true, value: { commands, gaps, webOnly } };
}

/** Byte-equal to the catalog `GET /api/capabilities` fingerprints: pretty
 * JSON, trailing newline, operations sorted by id. */
export function renderOperationCatalog(): string {
  const ids = [
    ...Object.values(ProductQueryIds),
    ...Object.values(ProductActionIds),
  ].toSorted((left, right) => left.localeCompare(right));
  const operations = ids.map((id) => ({
    id,
    kind: ProductOperations[id].kind,
    classification: ProductOperations[id].classification,
    endpoint: formatProductEndpoint(id),
  }));
  const rendered = `${JSON.stringify({ operations }, null, 2)}\n`;
  return rendered;
}

/** The committed `src/generated-catalog-fingerprint.ts`, rendered here so
 * write and verify cannot disagree on a byte. */
export function renderCatalogFingerprintModule(catalogRaw: string): string {
  const fingerprint = createHash("sha256").update(catalogRaw).digest("hex");
  const source =
    "// Generated by `pnpm map:check --write`: the sha256 of the operation\n" +
    "// table's catalog render this package's operations map was checked against.\n" +
    "// Do not edit by hand.\n" +
    "export const CLI_CATALOG_FINGERPRINT =\n" +
    `  "${fingerprint}";\n`;
  return source;
}
