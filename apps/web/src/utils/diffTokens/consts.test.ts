import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { GRAMMAR_GZIP_BYTES } from "./consts";
import { GrammarNames, type GrammarName } from "./types";

// A bundler emits one chunk per grammar module and gzips each on its own, so
// the closure cost is the sum of per-file gzip, never one gzip of the
// concatenation. Tolerance is wide enough for a patch bump and narrow enough
// that a grammar rewrite trips the gate.
const GZIP_LEVEL = 9;
const TOLERANCE = 0.05;
const SIBLING_IMPORT =
  /^import\s+(?:[\w$]+\s+from\s+)?["'](\.\/[\w.-]+\.mjs)["']/gm;

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

function measureGrammarBytes(grammar: GrammarName): number {
  const files = collectClosure(resolveGrammarModule(grammar));
  let total = 0;

  for (const file of files) {
    total += gzipSync(readFileSync(file), { level: GZIP_LEVEL }).length;
  }

  return total;
}

describe("GRAMMAR_GZIP_BYTES", () => {
  it("names every grammar we ship a loader for", () => {
    expect(Object.keys(GRAMMAR_GZIP_BYTES).toSorted()).toEqual(
      Object.values(GrammarNames).toSorted(),
    );
  });

  it.each(Object.values(GrammarNames))(
    "matches the installed %s closure",
    (grammar) => {
      const measured = measureGrammarBytes(grammar);
      const recorded = GRAMMAR_GZIP_BYTES[grammar];

      expect(Math.abs(measured - recorded) / recorded).toBeLessThan(TOLERANCE);
    },
  );
});
