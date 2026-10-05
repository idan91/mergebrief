import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPORT_MARKER = "// reports";

export const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

export interface Fixture {
  readonly code: string;
  readonly filename: string;
}

type MarkedLines = readonly number[];

export function readFixture(rule: string, file: string): Fixture {
  const filename = join(FIXTURES_DIR, rule, file);
  return { code: readFileSync(filename, "utf8"), filename };
}

/**
 * The 1-based lines a bad fixture marks with a trailing `// reports`. A bad
 * fixture marking none throws, so it can never pass on zero diagnostics.
 */
export function readMarkedLines(rule: string, file: string): MarkedLines {
  const { code } = readFixture(rule, file);
  const marked: number[] = [];

  for (const [index, line] of code.split("\n").entries()) {
    const reports = line.trimEnd().endsWith(REPORT_MARKER);
    if (reports) {
      marked.push(index + 1);
    }
  }

  if (marked.length === 0) {
    throw new Error(
      `fixture ${rule}/${file} marks no line with ${REPORT_MARKER}`,
    );
  }
  return marked;
}
