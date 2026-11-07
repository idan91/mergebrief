import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dropNoTestsOnExemptFiles } from "brief-core";
import type { Brief } from "brief-core/types";
import { loadPairCases } from "../eval/pairs";

const PAIR_CASE_DIRS = [
  fileURLToPath(new URL("../eval/pair-cases", import.meta.url)),
  fileURLToPath(new URL("../eval/private-pair-cases", import.meta.url)),
];
const LOAD_TIMEOUT_MS = 60_000;

interface StoredBaseBrief {
  caseId: string;
  baseBrief: Brief;
}

/** Every stored base Brief once; a twin reads its base case's file. */
async function loadStoredBaseBriefs(): Promise<StoredBaseBrief[]> {
  const stored: StoredBaseBrief[] = [];
  for (const dir of PAIR_CASE_DIRS) {
    const loaded = await loadPairCases(dir);
    if (!loaded.ok) {
      throw new Error(loaded.error);
    }
    for (const pairCase of loaded.value) {
      const { baseBrief } = pairCase.fixture;
      if (baseBrief !== undefined && pairCase.fixtureDir === pairCase.dir) {
        stored.push({ caseId: pairCase.id, baseBrief });
      }
    }
  }
  return stored;
}

/** Chunks the current no-tests exemption would still change, as `case: file`. */
function listStaleNoTestsChunks({
  caseId,
  baseBrief,
}: StoredBaseBrief): string[] {
  const cleared = dropNoTestsOnExemptFiles(baseBrief.chunks);
  return baseBrief.chunks
    .filter((chunk, index) => cleared[index] !== chunk)
    .map((chunk) => `${caseId}: ${chunk.file}`);
}

describe("stored base briefs", () => {
  it(
    "carry no no-tests flag the exemption now clears",
    async () => {
      const stored = await loadStoredBaseBriefs();

      expect(stored.length).toBeGreaterThan(0);
      expect(stored.flatMap(listStaleNoTestsChunks)).toEqual([]);
    },
    LOAD_TIMEOUT_MS,
  );
});
