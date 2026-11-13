import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ENV_EXAMPLE = join(import.meta.dirname, "..", "..", "..", ".env.example");
/** A commented-out assignment: an optional variable. */
const OPTIONAL_VARIABLE = /^# ([A-Z][A-Z0-9_]*)=/;
const DEFAULT_LABEL = /(Default: \S.*\.|No default\.)$/;

/** The optional variables whose comment line above does not end by naming a default. */
function listUnlabelledVariables(example: string): string[] {
  const lines = example.split("\n");
  const unlabelled: string[] = [];

  lines.forEach((line, index) => {
    const variable = OPTIONAL_VARIABLE.exec(line)?.[1];
    if (variable === undefined) {
      return;
    }
    const lineAbove = lines[index - 1] ?? "";
    if (!DEFAULT_LABEL.test(lineAbove)) {
      unlabelled.push(variable);
    }
  });
  return unlabelled;
}

describe("the env example a release ships", () => {
  it("names the default of every optional variable, or says it has none", () => {
    const example = readFileSync(ENV_EXAMPLE, "utf8");

    expect(example.match(/^# [A-Z][A-Z0-9_]*=/gm)?.length).toBeGreaterThan(30);
    expect(listUnlabelledVariables(example)).toEqual([]);
  });
});
