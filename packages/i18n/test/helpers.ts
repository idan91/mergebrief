// Catalog-shape checkers shared by the QA gates. Pure functions over parsed
// JSON so fixture cases can exercise every failure mode.

export interface CatalogIssue {
  readonly key: string;
  readonly problem: string;
}

interface FlatCatalog {
  [key: string]: string;
}

const PLURAL_SUFFIXES = new Set(["zero", "one", "two", "few", "many", "other"]);

export function isCatalogShape(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Dotted leaf map. Throws on a non-string, non-object leaf. */
export function flattenCatalog(tree: object, prefix = ""): FlatCatalog {
  const flat: FlatCatalog = {};
  for (const [key, value] of Object.entries(tree)) {
    const dotted = `${prefix}${key}`;
    if (typeof value === "string") {
      flat[dotted] = value;
    } else if (isCatalogShape(value)) {
      Object.assign(flat, flattenCatalog(value, `${dotted}.`));
    } else {
      throw new Error(`catalog leaf ${dotted} is neither string nor object`);
    }
  }
  return flat;
}

/** `attempts_one` → `attempts`; non-plural keys pass through. */
export function pluralBase(key: string): string {
  const underscore = key.lastIndexOf("_");
  if (underscore === -1) {
    return key;
  }
  const suffix = key.slice(underscore + 1);
  return PLURAL_SUFFIXES.has(suffix) ? key.slice(0, underscore) : key;
}

// Positional `<Trans>` slots: `<0>…</0>` and `<0/>`. The pair's interior
// forbids nesting and requires a non-space character: both an empty and a
// whitespace-only pair leave brackets behind and trip the markup ban, since
// either would render an element with no accessible name.
const TRANS_SLOT = /<(\d+)>[^<>]*\S[^<>]*<\/\1>|<(\d+)\s*\/>/g;

/**
 * Slots a value references, in source order and with repeats. `paired` carries
 * translatable inner text; `self` takes its content from the call site.
 */
export function slots(
  template: string,
): { index: number; form: "paired" | "self" }[] {
  const found: { index: number; form: "paired" | "self" }[] = [];
  for (const match of template.matchAll(TRANS_SLOT)) {
    const paired = match[1];
    const raw = paired ?? match[2];
    if (raw !== undefined) {
      found.push({
        index: Number(raw),
        form: paired === undefined ? "self" : "paired",
      });
    }
  }
  return found;
}

/** Slot indices a value references, in source order and with repeats. */
export function tagIndices(template: string): number[] {
  return slots(template).map((slot) => slot.index);
}

/**
 * En's counterpart for a key's slots. Per-suffix, NOT a union across plural
 * variants: forms legitimately differ in structure, and unlike `{{count}}`
 * nothing makes a slot mandatory in every form. A locale-only form (`ru`'s
 * `_few`) falls back to en's `_other`.
 */
function enSlotSource(flat: FlatCatalog, key: string, base: string): string {
  return flat[key] ?? flat[`${base}_other`] ?? flat[base] ?? "";
}

export function paramTokens(template: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    // `{{val, number}}`: the format tail is not part of the param name.
    tokens.add((match[1] ?? "").split(",")[0]?.trim() ?? "");
  }
  return tokens;
}

/** En's param set for a base key: union across its plural variants. */
function baseParamTokens(flat: FlatCatalog, base: string): Set<string> {
  const union = new Set<string>();
  for (const [key, template] of Object.entries(flat)) {
    if (pluralBase(key) === base) {
      for (const token of paramTokens(template)) {
        union.add(token);
      }
    }
  }
  return union;
}

/**
 * The mechanical review bar for a locale file, against en:
 * no invented/stale keys, `{{param}}` and slot sets untouched, plural suffixes
 * valid, no markup beyond positional slots. Fluency stays community-owned:
 * nothing here reads the prose.
 */
export function checkLocale(locale: object, en: object): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const flatLocale = flattenCatalog(locale);
  const flatEn = flattenCatalog(en);
  const enBases = new Set(Object.keys(flatEn).map(pluralBase));
  const enPluralBases = new Set(
    Object.keys(flatEn)
      .filter((key) => pluralBase(key) !== key)
      .map(pluralBase),
  );

  for (const [key, template] of Object.entries(flatLocale)) {
    const base = pluralBase(key);
    if (!enBases.has(base)) {
      issues.push({ key, problem: "key does not exist in en.json" });
      continue;
    }
    if (base !== key && !enPluralBases.has(base)) {
      // i18next only consults suffixed keys when `count` rides the call, so
      // a plural variant of a non-plural en key is silently dead.
      issues.push({ key, problem: "en.json key is not pluralized" });
      continue;
    }
    if (template.trim() === "") {
      issues.push({ key, problem: "value is empty" });
      continue;
    }
    const expected = baseParamTokens(flatEn, base);
    const actual = paramTokens(template);
    const drifted =
      [...actual].some((token) => !expected.has(token)) ||
      [...expected].some((token) => !actual.has(token));
    if (drifted) {
      issues.push({
        key,
        problem: `{{param}} set differs from en (expected {${[...expected].join(", ")}}, got {${[...actual].join(", ")}})`,
      });
    }
    const parsed = slots(template);
    if (/[<>]/.test(template.replace(TRANS_SLOT, ""))) {
      issues.push({ key, problem: "markup is not allowed in catalog values" });
    }
    // Components are passed positionally, so a gap or a repeat drops or
    // duplicates one: the wrapped text renders bare, or the element twice.
    const ordered = parsed
      .map((slot) => slot.index)
      .toSorted((left, right) => left - right);
    if (ordered.some((index, position) => index !== position)) {
      issues.push({
        key,
        problem: `slot indices must run 0..n-1 exactly once each (got {${ordered.join(", ")}})`,
      });
    }
    const enForms = new Map(
      slots(enSlotSource(flatEn, key, base)).map((slot) => [
        slot.index,
        slot.form,
      ]),
    );
    const actualSlots = new Set(ordered);
    const slotsDrifted =
      [...actualSlots].some((index) => !enForms.has(index)) ||
      [...enForms.keys()].some((index) => !actualSlots.has(index));
    if (slotsDrifted) {
      // Dropping a slot silently loses whatever it wrapped: a link becomes
      // prose with nothing to click.
      issues.push({
        key,
        problem: `slot set differs from en (expected {${[...enForms.keys()].join(", ")}}, got {${[...actualSlots].join(", ")}})`,
      });
    }
    // Turning `<0/>` into `<0>…</0>` makes Trans render the value's text
    // INSTEAD of the call site's children, so a translation could replace a
    // link's label with its own, and the index set alone cannot see it.
    for (const slot of parsed) {
      const enForm = enForms.get(slot.index);
      if (enForm !== undefined && enForm !== slot.form) {
        issues.push({
          key,
          problem: `slot <${slot.index}> must stay ${enForm === "self" ? "self-closing" : "paired"}, as in en`,
        });
      }
    }
  }
  return issues;
}
