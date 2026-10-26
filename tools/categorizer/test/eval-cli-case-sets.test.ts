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
    privateCasesDir: join(root, "private-cases"),
    privatePairsDir: join(root, "private-pair-cases"),
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
  it("loads shipped and private cases from all four dirs", async () => {
    const dirs = makeLayoutDirs();
    writeSingleCase(dirs.casesDir, "shipped-single");
    writeSingleCase(dirs.privateCasesDir, "private-single");
    writePairCase(dirs.pairsDir, "shipped-pair");
    writePairCase(dirs.privatePairsDir, "private-pair");

    const loaded = await loadCaseSets(dirs);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.singles.map((found) => found.id)).toEqual([
      "private-single",
      "shipped-single",
    ]);
    expect(loaded.value.pairs.map((found) => found.id)).toEqual([
      "private-pair",
      "shipped-pair",
    ]);
  });

  it("treats a missing private dir as an empty list", async () => {
    const dirs = makeLayoutDirs();
    writeSingleCase(dirs.casesDir, "shipped-single");
    writePairCase(dirs.pairsDir, "shipped-pair");

    const loaded = await loadCaseSets(dirs);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.singles.map((found) => found.id)).toEqual([
      "shipped-single",
    ]);
    expect(loaded.value.pairs.map((found) => found.id)).toEqual([
      "shipped-pair",
    ]);
  });

  it("reports a broken private case instead of skipping it", async () => {
    const dirs = makeLayoutDirs();
    writeSingleCase(dirs.casesDir, "shipped-single");
    mkdirSync(join(dirs.privateCasesDir, "no-fixture"), { recursive: true });

    const loaded = await loadCaseSets(dirs);

    expect(loaded.ok).toBe(false);
  });
});
