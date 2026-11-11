import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MOBILE_BREAKPOINT_PX } from "@web/hooks/useMobileViewport";
import {
  compileStylesheet,
  parseCompiledRules,
  type CompiledRule,
} from "@web/test/compiled-css";
import {
  CARD_BORDERS_PX,
  CODE_GLYPH_PX,
  DEFAULT_REM_PX,
  DIFF_ROW_HEIGHT_PX,
  LANDSCAPE_HEAD_SHORTFALL_PX,
  MAIN_GUTTER_PX,
  NARROW_CARD_EDGE_PX,
  NARROW_MAIN_GUTTER_PX,
  PHONE_CODE_PADDING_PX,
  PHONE_UNIFIED_NUMBERS_PX,
  SPLIT_NUMBERS_PX,
} from "./chunk-height-model";
import { CARD_BLEED_QUERY } from "./useWrapColumns";

// The phone wrap model copies these lengths from the stylesheets; nothing
// else in the toolchain compares them.

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
const LANDSCAPE_QUERY = "(orientation: landscape)";
const VAR_REFERENCE = /var\((--[\w-]+)\)/g;
const REM_LENGTH = /(\d*\.?\d+)rem/g;
const PX_LENGTH = /(\d*\.?\d+)px/g;
const ARITHMETIC_TOKEN = /\d*\.?\d+|[()+\-*/]/g;

/** The compiled sheet's style rules, each with the media query around it. */
function readCompiledRules(path: string): CompiledRule[] {
  return parseCompiledRules(compileStylesheet(path));
}

/** The rule's selector list as written, for an exact match. */
function readSelector(rule: CompiledRule): string {
  return rule.selectors.join(", ");
}

function isOutsideMedia(rule: CompiledRule): boolean {
  return rule.media === undefined;
}

function isUnderPhoneQuery(rule: CompiledRule): boolean {
  return PHONE_QUERY.test(rule.media ?? "");
}

function isUnderBleedQuery(rule: CompiledRule): boolean {
  return rule.media === CARD_BLEED_QUERY;
}

function isUnderLandscapeQuery(rule: CompiledRule): boolean {
  return rule.media?.includes(LANDSCAPE_QUERY) === true;
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
      readSelector(rule) === selector &&
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
      readSelector(rule) === selector &&
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
    readSelector(rule) === ":root" &&
    (isOutsideMedia(rule) || isUnderPhoneQuery(rule)),
);
const phoneTokens = collectCustomProperties(phoneRootRules);
const desktopTokens = collectCustomProperties(
  tokenRules.filter(
    (rule) => readSelector(rule) === ":root" && isOutsideMedia(rule),
  ),
);
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

  it("matches the chunk card's bleed edge and its body borders", () => {
    const cardRules = readCompiledRules(
      `${BRIEF_VIEW_DIRECTORY}/StoryView/ChunkCard/ChunkCard.module.scss`,
    );
    const edgeRule = findRule(
      cardRules,
      ":global(.main) .chunk",
      "--chunk-edge",
      isUnderBleedQuery,
    );
    const [edgeFloor = ""] = readValue(edgeRule, "--chunk-edge")
      .replace(/^max\(/, "")
      .split(",");
    const bodyRule = findPhoneRule(cardRules, ".body", "border");
    const [borderWidth = ""] = readValue(bodyRule, "border").split(" ");

    expect(resolveLengthPx(edgeFloor.trim(), phoneTokens)).toBe(
      NARROW_CARD_EDGE_PX,
    );
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

describe("sideways head stylesheet length", () => {
  const chunkCardRules = readCompiledRules(
    `${BRIEF_VIEW_DIRECTORY}/StoryView/ChunkCard/ChunkCard.module.scss`,
  );

  it("parks the sideways head its shortfall under the desktop head", () => {
    const desktop = findRule(
      chunkCardRules,
      ".head",
      "min-block-size",
      isOutsideMedia,
    );
    const sideways = findRule(
      chunkCardRules,
      ".head",
      "block-size",
      isUnderLandscapeQuery,
    );
    const desktopPx = readLengthPx(desktop, "min-block-size", phoneTokens);
    const sidewaysPx = readLengthPx(sideways, "block-size", phoneTokens);

    expect(desktopPx - sidewaysPx).toBe(LANDSCAPE_HEAD_SHORTFALL_PX);
    expect(readValue(sideways, "min-block-size")).toBe("0");
  });
});

describe("diff row stylesheet height", () => {
  it("sets a diff row's line box to the row height the model counts", () => {
    const rowRules = readCompiledRules(
      `${SRC_DIRECTORY}components/DiffRows/DiffRows.module.scss`,
    );
    const fontRule = findRule(rowRules, ".line", "font-size", isOutsideMedia);
    const lineRule = findRule(rowRules, ".line", "line-height", isOutsideMedia);
    const fontPx = readLengthPx(fontRule, "font-size", desktopTokens);
    const lineHeight = readLengthPx(lineRule, "line-height", desktopTokens);

    expect(Math.round(fontPx * lineHeight)).toBe(DIFF_ROW_HEIGHT_PX);
  });
});
