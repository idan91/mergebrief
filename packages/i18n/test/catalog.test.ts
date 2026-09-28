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
  tagIndices,
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
// Hard-fail gates: the mechanical review bar for every shipped locale file.
// ---------------------------------------------------------------------------

describe("hard-fail catalog gates", () => {
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
    // translated picker label, the silent half of the bijection.
    expect(Object.keys(RESOURCES).toSorted()).toEqual(fileIds.toSorted());
  });

  it("no locale invents keys, drifts a {{param}} set, or carries markup", () => {
    const en = parseLocale("en.json");
    for (const file of localeFiles()) {
      expect(checkLocale(parseLocale(file), en)).toEqual([]);
    }
  });

  it("pins every slot-bearing key to its slot count", () => {
    // A slot-bearing key read through a bare `t()` renders its tags as text,
    // and a slot with no component renders as NOTHING. Pinning counts (not
    // just the key set) forces a slot change to be re-checked against the
    // call site's `components` arity by hand; nothing here reaches one.
    const flat = flattenCatalog(parseLocale("en.json"));
    const slotted = Object.entries(flat)
      .filter(([, template]) => tagIndices(template).length > 0)
      .map(([key, template]) => [key, tagIndices(template).length]);
    expect(Object.fromEntries(slotted)).toEqual({
      "brief.diff.siblingSpanGroupRemoved_one": 1,
      "brief.diff.siblingSpanGroupRemoved_other": 1,
      "brief.diff.siblingSpanGroup_one": 1,
      "brief.diff.siblingSpanGroup_other": 1,
      "brief.focusBanner.hint": 5,
      "brief.group.splitIntent": 1,
      "brief.intent.accomplished_one": 1,
      "brief.intent.accomplished_other": 1,
      "brief.intent.claimedButUnachieved_one": 1,
      "brief.intent.claimedButUnachieved_other": 1,
      "brief.intent.deviations_one": 1,
      "brief.intent.deviations_other": 1,
      "brief.intent.doneButUnstated_one": 1,
      "brief.intent.doneButUnstated_other": 1,
      "brief.intent.statedButMissing_one": 1,
      "brief.intent.statedButMissing_other": 1,
      "shell.attach.hint": 1,
      "shell.signInPrompt": 1,
      "tokens.disclaimer": 1,
      "tokens.intro": 1,
    });
  });

  it("en carries every wire-error and generation-failure template", () => {
    // Scaffold pin: counts only. The vocabulary-equality pins against the
    // api contract module and the persistence failure codes land with those
    // modules; this catches a template dropped from en.json in the interim.
    const flat = flattenCatalog(parseLocale("en.json"));
    const errorKeys = Object.keys(flat).filter((key) =>
      key.startsWith("errors."),
    );
    const generationKeys = Object.keys(flat).filter((key) =>
      key.startsWith("generationError."),
    );
    expect(errorKeys).toHaveLength(32);
    expect(generationKeys).toHaveLength(11);
  });
});

// ---------------------------------------------------------------------------
// Report-only: completeness never blocks a locale from shipping.
// ---------------------------------------------------------------------------

describe("report-only catalog completeness", () => {
  it("prints per-locale coverage", () => {
    const en = parseLocale("en.json");
    const total = new Set(Object.keys(flattenCatalog(en)).map(pluralBase)).size;
    for (const file of localeFiles()) {
      const missing = missingKeys(parseLocale(file), en);
      const covered = total - missing.length;
      const percent = ((covered / total) * 100).toFixed(1);
      console.info(
        `${file}: ${percent}% (${covered}/${total})${missing.length > 0 ? `, missing: ${missing.join(", ")}` : ""}`,
      );
    }
    expect(total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Checker behaviour: fixtures exercising each failure mode the gates rely on.
// ---------------------------------------------------------------------------

function carriesMarkup(locale: object, source: object): boolean {
  return checkLocale(locale, source).some((issue) =>
    issue.problem.includes("markup"),
  );
}

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

  it("flags a plural variant of a non-plural en key as silently dead", () => {
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

  it("accepts positional slots, and lets a translation move them", () => {
    const paired = { linked: "read the <0>guide</0> first" };
    expect(
      checkLocale({ linked: "erst den <0>Leitfaden</0> lesen" }, paired),
    ).toEqual([]);
    const selfClosing = { icon: "see <0/>" };
    expect(checkLocale({ icon: "<0/> siehe dort" }, selfClosing)).toEqual([]);
    expect(checkLocale({ icon: "<0 /> siehe" }, selfClosing)).toEqual([]);
  });

  it("accepts a multi-slot value, reordered", () => {
    const two = { pair: "run <0>cmd</0> as <1>you</1>." };
    expect(
      checkLocale({ pair: "als <1>du</1> <0>cmd</0> starten." }, two),
    ).toEqual([]);
  });

  it("flags an emptied or blank paired slot that leaves the element unnamed", () => {
    const paired = { linked: "read the <0>guide</0>" };
    expect(carriesMarkup({ linked: "lies <0></0>" }, paired)).toBe(true);
    expect(carriesMarkup({ linked: "lies <0> </0>" }, paired)).toBe(true);
  });

  it("flags a slot reshaped from self-closing to paired", () => {
    // Trans would render the value's text INSTEAD of the call site's element
    // children, letting a translation replace a link's label.
    const selfClosing = { linked: "<0/> and <1/> to manage tokens." };
    const issues = checkLocale(
      { linked: "<0>Se connecter</0> et <1>gérer</1>." },
      selfClosing,
    );
    // Every reshaped slot is reported, not only the first; otherwise a
    // multi-slot value costs one round trip per slot.
    expect(
      issues.filter((issue) => issue.problem.includes("self-closing")),
    ).toHaveLength(2);
  });

  it("flags a slot a translation dropped so the link stops being one", () => {
    const slotted = { linked: "read the <0>guide</0> first" };
    const issues = checkLocale({ linked: "erst den Leitfaden lesen" }, slotted);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toContain("slot set differs");
  });

  it("flags a gap in slot indices that renders the wrapped text bare", () => {
    const slotted = { linked: "<0>a</0> and <1>b</1>" };
    const issues = checkLocale({ linked: "<1>b</1> und <2>c</2>" }, slotted);
    expect(issues.some((issue) => issue.problem.includes("0..n-1"))).toBe(true);
  });

  it("flags a repeated slot that would render the element twice", () => {
    const slotted = { linked: "read the <0>guide</0>" };
    const issues = checkLocale({ linked: "<0>a</0> und <0>b</0>" }, slotted);
    expect(issues.some((issue) => issue.problem.includes("0..n-1"))).toBe(true);
  });

  it("compares slots per plural form, never unioned across them", () => {
    // `_one` carrying fewer slots than `_other` is a legitimate structure;
    // unioning would fail en against itself.
    const plural = {
      skipped_one: "<0>{{count}} file</0> skipped",
      skipped_other: "<0>{{count}} files</0> skipped, <1>see log</1>",
    };
    expect(checkLocale(plural, plural)).toEqual([]);
    // A locale-only form falls back to en's `_other`.
    expect(
      checkLocale(
        { skipped_few: "<0>{{count}} soubory</0>, <1>log</1>" },
        plural,
      ),
    ).toEqual([]);
    const issues = checkLocale({ skipped_few: "<0>{{count}}</0>" }, plural);
    expect(issues.some((issue) => issue.problem.includes("slot set"))).toBe(
      true,
    );
  });

  it("still rejects named tags, orphans, and nesting", () => {
    expect(carriesMarkup({ plain: "<script>x</script>" }, en)).toBe(true);
    expect(carriesMarkup({ plain: "a < b" }, en)).toBe(true);
    expect(carriesMarkup({ plain: "hallo</0>" }, en)).toBe(true);
    // Unbalanced: the opener survives the strip and trips the ban.
    expect(carriesMarkup({ plain: "<0>hallo" }, en)).toBe(true);
    expect(
      carriesMarkup({ linked: "<0>a <1>b</1></0>" }, { linked: "<0>a</0>" }),
    ).toBe(true);
  });

  it("treats a format tail as part of the token, not a param", () => {
    expect(paramTokens("{{val, number}} items")).toEqual(new Set(["val"]));
  });

  it("keeps non-plural underscores out of plural stripping", () => {
    expect(pluralBase("some_key")).toBe("some_key");
    expect(pluralBase("attempts_other")).toBe("attempts");
  });
});
