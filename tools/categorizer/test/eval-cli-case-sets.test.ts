import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCaseSets, type CaseSetDirs } from "../eval/cli";

const SAMPLE_CASE_DIR = fileURLToPath(
  new URL("fixtures/eval-case-sample", import.meta.url),
);
const SAMPLE_PAIR_JSON = fileURLToPath(
  new URL("../eval/pair-cases/pair-additive/pair.json", import.meta.url),
);
const SCRATCH_PREFIX = join(tmpdir(), "eval-case-sets-");
const PAIR_EXPECTED_TS = `
export const pairProperties = [
  { id: "always", description: "always passes", check: () => true },
];
`;

function makeLayoutDirs(): CaseSetDirs {
  const root = mkdtempSync(SCRATCH_PREFIX);

  return {
    casesDir: join(root, "cases"),
    pairsDir: join(root, "pair-cases"),
  };
}

function writeSingleCase(dir: string, id: string): void {
  cpSync(SAMPLE_CASE_DIR, join(dir, id), { recursive: true });
}

function writePairCase(dir: string, id: string): void {
  const caseDir = join(dir, id);
  mkdirSync(caseDir, { recursive: true });
  cpSync(SAMPLE_PAIR_JSON, join(caseDir, "pair.json"));
  writeFileSync(join(caseDir, "expected.ts"), PAIR_EXPECTED_TS);
}

describe("loadCaseSets", () => {
  it("loads the single and pair cases, sorted by id", async () => {
    const dirs = makeLayoutDirs();
    writeSingleCase(dirs.casesDir, "single-b");
    writeSingleCase(dirs.casesDir, "single-a");
    writePairCase(dirs.pairsDir, "pair-b");
    writePairCase(dirs.pairsDir, "pair-a");

    const loaded = await loadCaseSets(dirs);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.singles.map((found) => found.id)).toEqual([
      "single-a",
      "single-b",
    ]);
    expect(loaded.value.pairs.map((found) => found.id)).toEqual([
      "pair-a",
      "pair-b",
    ]);
  });
});
