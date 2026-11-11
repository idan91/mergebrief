import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  type CompiledRule,
} from "@web/test/compiled-css";

// Element opacity dims the element's own outline, so a disabled control that
// stays focusable and dims with opacity would draw a dimmed focus ring.

const TEST_FILE = fileURLToPath(import.meta.url);
const SOURCE_DIRECTORY = join(dirname(TEST_FILE), "..");
const MODULE_SUFFIX = ".module.scss";
const COMBINATOR = /\s*[\s>+~]\s*/;
const DISABLED_STATE = /disabled|unavailable/;
const NATIVE_DISABLED = /:disabled\b/;
const FOCUS_VISIBLE = /:focus-visible/g;
const FULL_OPACITY = "1";
const DIMMED_PAINT = "var(--opacity-disabled)";

function listModuleStylesheets(): string[] {
  return readdirSync(SOURCE_DIRECTORY, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(MODULE_SUFFIX))
    .map((path) => join(SOURCE_DIRECTORY, path))
    .toSorted();
}

function readLastCompound(selector: string): string {
  return selector.split(COMBINATOR).at(-1) ?? "";
}

function isDimmedDisabled(rule: CompiledRule, selector: string): boolean {
  const opacity = rule.declarations.get("opacity");
  const dimmed = opacity !== undefined && opacity !== FULL_OPACITY;
  const disabledState = DISABLED_STATE.test(readLastCompound(selector));
  return dimmed && disabledState;
}

function isFocusRepaint(rule: CompiledRule): boolean {
  const undimmed = rule.declarations.get("opacity") === FULL_OPACITY;
  const ink =
    rule.declarations.get("color") ??
    rule.declarations.get("-webkit-text-fill-color") ??
    "";
  const dimmedInk = ink.includes(DIMMED_PAINT);
  return undimmed && dimmedInk;
}

function isFocusedForm(selector: string, dimmed: string): boolean {
  const unfocused = selector.replace(FOCUS_VISIBLE, "");
  const focused = unfocused !== selector;
  const sameControl = unfocused.endsWith(dimmed);
  return focused && sameControl;
}

function hasFocusRepaint(
  rules: readonly CompiledRule[],
  dimmed: string,
): boolean {
  const repaints = rules.filter(isFocusRepaint);
  return repaints.some((rule) =>
    rule.selectors.some((selector) => isFocusedForm(selector, dimmed)),
  );
}

function isChildDim(rule: CompiledRule, focused: string): boolean {
  const opacity = rule.declarations.get("opacity");
  const dimsChildren = rule.selectors.includes(`:where(${focused}) > *`);
  return dimsChildren && opacity === DIMMED_PAINT;
}

function hasChildDim(rules: readonly CompiledRule[], dimmed: string): boolean {
  const focusedForms = rules
    .flatMap((rule) => rule.selectors)
    .filter((selector) => isFocusedForm(selector, dimmed));
  return focusedForms.some((focused) =>
    rules.some((rule) => isChildDim(rule, focused)),
  );
}

function findDimmedSelectors(rules: readonly CompiledRule[]): string[] {
  return rules
    .flatMap((rule) =>
      rule.selectors.filter((selector) => isDimmedDisabled(rule, selector)),
    )
    .filter((selector) => !NATIVE_DISABLED.test(selector));
}

function findUndimmedChildrenInFile(path: string): string[] {
  const rules = parseCompiledRules(compileStylesheet(path));
  const relative = path.slice(SOURCE_DIRECTORY.length + 1);

  return findDimmedSelectors(rules)
    .filter((selector) => !hasChildDim(rules, selector))
    .map((selector) => `${relative} ${selector}`);
}

function isFocusedDisabled(selector: string): boolean {
  const focused = selector.includes(":focus-visible");
  return focused && DISABLED_STATE.test(selector);
}

function findInheritedDimsInFile(path: string): string[] {
  const rules = parseCompiledRules(compileStylesheet(path));
  const relative = path.slice(SOURCE_DIRECTORY.length + 1);
  const inherited = rules.filter((rule) => {
    const color = rule.declarations.get("color") ?? "";
    const focused = rule.selectors.some(isFocusedDisabled);
    return focused && color.includes(DIMMED_PAINT);
  });

  return inherited.map((rule) => `${relative} ${rule.selectors.join()}`);
}

function findDimmedRingsInFile(path: string): string[] {
  const rules = parseCompiledRules(compileStylesheet(path));
  const relative = path.slice(SOURCE_DIRECTORY.length + 1);
  const dimmedSelectors = rules.flatMap((rule) =>
    rule.selectors.filter((selector) => isDimmedDisabled(rule, selector)),
  );

  return dimmedSelectors
    .filter((selector) => !NATIVE_DISABLED.test(selector))
    .filter((selector) => !hasFocusRepaint(rules, selector))
    .map((selector) => `${relative} ${selector}`);
}

function isTransitioningDim(rule: CompiledRule): boolean {
  const dims = rule.selectors.some((selector) =>
    isDimmedDisabled(rule, selector),
  );
  const transitions = rule.declarations.get("transition") !== "none";
  return dims && transitions;
}

function findTransitioningDimsInFile(path: string): string[] {
  const rules = parseCompiledRules(compileStylesheet(path));
  const relative = path.slice(SOURCE_DIRECTORY.length + 1);
  const transitioning = rules.filter(isTransitioningDim);

  return transitioning.map((rule) => `${relative} ${rule.selectors.join()}`);
}

describe("dimmed disabled controls", () => {
  it("keep the ring whole and the paint dimmed while focused", () => {
    const dimmedRings = listModuleStylesheets().flatMap(findDimmedRingsInFile);

    expect(dimmedRings).toEqual([]);
  });

  it("dim every child while focused, whatever ink the child sets", () => {
    const undimmed = listModuleStylesheets().flatMap(
      findUndimmedChildrenInFile,
    );

    expect(undimmed).toEqual([]);
  });

  it("never dim the ink children inherit while focused", () => {
    const inherited = listModuleStylesheets().flatMap(findInheritedDimsInFile);

    expect(inherited).toEqual([]);
  });

  it("swap opacity and paint in one frame, with no transition", () => {
    const transitioning = listModuleStylesheets().flatMap(
      findTransitioningDimsInFile,
    );

    expect(transitioning).toEqual([]);
  });
});
