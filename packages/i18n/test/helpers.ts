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

/** Dotted leaf map. Throws on a non-string, non-object leaf — bad shape. */
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

export function paramTokens(template: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    // `{{val, number}}` — the format tail is not part of the param name.
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
 * no invented/stale keys, `{{param}}` sets untouched, plural suffixes valid,
 * no markup. Fluency stays community-owned — nothing here reads the prose.
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
      // i18next only consults suffixed keys when `count` rides the call —
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
    if (/[<>]/.test(template)) {
      issues.push({ key, problem: "markup is not allowed in catalog values" });
    }
  }
  return issues;
}

/** Report-only: base keys present in en but absent from the locale. */
export function missingKeys(locale: object, en: object): string[] {
  const localeBases = new Set(
    Object.keys(flattenCatalog(locale)).map(pluralBase),
  );
  const enBases = new Set(Object.keys(flattenCatalog(en)).map(pluralBase));
  return [...enBases].filter((base) => !localeBases.has(base)).toSorted();
}
