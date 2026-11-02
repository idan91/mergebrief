import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Brief } from "brief-core/types";
import type { Effort, Generator } from "generators";
import type { Result } from "types";
import { readCaseJson } from "./loadCase";
import { generateBaseBrief, PAIR_FILE, type PairCase } from "./pairs";

/** Refuse, before anything spends, a case that requires a base Brief it does not store. */
export function checkBaseBriefsRecorded(
  pairCases: readonly PairCase[],
): Result<void, string> {
  const unrecorded = pairCases.filter(
    (pairCase) =>
      pairCase.requiresBaseBrief && pairCase.fixture.baseBrief === undefined,
  );
  if (unrecorded.length === 0) {
    return { ok: true, value: undefined };
  }
  const steps = unrecorded.map(
    (pairCase) =>
      `pair case "${pairCase.id}" runs only on a stored baseBrief; record it first: pnpm -C tools/categorizer eval --case ${pairCase.id} --record-base-brief`,
  );
  return { ok: false, error: steps.join("\n") };
}

/** The pair file with `baseBrief` set, written back in the compression it was read in. */
function writeBaseBrief(
  pairCase: PairCase,
  brief: Brief,
): Result<string, string> {
  const caseLabel = `pair case "${pairCase.id}"`;
  const raw = readCaseJson(caseLabel, pairCase.fixtureDir, PAIR_FILE);
  if (!raw.ok) {
    return raw;
  }
  if (typeof raw.value !== "object" || raw.value === null) {
    return { ok: false, error: `${caseLabel}: pair.json is not an object` };
  }

  const text = `${JSON.stringify({ ...raw.value, baseBrief: brief }, null, 2)}\n`;
  const gzippedPath = join(pairCase.fixtureDir, `${PAIR_FILE}.gz`);
  if (existsSync(gzippedPath)) {
    writeFileSync(gzippedPath, gzipSync(text));
    return { ok: true, value: gzippedPath };
  }
  const path = join(pairCase.fixtureDir, PAIR_FILE);
  writeFileSync(path, text);
  return { ok: true, value: path };
}

/**
 * Generate the case's base Brief once, as a run would, and store it in the
 * case's pair file; returns the path written. A twin reads its base case's
 * file, so it records nothing of its own.
 */
export async function recordBaseBrief(
  pairCase: PairCase,
  generator: Generator,
  effort: Effort,
): Promise<Result<string, string>> {
  const caseLabel = `pair case "${pairCase.id}"`;
  if (pairCase.fixtureDir !== pairCase.dir) {
    return {
      ok: false,
      error: `${caseLabel} reads another case's pair.json; record ${basename(pairCase.fixtureDir)} instead`,
    };
  }
  if (pairCase.fixture.baseBrief !== undefined) {
    return { ok: false, error: `${caseLabel} already stores a baseBrief` };
  }

  const brief = await generateBaseBrief(pairCase, generator, effort);
  return writeBaseBrief(pairCase, brief);
}
