import type { z } from "zod/v4";

/**
 * Salvage for structured-output payloads that fail strict schema parsing. Closed
 * vocabularies are enforced server-side, so this is defense in depth for a
 * residual bad token: caller-named droppable array fields warn and drop the
 * element, while a bad token anywhere else stays a hard failure.
 */

export interface SalvageResult<T> {
  value: T;
  /** One human-readable line per dropped element. */
  issues: string[];
}

interface Removal {
  /** Path to the array that holds the bad element. */
  parent: (string | number)[];
  index: number;
}

function pathKey(path: (string | number)[]): string {
  return path.map(String).join("\0");
}

function isIndexable(
  value: unknown,
): value is Record<string | number, unknown> {
  return typeof value === "object" && value !== null;
}

function getAt(root: unknown, path: (string | number)[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isIndexable(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * From one round of Zod issues, find the array elements that may be dropped:
 * for each issue, the nearest enclosing array index whose field name is in
 * `droppable`. Deduped; same-array removals ordered highest-index-first so
 * earlier splices don't shift later ones.
 */
/** The slice of a Zod issue this module needs (structural, version-stable). */
interface IssueLike {
  path: readonly PropertyKey[];
}

/** The nearest enclosing droppable array element on `path`, innermost first. */
function findDroppableElement(
  path: readonly (string | number)[],
  droppable: ReadonlySet<string>,
): Removal | undefined {
  for (let i = path.length - 1; i > 0; i--) {
    const index = path[i];
    const field = path[i - 1];
    const droppableElement =
      typeof index === "number" &&
      typeof field === "string" &&
      droppable.has(field);
    if (droppableElement) return { parent: path.slice(0, i), index };
  }
  return undefined;
}

function collectRemovals(
  issues: readonly IssueLike[],
  droppable: ReadonlySet<string>,
): Removal[] {
  const seen = new Set<string>();
  const removals: Removal[] = [];
  for (const issue of issues) {
    const path = issue.path.filter(
      (p): p is string | number => typeof p !== "symbol",
    );
    const removal = findDroppableElement(path, droppable);
    if (removal === undefined) continue;

    const key = `${pathKey(removal.parent)}#${removal.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    removals.push(removal);
  }
  removals.sort((a, b) => {
    const ka = pathKey(a.parent);
    const kb = pathKey(b.parent);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return b.index - a.index;
  });
  return removals;
}

function describeElement(element: unknown): string {
  const text = JSON.stringify(element);
  if (text === undefined) return "undefined";
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/**
 * Repeatedly drop bad elements from the droppable array fields and re-parse,
 * until the payload parses clean or no fixable issue remains. Returns null
 * when the payload cannot be salvaged (structural failure, or an invalid
 * token outside a droppable field). Pure, the input is never mutated.
 */
export function salvageDroppableEnums<S extends z.ZodType>(
  raw: unknown,
  schema: S,
  droppable: ReadonlySet<string>,
): SalvageResult<z.infer<S>> | null {
  const issues: string[] = [];
  const working = structuredClone(raw);

  // Each round drops at least one element, so this terminates; the cap is a
  // guard against a pathological payload, not an expected path.
  for (let round = 0; round < 25; round++) {
    const parsed = schema.safeParse(working);
    if (parsed.success) {
      return { value: parsed.data, issues };
    }
    const removals = collectRemovals(parsed.error.issues, droppable);
    if (removals.length === 0) return null;
    for (const removal of removals) {
      const parent = getAt(working, removal.parent);
      if (!Array.isArray(parent) || removal.index >= parent.length) return null;
      const [removed] = parent.splice(removal.index, 1);
      issues.push(
        `dropped ${[...removal.parent, removal.index].join(".")} = ${describeElement(removed)} (failed schema validation)`,
      );
    }
  }
  return null;
}
