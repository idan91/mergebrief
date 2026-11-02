import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkBaseBriefsRecorded, recordBaseBrief } from "../eval/base-brief";
import { loadPairCases, type PairCase } from "../eval/pairs";
import { makeBrief } from "./eval-fixtures";
import {
  EXPECTED_TS,
  PREV_HEAD,
  SequenceGenerator,
  makeBriefOutput,
  makePairJson,
  writePairCase,
} from "./pair-fixtures";

const REQUIRES_BASE_BRIEF_TS = `export const requiresBaseBrief = true;\n${EXPECTED_TS}`;
/** A stored base Brief for the base head of `makePairJson`. */
function makeStoredBaseBrief() {
  return makeBrief({
    commitRange: { base: "b".repeat(40), head: PREV_HEAD, commitCount: 1 },
  });
}

const BASE_OUTPUT = makeBriefOutput([
  { id: "g1", title: "alpha", file: "a.ts" },
  { id: "g2", title: "beta", file: "b.ts" },
]);

async function loadCase(root: string, id: string): Promise<PairCase> {
  const loaded = await loadPairCases(root, id);
  if (!loaded.ok || loaded.value[0] === undefined) {
    throw new Error(loaded.ok ? "no case" : loaded.error);
  }
  return loaded.value[0];
}

function readStoredPair(root: string, id: string, fileName: string): unknown {
  const bytes = readFileSync(join(root, id, fileName));
  const text = fileName.endsWith(".gz") ? gunzipSync(bytes) : bytes;
  return JSON.parse(text.toString("utf8"));
}

describe("checkBaseBriefsRecorded", () => {
  it("refuses a case that requires a base brief it does not store", async () => {
    const root = writePairCase("real", REQUIRES_BASE_BRIEF_TS);
    const pairCase = await loadCase(root, "real");

    const checked = checkBaseBriefsRecorded([pairCase]);

    expect(checked.ok).toBe(false);
    expect(!checked.ok && checked.error).toContain(
      "pnpm -C tools/categorizer eval --case real --record-base-brief",
    );
  });

  it("passes a case that stores one or never requires one", async () => {
    const stored = makeStoredBaseBrief();
    const storing = writePairCase(
      "real",
      REQUIRES_BASE_BRIEF_TS,
      makePairJson({ baseBrief: stored }),
    );
    const plain = writePairCase("plain", EXPECTED_TS);
    const cases = [
      await loadCase(storing, "real"),
      await loadCase(plain, "plain"),
    ];

    expect(checkBaseBriefsRecorded(cases)).toEqual({
      ok: true,
      value: undefined,
    });
  });
});

describe("recordBaseBrief", () => {
  it("writes the generated base brief into a gzipped pair file", async () => {
    const root = writePairCase(
      "real",
      REQUIRES_BASE_BRIEF_TS,
      makePairJson(),
      "pair.json.gz",
    );
    const generator = new SequenceGenerator([BASE_OUTPUT]);

    const recorded = await recordBaseBrief(
      await loadCase(root, "real"),
      generator,
      "medium",
    );

    expect(recorded).toEqual({
      ok: true,
      value: join(root, "real", "pair.json.gz"),
    });
    expect(generator.calls).toBe(1);
    expect(readStoredPair(root, "real", "pair.json.gz")).toMatchObject({
      baseBrief: { commitRange: { head: PREV_HEAD } },
    });
    const reloaded = await loadCase(root, "real");
    expect(reloaded.fixture.baseBrief?.changeGroups).toHaveLength(2);
  });

  it("refuses to record over a stored base brief", async () => {
    const stored = makeStoredBaseBrief();
    const root = writePairCase(
      "real",
      EXPECTED_TS,
      makePairJson({ baseBrief: stored }),
    );
    const generator = new SequenceGenerator([BASE_OUTPUT]);

    const recorded = await recordBaseBrief(
      await loadCase(root, "real"),
      generator,
      "medium",
    );

    expect(!recorded.ok && recorded.error).toContain("already stores");
    expect(generator.calls).toBe(0);
  });

  it("refuses a twin, whose pair file belongs to its base case", async () => {
    const root = writePairCase("base", EXPECTED_TS);
    const twinDir = join(root, "base-multi-call");
    mkdirSync(twinDir);
    writeFileSync(
      join(twinDir, "expected.ts"),
      `export const fixtureFrom = "base";\nexport const forceMultiCall = true;\n${EXPECTED_TS}`,
    );
    const generator = new SequenceGenerator([BASE_OUTPUT]);

    const recorded = await recordBaseBrief(
      await loadCase(root, "base-multi-call"),
      generator,
      "medium",
    );

    expect(!recorded.ok && recorded.error).toContain("record base instead");
    expect(generator.calls).toBe(0);
  });
});
