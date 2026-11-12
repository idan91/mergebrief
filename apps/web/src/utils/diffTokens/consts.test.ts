import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { GRAMMAR_MODULE_GZIP_BYTES, GRAMMAR_SIBLING_MODULES } from "./consts";
import {
  GrammarNames,
  GrammarSupportModules,
  type GrammarModuleName,
  type GrammarName,
} from "./types";

// A module's cost is its own gzip, never a share of one gzip over a closure.
// A support module the build inlines into its importer costs no more than
// that. Tolerance is wide enough for a patch bump and narrow enough that a grammar
// rewrite trips the gate.
const GZIP_LEVEL = 9;
const TOLERANCE = 0.05;
const MODULE_EXTENSION = ".mjs";
const SIBLING_IMPORT =
  /^import\s+(?:[\w$]+\s+from\s+)?["'](\.\/[\w.-]+\.mjs)["']/gm;
const GRAMMAR_MODULES: GrammarModuleName[] = [
  ...Object.values(GrammarNames),
  ...Object.values(GrammarSupportModules),
];

function resolveGrammarModule(grammar: GrammarName): string {
  const shim = createRequire(import.meta.url).resolve(
    `shiki/langs/${grammar}.mjs`,
  );

  return createRequire(shim).resolve(`@shikijs/langs/${grammar}`);
}

function collectClosure(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) {
    return seen;
  }
  seen.add(entry);

  const source = readFileSync(entry, "utf8");
  for (const match of source.matchAll(SIBLING_IMPORT)) {
    const sibling = match[1];
    if (sibling !== undefined) {
      collectClosure(resolve(dirname(entry), sibling), seen);
    }
  }

  return seen;
}

function readModuleName(file: string): string {
  return basename(file, MODULE_EXTENSION);
}

function listInstalledSiblings(grammar: GrammarName): string[] {
  const closure = collectClosure(resolveGrammarModule(grammar));
  const names = [...closure].map(readModuleName);

  return names.filter((name) => name !== grammar).toSorted();
}

function collectInstalledModules(): Map<string, string> {
  const fileByModule = new Map<string, string>();

  for (const grammar of Object.values(GrammarNames)) {
    for (const file of collectClosure(resolveGrammarModule(grammar))) {
      fileByModule.set(readModuleName(file), file);
    }
  }

  return fileByModule;
}

function measureModuleBytes(file: string): number {
  return gzipSync(readFileSync(file), { level: GZIP_LEVEL }).length;
}

const INSTALLED_MODULES = collectInstalledModules();

describe("GRAMMAR_MODULE_GZIP_BYTES", () => {
  it("records every module the shipped grammars load", () => {
    const installed = [...INSTALLED_MODULES.keys()].toSorted();

    expect(GRAMMAR_MODULES.toSorted()).toEqual(installed);
  });

  it.each(GRAMMAR_MODULES)("matches the installed %s module", (loaded) => {
    const file = INSTALLED_MODULES.get(loaded) ?? "";
    const measured = measureModuleBytes(file);
    const recorded = GRAMMAR_MODULE_GZIP_BYTES[loaded];

    expect(Math.abs(measured - recorded) / recorded).toBeLessThan(TOLERANCE);
  });
});

describe("GRAMMAR_SIBLING_MODULES", () => {
  it.each(Object.values(GrammarNames))(
    "lists the modules the installed %s grammar imports",
    (grammar) => {
      const recorded = GRAMMAR_SIBLING_MODULES[grammar] ?? [];

      expect(recorded.toSorted()).toEqual(listInstalledSiblings(grammar));
    },
  );
});
