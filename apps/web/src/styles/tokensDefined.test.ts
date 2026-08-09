import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// An undefined CSS custom property is invisible at build time — the
// declaration silently drops, or renders its fallback. Nothing else in the
// toolchain catches it, so this test does: every var(...) reference in
// apps/web must resolve to a definition.
//
// A custom property counts as defined when it is
//   1. declared in src/styles/tokens.scss (the global token surface), or
//   2. registered with @property in any global stylesheet, or
//   3. published from non-test TS/TSX at runtime — a setProperty call or a
//      style-object key, or
//   4. declared in the consuming stylesheet itself (component-local tokens).
//
// (4) is file-scoped, not selector-scoped: proving an ancestor selector
// actually matches would need a full cascade model, and the bug class here is
// names that exist nowhere at all. _*.scss partials are the exception — a
// mixin body is inlined into its caller's rule, so a partial legitimately
// reads properties its callers supply; partials are checked against every
// declaration in the app.
//
// The TS scan is deliberately narrow, because a loose one masks the very bug
// it guards: comments are stripped, *.test.ts(x) is excluded, and only
// setProperty arguments and style-object keys count. For the same reason, no
// comment in this file may carry a real token name inside quotes or backticks.

const STYLES_DIR = fileURLToPath(new URL(".", import.meta.url));
const SRC_ROOT = resolve(STYLES_DIR, "..");
const TOKENS_FILE = resolve(STYLES_DIR, "tokens.scss");

const CUSTOM_PROPERTY = "--[a-zA-Z0-9_-]+";
const QUOTE = "[\"'`]";
/** A declaration — never the reference inside var(…), whose preceding
 * character is `(` or `,`. */
const DECLARATION = new RegExp(`(?:^|[;{}\\s])(${CUSTOM_PROPERTY})\\s*:`, "gm");
const AT_PROPERTY = new RegExp(`@property\\s+(${CUSTOM_PROPERTY})`, "g");
const VAR_USAGE = new RegExp(`var\\(\\s*(${CUSTOM_PROPERTY})`, "g");
/** The only two TS forms that WRITE a custom property: a setProperty argument
 * and a style-object key. */
const JS_PUBLISHED = new RegExp(
  `setProperty\\(\\s*${QUOTE}(${CUSTOM_PROPERTY})${QUOTE}` +
    `|${QUOTE}(${CUSTOM_PROPERTY})${QUOTE}\\s*:`,
  "g",
);

/** Blanks out comment bodies while preserving line count, so a token name
 * mentioned in text is never read as a usage or a definition. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/gm, (_match, prefix: string) => prefix);
}

/** Every distinct custom property captured by `pattern`, whichever of its
 * alternatives matched. */
function namesIn(source: string, pattern: RegExp): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    const name = match.slice(1).find((group) => group !== undefined);
    if (name !== undefined) {
      names.add(name);
    }
  }
  return names;
}

function isTestFile(path: string): boolean {
  return /\.test\.tsx?$/.test(path);
}

async function filesUnderSrc(extensions: string[]): Promise<string[]> {
  const entries = await readdir(SRC_ROOT, { recursive: true });
  return entries
    .filter((entry) => extensions.some((suffix) => entry.endsWith(suffix)))
    .map((entry) => resolve(SRC_ROOT, entry))
    .toSorted();
}

interface Usage {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

/** Matches against the WHOLE source, not line by line, so a reference the
 * formatter wrapped across lines is still seen. */
function usagesIn(source: string, file: string): Usage[] {
  const usages: Usage[] = [];
  for (const match of source.matchAll(VAR_USAGE)) {
    const [, name] = match;
    if (name === undefined) {
      continue;
    }
    const line = source.slice(0, match.index).split("\n").length;
    usages.push({ name, file, line });
  }
  return usages;
}

describe("CSS custom properties", () => {
  it("are all defined somewhere the browser can see", async () => {
    const globallyDefined = new Set<string>();

    const tokens = stripComments(await readFile(TOKENS_FILE, "utf8"));
    for (const name of namesIn(tokens, DECLARATION)) {
      globallyDefined.add(name);
    }

    const stylesheets = await filesUnderSrc([".scss"]);
    const sources = new Map<string, string>();
    for (const file of stylesheets) {
      const source = stripComments(await readFile(file, "utf8"));
      sources.set(file, source);
      for (const name of namesIn(source, AT_PROPERTY)) {
        globallyDefined.add(name);
      }
    }

    const tsFiles = await filesUnderSrc([".ts", ".tsx"]);
    for (const file of tsFiles.filter((path) => !isTestFile(path))) {
      const source = stripComments(await readFile(file, "utf8"));
      for (const name of namesIn(source, JS_PUBLISHED)) {
        globallyDefined.add(name);
      }
    }

    const declarationsByFile = new Map<string, Set<string>>();
    for (const [file, source] of sources) {
      declarationsByFile.set(file, namesIn(source, DECLARATION));
    }
    const declaredAnywhere = new Set(
      [...declarationsByFile.values()].flatMap((names) => [...names]),
    );

    const undefinedUsages: string[] = [];
    for (const [file, source] of sources) {
      const isPartial = /(^|\/)_[^/]+\.scss$/.test(file);
      const inScope = isPartial
        ? declaredAnywhere
        : (declarationsByFile.get(file) ?? new Set<string>());
      for (const usage of usagesIn(source, file)) {
        if (globallyDefined.has(usage.name) || inScope.has(usage.name)) {
          continue;
        }
        undefinedUsages.push(
          `${usage.name} used at ${relative(SRC_ROOT, usage.file)}:${usage.line} ` +
            `is never defined — declare it in src/styles/tokens.scss or locally in that file`,
        );
      }
    }

    expect(undefinedUsages).toEqual([]);
  });
});
