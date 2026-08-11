import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCALES, RESOURCES } from "../src/locales";
import {
  checkLocale,
  flattenCatalog,
  isCatalogShape,
  missingKeys,
  paramTokens,
  pluralBase,
} from "./helpers";

const LOCALES_DIR = fileURLToPath(new URL("../locales", import.meta.url));

function localeFiles(): string[] {
  return readdirSync(LOCALES_DIR)
    .filter((name) => name.endsWith(".json"))
    .toSorted();
}

function parseLocale(file: string): object {
  const parsed: unknown = JSON.parse(
    readFileSync(`${LOCALES_DIR}/${file}`, "utf8"),
  );
  if (!isCatalogShape(parsed)) {
    throw new Error(`${file} is not a JSON object`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Hard-fail gates — the mechanical review bar for every shipped locale file.
// ---------------------------------------------------------------------------

describe("catalog gates (hard-fail)", () => {
  it("every locale file parses as a nested string catalog", () => {
    for (const file of localeFiles()) {
      expect(() => flattenCatalog(parseLocale(file))).not.toThrow();
    }
  });

  it("registry, resources, and locale files match one-to-one", () => {
    const fileIds = localeFiles().map((file) => file.replace(/\.json$/, ""));
    const registryIds = LOCALES.map((entry) => entry.id);
    expect(fileIds.toSorted()).toEqual(registryIds.toSorted());
    // A LOCALES row without a RESOURCES entry renders English under a
    // translated picker label — the silent half of the bijection.
    expect(Object.keys(RESOURCES).toSorted()).toEqual(fileIds.toSorted());
  });

  it("no locale invents keys, drifts a {{param}} set, or carries markup", () => {
    const en = parseLocale("en.json");
    for (const file of localeFiles()) {
      expect(checkLocale(parseLocale(file), en)).toEqual([]);
    }
  });

  it("en carries every wire-error and generation-failure template", () => {
    // Scaffold pin: counts only. The vocabulary-equality pins against the
    // api contract module and the persistence failure codes land with those
    // modules — this catches a template dropped from en.json in the interim.
    const flat = flattenCatalog(parseLocale("en.json"));
    const errorKeys = Object.keys(flat).filter((key) =>
      key.startsWith("errors."),
    );
    const generationKeys = Object.keys(flat).filter((key) =>
      key.startsWith("generationError."),
    );
    expect(errorKeys).toHaveLength(18);
    expect(generationKeys).toHaveLength(11);
  });
});

// ---------------------------------------------------------------------------
// Report-only — completeness never blocks a locale from shipping.
// ---------------------------------------------------------------------------

describe("catalog completeness (report-only)", () => {
  it("prints per-locale coverage", () => {
    const en = parseLocale("en.json");
    const total = new Set(Object.keys(flattenCatalog(en)).map(pluralBase)).size;
    for (const file of localeFiles()) {
      const missing = missingKeys(parseLocale(file), en);
      const covered = total - missing.length;
      const percent = ((covered / total) * 100).toFixed(1);
      console.info(
        `${file}: ${percent}% (${covered}/${total})${missing.length > 0 ? ` — missing: ${missing.join(", ")}` : ""}`,
      );
    }
    expect(total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Checker behaviour — fixtures exercising each failure mode the gates rely on.
// ---------------------------------------------------------------------------

describe("checkLocale", () => {
  const en = {
    plain: "hello",
    tokened: "hi {{name}}, {{count}} left",
    attempts_one: "{{count}} attempt",
    attempts_other: "{{count}} attempts",
  };

  it("accepts a faithful partial locale", () => {
    expect(checkLocale({ plain: "hallo" }, en)).toEqual([]);
  });

  it("accepts locale-specific plural forms of a pluralized base", () => {
    expect(checkLocale({ attempts_few: "{{count}} pokusy" }, en)).toEqual([]);
  });

  it("flags a plural variant of a non-plural en key — silently dead", () => {
    const issues = checkLocale({ plain_few: "hallo" }, en);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toContain("not pluralized");
  });

  it("flags an empty value", () => {
    const issues = checkLocale({ plain: "  " }, en);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toContain("empty");
  });

  it("flags an invented key", () => {
    const issues = checkLocale({ nope: "x" }, en);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toContain("does not exist");
  });

  it("flags a dropped or invented {{param}}", () => {
    expect(checkLocale({ tokened: "hi {{name}}" }, en)).toHaveLength(1);
    expect(checkLocale({ plain: "hallo {{surprise}}" }, en)).toHaveLength(1);
  });

  it("flags markup in a value", () => {
    const issues = checkLocale({ plain: "<b>hallo</b>" }, en);
    expect(issues.some((issue) => issue.problem.includes("markup"))).toBe(true);
  });

  it("treats a format tail as part of the token, not a param", () => {
    expect(paramTokens("{{val, number}} items")).toEqual(new Set(["val"]));
  });

  it("keeps non-plural underscores out of plural stripping", () => {
    expect(pluralBase("some_key")).toBe("some_key");
    expect(pluralBase("attempts_other")).toBe("attempts");
  });
});
