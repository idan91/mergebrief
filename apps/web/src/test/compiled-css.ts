import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compile, compileString } from "sass";

const STYLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../styles");
const CLASS_SELECTOR = /\.([A-Za-z_][\w-]*)/g;

/** A style rule from compiled CSS and the media query it sits under. */
export interface CompiledRule {
  media: string | undefined;
  selectors: string[];
  declarations: Map<string, string>;
}

/** Compiles a stylesheet file with the load path vite gives it. */
export function compileStylesheet(path: string): string {
  return compile(path, { loadPaths: [STYLES_DIR] }).css;
}

/** Compiles SCSS source with the load path vite gives it. */
export function compileScss(source: string): string {
  return compileString(source, { loadPaths: [STYLES_DIR] }).css;
}

/** One entry per branch, whitespace dropped, parentheses around a whole branch unwrapped. */
export function normalizeMediaQuery(query: string): string[] {
  return query.split(",").map((branch) => {
    const compact = branch.replace(/\s+/g, "");
    return isWrappedWhole(compact) ? compact.slice(1, -1) : compact;
  });
}

/** Every style rule in compiled CSS, in source order. */
export function parseCompiledRules(css: string): CompiledRule[] {
  const rules: CompiledRule[] = [];
  const preludes: string[] = [];
  let text = "";

  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (char === "{") {
      preludes.push(text.trim());
      text = "";
    } else if (char === "}") {
      const prelude = preludes.pop() ?? "";
      if (!prelude.startsWith("@")) {
        rules.push(buildRule(prelude, text, preludes));
      }
      text = "";
    } else {
      text += char;
    }
  }
  return rules;
}

/** The rules with each class swapped for the name the CSS module gives it. */
export function scopeCompiledRules(
  rules: readonly CompiledRule[],
  classNames: Readonly<Record<string, string>>,
): CompiledRule[] {
  return rules.map((rule) => ({
    ...rule,
    selectors: rule.selectors.map((selector) =>
      selector.replace(
        CLASS_SELECTOR,
        (_match, name: string) => `.${classNames[name] ?? name}`,
      ),
    ),
  }));
}

/**
 * The `property` value the nearest of `element` and its ancestors declares,
 * the last matching rule outside any media query winning: what it inherits.
 */
export function resolveInheritedDeclaration(
  element: Element,
  rules: readonly CompiledRule[],
  property: string,
): string | undefined {
  for (
    let node: Element | null = element;
    node !== null;
    node = node.parentElement
  ) {
    const declared = findLastDeclaration(node, rules, property);
    if (declared !== undefined) {
      return declared;
    }
  }
  return undefined;
}

function findLastDeclaration(
  node: Element,
  rules: readonly CompiledRule[],
  property: string,
): string | undefined {
  const matching = rules.filter(
    (rule) =>
      rule.media === undefined &&
      rule.declarations.has(property) &&
      rule.selectors.some((selector) => node.matches(selector)),
  );
  return matching.at(-1)?.declarations.get(property);
}

function buildRule(
  prelude: string,
  body: string,
  ancestors: string[],
): CompiledRule {
  const media = ancestors.findLast((ancestor) => ancestor.startsWith("@media"));
  const declarations = new Map<string, string>();
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon > 0) {
      const property = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1).replace(/\s+/g, " ");
      declarations.set(property, value.trim());
    }
  }

  return {
    media: media?.replace(/^@media\s+/, ""),
    selectors: prelude.split(",").map((selector) => selector.trim()),
    declarations,
  };
}

function isWrappedWhole(branch: string): boolean {
  if (!branch.startsWith("(")) {
    return false;
  }
  let depth = 0;
  for (let index = 0; index < branch.length; index += 1) {
    const char = branch[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }
    if (depth === 0) {
      return index === branch.length - 1;
    }
  }
  return false;
}
