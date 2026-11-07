import { fileURLToPath } from "node:url";

import { compile } from "sass";
import { describe, expect, it } from "vitest";

import { MOBILE_BREAKPOINT_PX } from "@web/hooks/useMobileViewport";
import {
  CARD_BLEED_PX,
  CARD_BORDERS_PX,
  CODE_GLYPH_PX,
  DEFAULT_REM_PX,
  MAIN_GUTTER_PX,
  NARROW_MAIN_GUTTER_PX,
  PHONE_CODE_PADDING_PX,
  PHONE_UNIFIED_NUMBERS_PX,
  SPLIT_NUMBERS_PX,
} from "./chunk-height-model";
import { CARD_BLEED_QUERY } from "./useWrapColumns";

// The phone wrap model copies these lengths from the stylesheets; nothing
// else in the toolchain compares them.

interface CompiledRule {
  atRules: string[];
  selector: string;
  declarations: Map<string, string>;
}

type CustomProperties = ReadonlyMap<string, string>;

type RuleScope = (rule: CompiledRule) => boolean;

const SRC_DIRECTORY = fileURLToPath(
  new URL("../../../../../../", import.meta.url),
);
const STYLES_DIRECTORY = `${SRC_DIRECTORY}styles`;
const BRIEF_VIEW_DIRECTORY = `${SRC_DIRECTORY}features/brief/ui/components/BriefView`;
const PLEX_MONO_ADVANCE_EM = 0.6;
const PHONE_QUERY = new RegExp(
  `(max-width: |width <= )${String(MOBILE_BREAKPOINT_PX)}px`,
);
const COMMENT = /\/\*[\s\S]*?\*\//g;
const VAR_REFERENCE = /var\((--[\w-]+)\)/g;
const REM_LENGTH = /(\d*\.?\d+)rem/g;
const PX_LENGTH = /(\d*\.?\d+)px/g;
const ARITHMETIC_TOKEN = /\d*\.?\d+|[()+\-*/]/g;

function parseDeclarations(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon !== -1) {
      const property = declaration.slice(0, colon).trim();
      declarations.set(property, declaration.slice(colon + 1).trim());
    }
  }
  return declarations;
}

/** The compiled sheet's style rules, each with the at-rule preludes around it. */
function readCompiledRules(path: string): CompiledRule[] {
  const { css } = compile(path, { loadPaths: [STYLES_DIRECTORY] });
  const rules: CompiledRule[] = [];
  const preludes: string[] = [];
  let buffer = "";
  for (const character of css.replace(COMMENT, "")) {
    if (character === "{") {
      preludes.push(buffer.trim());
      buffer = "";
    } else if (character === "}") {
      const selector = preludes.pop() ?? "";
      const atRules = preludes.filter((prelude) => prelude.startsWith("@"));
      const declarations = parseDeclarations(buffer);
      if (!selector.startsWith("@")) {
        rules.push({ atRules, selector, declarations });
      }
      buffer = "";
    } else {
      buffer += character;
    }
  }
  return rules;
}

function isOutsideMedia(rule: CompiledRule): boolean {
  return !rule.atRules.some((prelude) => prelude.startsWith("@media"));
}

function isUnderPhoneQuery(rule: CompiledRule): boolean {
  return rule.atRules.some((prelude) => PHONE_QUERY.test(prelude));
}

function isUnderBleedQuery(rule: CompiledRule): boolean {
  return rule.atRules.includes(`@media ${CARD_BLEED_QUERY}`);
}

/** The one rule for `selector` in `scope` that sets `property`. */
function findRule(
  rules: readonly CompiledRule[],
  selector: string,
  property: string,
  scope: RuleScope,
): CompiledRule {
  const matches = rules.filter(
    (rule) =>
      rule.selector === selector &&
      rule.declarations.has(property) &&
      scope(rule),
  );
  const [rule] = matches;
  if (rule === undefined || matches.length > 1) {
    throw new Error(`Want one ${selector} rule setting ${property}`);
  }
  return rule;
}

/** The rule a phone applies: an override under the phone query, else the base rule. */
function findPhoneRule(
  rules: readonly CompiledRule[],
  selector: string,
  property: string,
): CompiledRule {
  const overridden = rules.some(
    (rule) =>
      rule.selector === selector &&
      rule.declarations.has(property) &&
      isUnderPhoneQuery(rule),
  );
  const scope = overridden ? isUnderPhoneQuery : isOutsideMedia;
  return findRule(rules, selector, property, scope);
}

function readValue(rule: CompiledRule, property: string): string {
  return rule.declarations.get(property) ?? "";
}

/** A unitless + - * / expression with parentheses. */
function evaluateArithmetic(expression: string): number {
  const tokens = expression.match(ARITHMETIC_TOKEN) ?? [];
  let at = 0;
  function readFactor(): number {
    const token = tokens[at];
    at += 1;
    if (token !== "(") {
      return Number(token);
    }
    const value = readSum();
    at += 1;
    return value;
  }
  function readProduct(): number {
    let value = readFactor();
    while (tokens[at] === "*" || tokens[at] === "/") {
      const operator = tokens[at];
      at += 1;
      const right = readFactor();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }
  function readSum(): number {
    let value = readProduct();
    while (tokens[at] === "+" || tokens[at] === "-") {
      const operator = tokens[at];
      at += 1;
      const right = readProduct();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }
  return readSum();
}

function substituteProperties(
  value: string,
  properties: CustomProperties,
): string {
  return value.replace(VAR_REFERENCE, (_whole, name: string) => {
    const property = properties.get(name);
    if (property === undefined) {
      throw new Error(`${name} is not defined`);
    }
    return `(${property})`;
  });
}

/** One CSS length in px at the default root size. */
function resolveLengthPx(value: string, properties: CustomProperties): number {
  let resolved = value;
  while (resolved.includes("var(")) {
    resolved = substituteProperties(resolved, properties);
  }
  const remInPx = resolved.replace(REM_LENGTH, (_whole, rem: string) => {
    return String(Number(rem) * DEFAULT_REM_PX);
  });
  const unitless = remInPx.replace(PX_LENGTH, "$1").replaceAll("calc", "");
  return evaluateArithmetic(unitless);
}

function readLengthPx(
  rule: CompiledRule,
  property: string,
  properties: CustomProperties,
): number {
  return resolveLengthPx(readValue(rule, property), properties);
}

function collectCustomProperties(
  rules: readonly CompiledRule[],
): Map<string, string> {
  const properties = new Map<string, string>();
  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (property.startsWith("--")) {
        properties.set(property, value);
      }
    }
  }
  return properties;
}

const tokenRules = readCompiledRules(`${STYLES_DIRECTORY}/tokens.scss`);
const phoneRootRules = tokenRules.filter(
  (rule) =>
    rule.selector === ":root" &&
    (isOutsideMedia(rule) || isUnderPhoneQuery(rule)),
);
const phoneTokens = collectCustomProperties(phoneRootRules);
const baseRules = readCompiledRules(`${STYLES_DIRECTORY}/base.scss`);

function readNarrowGutterPx(): number {
  const rule = findRule(baseRules, ".main", "--main-gutter", isUnderBleedQuery);
  return readLengthPx(rule, "--main-gutter", phoneTokens);
}

describe("phone wrap model stylesheet lengths", () => {
  it("matches .main's gutter on each side of the bleed query", () => {
    const mainRule = findPhoneRule(baseRules, ".main", "--main-gutter");
    const gutterPx = readLengthPx(mainRule, "--main-gutter", phoneTokens);

    expect(gutterPx).toBe(MAIN_GUTTER_PX);
    expect(readNarrowGutterPx()).toBe(NARROW_MAIN_GUTTER_PX);
  });

  it("matches the chunk card's bleed and its body borders", () => {
    const cardRules = readCompiledRules(
      `${BRIEF_VIEW_DIRECTORY}/StoryView/ChunkCard/ChunkCard.module.scss`,
    );
    const bleedSelector = ":global(.main) .chunk";
    const bleedRule = findRule(
      cardRules,
      bleedSelector,
      "--chunk-bleed",
      isUnderBleedQuery,
    );
    const narrowTokens = new Map(phoneTokens);
    const narrowGutterPx = readNarrowGutterPx();
    narrowTokens.set("--main-gutter", `${String(narrowGutterPx)}px`);
    const bleedPx = readLengthPx(bleedRule, "--chunk-bleed", narrowTokens);
    const bodyRule = findPhoneRule(cardRules, ".body", "border");
    const [borderWidth = ""] = readValue(bodyRule, "border").split(" ");

    expect(bleedPx).toBe(CARD_BLEED_PX);
    expect(2 * resolveLengthPx(borderWidth, phoneTokens)).toBe(CARD_BORDERS_PX);
  });

  it("matches a phone row's code padding, number columns and glyph", () => {
    const rowRules = readCompiledRules(
      `${SRC_DIRECTORY}components/DiffRows/DiffRows.module.scss`,
    );
    const gutterRules = readCompiledRules(
      `${BRIEF_VIEW_DIRECTORY}/DiffTable/RevisionGutterCell/RevisionGutterCell.module.scss`,
    );
    const codeRule = findRule(
      rowRules,
      ".line > .code",
      "padding-inline",
      isUnderPhoneQuery,
    );
    const numberRule = findRule(
      rowRules,
      ".line > .lineNumber",
      "inline-size",
      isUnderPhoneQuery,
    );
    const railRule = findPhoneRule(
      gutterRules,
      ".gutter[data-gutter]",
      "inline-size",
    );
    const lineRule = findPhoneRule(rowRules, ".line", "font-size");
    const paddings = readValue(codeRule, "padding-inline").split(" ");
    const paddingPx = paddings.reduce(
      (total, side) => total + resolveLengthPx(side, phoneTokens),
      0,
    );
    const railPx = readLengthPx(railRule, "inline-size", phoneTokens);
    const numberPx = readLengthPx(numberRule, "inline-size", phoneTokens);
    const fontPx = readLengthPx(lineRule, "font-size", phoneTokens);

    expect(paddingPx).toBe(PHONE_CODE_PADDING_PX);
    expect(railPx + numberPx).toBe(PHONE_UNIFIED_NUMBERS_PX);
    expect(fontPx * PLEX_MONO_ADVANCE_EM).toBeCloseTo(CODE_GLYPH_PX);
  });

  it("matches the split table's rail and number columns", () => {
    const headRules = readCompiledRules(
      `${BRIEF_VIEW_DIRECTORY}/DiffTable/DiffTableHead/DiffTableHead.module.scss`,
    );
    const railRule = findPhoneRule(headRules, ".rail", "inline-size");
    const numberRule = findPhoneRule(headRules, ".number", "inline-size");
    const railPx = readLengthPx(railRule, "inline-size", phoneTokens);
    const numberPx = readLengthPx(numberRule, "inline-size", phoneTokens);

    expect(2 * railPx + 2 * numberPx).toBe(SPLIT_NUMBERS_PX);
  });
});
