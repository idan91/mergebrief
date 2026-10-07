import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const OXLINT_BIN = join(
  dirname(require.resolve("oxlint/package.json")),
  "bin/oxlint",
);
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(TEST_DIR, "fixtures");
// Not named `.oxlintrc.json`: oxlint would auto-load it as a nested config
// and re-enable every house rule over the fixtures under the root config.
const FIXTURE_CONFIG = join(TEST_DIR, "fixture-config.json");

export interface Diagnostic {
  readonly rule: string;
  readonly line: number;
}

interface JsonLabel {
  readonly span: { readonly line: number };
}

interface JsonDiagnostic {
  readonly code: string;
  readonly filename: string;
  readonly labels: readonly JsonLabel[];
}

interface JsonReport {
  readonly diagnostics: readonly JsonDiagnostic[];
}

function isJsonReport(value: unknown): value is JsonReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const report = value as { diagnostics?: unknown };
  return Array.isArray(report.diagnostics);
}

/** One oxlint run over the whole fixture tree, grouped by fixture path. */
function collectFixtureDiagnostics(): ReadonlyMap<
  string,
  readonly Diagnostic[]
> {
  const run = spawnSync(
    OXLINT_BIN,
    [
      "-c",
      FIXTURE_CONFIG,
      "--format",
      "json",
      "--disable-nested-config",
      FIXTURES_DIR,
    ],
    { encoding: "utf8" },
  );
  if (run.error) {
    throw run.error;
  }

  const parsed: unknown = JSON.parse(run.stdout);
  if (!isJsonReport(parsed)) {
    throw new Error("oxlint printed no JSON report for the fixtures");
  }

  const byFixture = new Map<string, Diagnostic[]>();

  for (const diagnostic of parsed.diagnostics) {
    const match = /^house\((.+)\)$/.exec(diagnostic.code);
    if (match?.[1] === undefined) {
      continue;
    }

    const key = relative(FIXTURES_DIR, diagnostic.filename);
    const found = byFixture.get(key) ?? [];

    for (const label of diagnostic.labels) {
      found.push({ rule: match[1], line: label.span.line });
    }

    byFixture.set(key, found);
  }

  return byFixture;
}

let cached: ReadonlyMap<string, readonly Diagnostic[]> | undefined;

/**
 * The diagnostics one rule reports for its own fixture, sorted by line. Other
 * house rules are filtered out: a `bad` fixture deliberately breaks the idiom
 * its rule guards, which another rule may also report.
 */
export function lintFixture(rule: string, file: string): Diagnostic[] {
  cached ??= collectFixtureDiagnostics();
  const found = cached.get(join(rule, file)) ?? [];
  return found
    .filter((diagnostic) => diagnostic.rule === rule)
    .toSorted((left, right) => left.line - right.line);
}
