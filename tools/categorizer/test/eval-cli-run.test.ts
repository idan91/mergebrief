import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Providers, type Generator } from "generators";
import { OutlineForms } from "brief-core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseEvalArgs,
  runEval,
  type BuiltGenerator,
  type EvalArgs,
  type EvalPaths,
} from "../eval/cli";
import { BillingKinds, renderCostLine } from "../eval/report";
import {
  DETAIL_LABEL_PREFIX,
  makeCannedGenerator,
  type RecordedRequest,
} from "./canned-generator";
import { EXPECTED_TS, writePairCase } from "./pair-fixtures";

const SAMPLE_CASE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "eval-case-sample",
);
const CASE_ID = "sample";
const SPOILED_CASE_ID = "spoiled";
const PROPERTY_ID = "has-at-least-one-group";
const FULL_RUNS = 5;
const EFFORT = "medium";
const MILLION_TOKENS = 1_000_000;
const INPUT_PER_MTOK = 2;
const OUTPUT_PER_MTOK = 4;
const PAIR_CASE_ID = "needs-base";
const REQUIRES_BASE_TS = `${EXPECTED_TS}\nexport const requiresBaseBrief = true;\n`;
const ANCHOR_FENCE = "<anchor_brief";
const EXIT_PASSED = 0;
const EXIT_REGRESSED = 1;
const EXIT_REFUSED = 2;

const NEVER_PASSES = `export const properties = [
  { id: "${PROPERTY_ID}", description: "never holds", check: () => false },
];
`;

function makePaths(): EvalPaths {
  const root = mkdtempSync(join(tmpdir(), "eval-cli-run-"));
  const paths = {
    casesDir: join(root, "cases"),
    pairsDir: join(root, "pair-cases"),
    privateCasesDir: join(root, "private-cases"),
    privatePairsDir: join(root, "private-pair-cases"),
    outDir: join(root, "out"),
  };
  mkdirSync(paths.casesDir);
  mkdirSync(paths.pairsDir);
  return paths;
}

function writeSampleCase(paths: EvalPaths, id = CASE_ID): string {
  const caseDir = join(paths.casesDir, id);
  cpSync(SAMPLE_CASE_DIR, caseDir, { recursive: true });
  return caseDir;
}

function parseArgs(argv: string[]): EvalArgs {
  const parsed = parseEvalArgs(argv);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
}

function stubBuilt(generator: Generator = makeCannedGenerator()) {
  const built: BuiltGenerator = { generator, effort: EFFORT };
  return built;
}

function readKey(built: BuiltGenerator): string {
  const origin = built.generator.origin(built.effort);
  return `${origin.provider}:${origin.model}`;
}

function stubFailingGenerator(): Generator {
  const canned = makeCannedGenerator();
  return {
    origin: (effort) => canned.origin(effort),
    generate: () => Promise.reject(new Error("no model in this test")),
  };
}

/** The canned generator, reporting one million tokens each way per call. */
function stubMeteredGenerator() {
  const canned = makeCannedGenerator();
  const generator: Generator = {
    origin: (effort) => canned.origin(effort),
    generate: (request) => {
      request.onUsage?.({
        inputTokens: MILLION_TOKENS,
        outputTokens: MILLION_TOKENS,
        cacheReadTokens: 0,
      });
      return canned.generate(request);
    },
  };
  return { canned, generator };
}

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parsed as Record<string, unknown>;
}

function makeUnmeteredCostLine(built: BuiltGenerator): string {
  return renderCostLine({
    key: readKey(built),
    billing: { kind: BillingKinds.API },
    usage: null,
    costUsd: null,
  });
}

function makeMeteredUsage(calls: number) {
  return {
    calls,
    inputTokens: calls * MILLION_TOKENS,
    outputTokens: calls * MILLION_TOKENS,
    cacheReadTokens: 0,
  };
}

/** The canned generator, keeping the label and effort of every request. */
function stubRecordingGenerator() {
  const canned = makeCannedGenerator();
  const seen: { label: string; effort: string; system: string }[] = [];
  const generator: Generator = {
    origin: (effort) => canned.origin(effort),
    generate: (request) => {
      seen.push({
        label: request.label,
        effort: request.effort,
        system: request.system,
      });
      return canned.generate(request);
    },
  };
  return { generator, seen };
}

function writePrices(paths: EvalPaths, built: BuiltGenerator): string {
  const pricesPath = join(paths.outDir, "..", "prices.json");
  writeFileSync(
    pricesPath,
    JSON.stringify({
      [readKey(built)]: {
        inputPerMTok: INPUT_PER_MTOK,
        outputPerMTok: OUTPUT_PER_MTOK,
        cacheReadPerMTok: 0,
      },
    }),
  );
  return pricesPath;
}

function readErrorLog(): string {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => String(call[0]))
    .join("\n");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runEval case selection", () => {
  it("refuses a --case in neither set before generating", async () => {
    const paths = makePaths();
    writeSampleCase(paths);
    const generator = makeCannedGenerator();

    const code = await runEval(
      parseArgs(["--case", "nope", "--no-baseline"]),
      stubBuilt(generator),
      paths,
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(generator.requests).toEqual([]);
  });

  it("runs only the case --case names", async () => {
    const paths = makePaths();
    writeSampleCase(paths);
    writeSampleCase(paths, "other");

    const code = await runEval(
      parseArgs(["--case", CASE_ID, "--no-baseline", "--runs", "1"]),
      stubBuilt(),
      paths,
    );

    expect(code).toBe(EXIT_PASSED);
    expect(existsSync(join(paths.outDir, "eval-runs", CASE_ID))).toBe(true);
    expect(existsSync(join(paths.outDir, "eval-runs", "other"))).toBe(false);
  });

  it("reports a broken case instead of skipping it", async () => {
    const paths = makePaths();
    writeSampleCase(paths);
    mkdirSync(join(paths.casesDir, "broken"));

    const code = await runEval(
      parseArgs(["--no-baseline"]),
      stubBuilt(),
      paths,
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(readErrorLog()).toContain("broken");
    expect(existsSync(join(paths.outDir, "eval-report.json"))).toBe(false);
  });
});

describe("runEval baseline modes", () => {
  it("--no-baseline scores a case whose baseline has another key", async () => {
    const paths = makePaths();
    const caseDir = writeSampleCase(paths);
    writeFileSync(
      join(caseDir, "baseline.json"),
      JSON.stringify({
        key: "anthropic:some-other-model",
        runs: FULL_RUNS,
        properties: { [PROPERTY_ID]: FULL_RUNS },
      }),
    );
    const generator = makeCannedGenerator();

    const code = await runEval(
      parseArgs(["--no-baseline", "--runs", "1"]),
      stubBuilt(generator),
      paths,
    );

    expect(code).toBe(EXIT_PASSED);
    expect(generator.requests.length).toBeGreaterThan(0);
    const report = readJson(join(paths.outDir, "eval-report.json"));
    expect(report).toMatchObject({ regressions: 0 });
    expect(existsSync(join(paths.outDir, "eval-report.md"))).toBe(true);
  });

  it("refuses a baseline from another key before any spend", async () => {
    const paths = makePaths();
    const caseDir = writeSampleCase(paths);
    writeFileSync(
      join(caseDir, "baseline.json"),
      JSON.stringify({
        key: "anthropic:some-other-model",
        runs: FULL_RUNS,
        properties: { [PROPERTY_ID]: FULL_RUNS },
      }),
    );
    const generator = makeCannedGenerator();

    const code = await runEval(parseArgs([]), stubBuilt(generator), paths);

    expect(code).toBe(EXIT_REFUSED);
    expect(generator.requests).toEqual([]);
    expect(existsSync(join(paths.outDir, "eval-report.json"))).toBe(false);
  });

  it("--rebaseline writes the baseline under the key, and no report", async () => {
    const paths = makePaths();
    const caseDir = writeSampleCase(paths);
    const built = stubBuilt();

    const code = await runEval(
      parseArgs(["--rebaseline", "--runs", "2"]),
      built,
      paths,
    );

    expect(code).toBe(EXIT_PASSED);
    expect(readJson(join(caseDir, "baseline.json"))).toEqual({
      key: readKey(built),
      runs: 2,
      properties: { [PROPERTY_ID]: 2 },
    });
    expect(existsSync(join(paths.outDir, "eval-report.json"))).toBe(false);
    expect(readErrorLog()).toContain("rebaseline complete");
    expect(readErrorLog()).toContain(makeUnmeteredCostLine(built));
  });

  it("--rebaseline refuses to read as done after generation failures", async () => {
    const paths = makePaths();
    const caseDir = writeSampleCase(paths);

    const code = await runEval(
      parseArgs(["--rebaseline", "--runs", "1"]),
      stubBuilt(stubFailingGenerator()),
      paths,
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(existsSync(join(caseDir, "baseline.json"))).toBe(false);
    expect(readErrorLog()).toContain("rebaseline INCOMPLETE");
    expect(readErrorLog()).toContain(CASE_ID);
  });

  it("exits 1 when a property drops below its baseline", async () => {
    const paths = makePaths();
    const caseDir = writeSampleCase(paths, SPOILED_CASE_ID);
    writeFileSync(join(caseDir, "expected.ts"), NEVER_PASSES);
    const built = stubBuilt();
    writeFileSync(
      join(caseDir, "baseline.json"),
      JSON.stringify({
        key: readKey(built),
        runs: FULL_RUNS,
        properties: { [PROPERTY_ID]: FULL_RUNS },
      }),
    );

    const code = await runEval(parseArgs([]), built, paths);

    expect(code).toBe(EXIT_REGRESSED);
    const report = readJson(join(paths.outDir, "eval-report.json"));
    expect(report).toMatchObject({ regressions: 1 });
  });
});

describe("runEval spend reporting", () => {
  it("prices the run's metered tokens from the --prices table", async () => {
    const paths = makePaths();
    writeSampleCase(paths);
    const { canned, generator } = stubMeteredGenerator();
    const built = stubBuilt(generator);
    const pricesPath = writePrices(paths, built);

    const code = await runEval(
      parseArgs(["--no-baseline", "--runs", "1", "--prices", pricesPath]),
      built,
      paths,
    );

    expect(code).toBe(EXIT_PASSED);
    const calls = canned.requests.length;
    const report = readJson(join(paths.outDir, "eval-report.json"));
    expect(calls).toBeGreaterThan(0);
    expect(report["usage"]).toMatchObject({
      calls,
      inputTokens: calls * MILLION_TOKENS,
      outputTokens: calls * MILLION_TOKENS,
    });
    expect(report["costUsd"]).toBe(calls * (INPUT_PER_MTOK + OUTPUT_PER_MTOK));
  });

  it("--rebaseline prints the priced cost line of a metered run", async () => {
    const paths = makePaths();
    writeSampleCase(paths);
    const { canned, generator } = stubMeteredGenerator();
    const built = stubBuilt(generator);
    const pricesPath = writePrices(paths, built);

    await runEval(
      parseArgs(["--rebaseline", "--runs", "1", "--prices", pricesPath]),
      built,
      paths,
    );

    const calls = canned.requests.length;
    const costLine = renderCostLine({
      key: readKey(built),
      billing: { kind: BillingKinds.API },
      usage: makeMeteredUsage(calls),
      costUsd: calls * (INPUT_PER_MTOK + OUTPUT_PER_MTOK),
    });
    expect(readErrorLog()).toContain(costLine);
  });

  it("bills a subscription provider as a subscription", async () => {
    const paths = makePaths();
    writeSampleCase(paths);
    const canned = makeCannedGenerator();
    const generator: Generator = {
      origin: (effort) => ({
        ...canned.origin(effort),
        provider: Providers.CLAUDE_CODE,
      }),
      generate: (request) => canned.generate(request),
    };
    const built = stubBuilt(generator);

    await runEval(parseArgs(["--rebaseline", "--runs", "1"]), built, paths);

    const costLine = renderCostLine({
      key: readKey(built),
      billing: { kind: BillingKinds.SUBSCRIPTION },
      usage: null,
      costUsd: null,
    });
    expect(readErrorLog()).toContain(costLine);
  });

  it("refuses a prices file that will not parse before generating", async () => {
    const paths = makePaths();
    writeSampleCase(paths);
    const pricesPath = join(paths.outDir, "..", "prices.json");
    writeFileSync(pricesPath, "{ not json");
    const generator = makeCannedGenerator();

    const code = await runEval(
      parseArgs(["--no-baseline", "--prices", pricesPath]),
      stubBuilt(generator),
      paths,
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(generator.requests).toEqual([]);
  });

  it("--force-multi-call reaches generation and the report", async () => {
    const paths = makePaths();
    writeSampleCase(paths);
    const generator = makeCannedGenerator();

    await runEval(
      parseArgs(["--no-baseline", "--runs", "1", "--force-multi-call"]),
      stubBuilt(generator),
      paths,
    );

    const labels = generator.requests.map((request) => request.label);
    const report = readJson(join(paths.outDir, "eval-report.json"));
    expect(labels).toContain("grouping");
    expect(report["knobs"]).toEqual(["--force-multi-call"]);
  });

  it("the effort knobs reach the grouping and detail calls", async () => {
    const paths = makePaths();
    writeSampleCase(paths);
    const { generator, seen } = stubRecordingGenerator();

    await runEval(
      parseArgs([
        "--no-baseline",
        "--runs",
        "1",
        "--force-multi-call",
        "--effort-grouping",
        "high",
        "--effort-detail",
        "low",
      ]),
      stubBuilt(generator),
      paths,
    );

    const grouping = seen.filter((request) => request.label === "grouping");
    const detail = seen.filter((request) =>
      request.label.startsWith(DETAIL_LABEL_PREFIX),
    );
    expect(grouping.map((request) => request.effort)).toEqual(["high"]);
    expect(detail.length).toBeGreaterThan(0);
    expect(detail.every((request) => request.effort === "low")).toBe(true);
  });

  it("--force-outline changes what the grouping call is told", async () => {
    const runGrouping = async (extra: string[]) => {
      const paths = makePaths();
      writeSampleCase(paths);
      const { generator, seen } = stubRecordingGenerator();
      await runEval(
        parseArgs([
          "--no-baseline",
          "--runs",
          "1",
          "--force-multi-call",
          ...extra,
        ]),
        stubBuilt(generator),
        paths,
      );
      return seen.find((request) => request.label === "grouping")?.system;
    };

    const whole = await runGrouping(["--force-outline", OutlineForms.FULL]);
    const trimmed = await runGrouping([
      "--force-outline",
      OutlineForms.LINES_12,
    ]);

    expect(whole).toBeDefined();
    expect(trimmed).not.toEqual(whole);
  });

  it("an idle knob is noted on stderr and in the report", async () => {
    const paths = makePaths();
    writeSampleCase(paths);

    await runEval(
      parseArgs(["--no-baseline", "--runs", "1", "--effort-grouping", "high"]),
      stubBuilt(),
      paths,
    );

    const report = readJson(join(paths.outDir, "eval-report.json"));
    expect(readErrorLog()).toContain("have no effect here");
    expect(report["knobNotes"]).toEqual([
      expect.stringContaining("have no effect here"),
    ]);
  });

  it("generates at the configured effort", async () => {
    const paths = makePaths();
    writeSampleCase(paths);
    const { generator, seen } = stubRecordingGenerator();

    await runEval(
      parseArgs(["--no-baseline", "--runs", "1"]),
      { generator, effort: "high" },
      paths,
    );

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((request) => request.effort === "high")).toBe(true);
  });

  it("generates in one call without the knob", async () => {
    const paths = makePaths();
    writeSampleCase(paths);
    const generator = makeCannedGenerator();

    await runEval(
      parseArgs(["--no-baseline", "--runs", "1"]),
      stubBuilt(generator),
      paths,
    );

    const labels = generator.requests.map((request) => request.label);
    expect(labels).not.toContain("grouping");
  });
});

describe("runEval pair cases", () => {
  it("--record-base-brief refuses without a pair case named", async () => {
    const paths = makePaths();
    writeSampleCase(paths);

    const code = await runEval(
      parseArgs(["--record-base-brief", "--case", CASE_ID]),
      stubBuilt(),
      paths,
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(readErrorLog()).toContain("--record-base-brief needs --case");
  });

  it("refuses a pair case with no recorded base brief", async () => {
    const paths = {
      ...makePaths(),
      pairsDir: writePairCase(PAIR_CASE_ID, REQUIRES_BASE_TS),
    };
    const generator = makeCannedGenerator();

    const code = await runEval(
      parseArgs(["--no-baseline", "--case", PAIR_CASE_ID]),
      stubBuilt(generator),
      paths,
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(generator.requests).toEqual([]);
    expect(readErrorLog()).toContain("runs only on a stored baseBrief");
  });

  it("evaluates a pair case into the report", async () => {
    const paths = {
      ...makePaths(),
      pairsDir: writePairCase(PAIR_CASE_ID, EXPECTED_TS),
    };

    const code = await runEval(
      parseArgs(["--no-baseline", "--case", PAIR_CASE_ID, "--runs", "1"]),
      stubBuilt(),
      paths,
    );

    expect(code).toBe(EXIT_PASSED);
    const report = readJson(join(paths.outDir, "eval-report.json"));
    expect(report["cases"]).toEqual([
      expect.objectContaining({ caseId: PAIR_CASE_ID }),
    ]);
  });

  it("--rebaseline refuses to read as done after a pair failure", async () => {
    const paths = {
      ...makePaths(),
      pairsDir: writePairCase(PAIR_CASE_ID, EXPECTED_TS),
    };

    const code = await runEval(
      parseArgs(["--rebaseline", "--case", PAIR_CASE_ID, "--runs", "1"]),
      stubBuilt(stubFailingGenerator()),
      paths,
    );

    expect(code).toBe(EXIT_REFUSED);
    expect(readErrorLog()).toContain("rebaseline INCOMPLETE");
    expect(readErrorLog()).toContain(PAIR_CASE_ID);
    expect(
      existsSync(join(paths.pairsDir, PAIR_CASE_ID, "baseline.json")),
    ).toBe(false);
  });

  it("runs a pair case as many times as --runs asks", async () => {
    const paths = {
      ...makePaths(),
      pairsDir: writePairCase(PAIR_CASE_ID, EXPECTED_TS),
    };

    await runEval(
      parseArgs(["--no-baseline", "--case", PAIR_CASE_ID, "--runs", "2"]),
      stubBuilt(),
      paths,
    );

    const report = readJson(join(paths.outDir, "eval-report.json"));
    expect(report["cases"]).toEqual([
      expect.objectContaining({ runsScored: 2 }),
    ]);
  });

  it("writes pair specimens under the out dir it is given", async () => {
    const paths = {
      ...makePaths(),
      pairsDir: writePairCase(PAIR_CASE_ID, EXPECTED_TS),
    };

    await runEval(
      parseArgs(["--no-baseline", "--case", PAIR_CASE_ID, "--runs", "1"]),
      stubBuilt(),
      paths,
    );

    expect(existsSync(join(paths.outDir, "eval-runs", PAIR_CASE_ID))).toBe(
      true,
    );
  });

  it("anchors a pair run unless --pair-fresh asks otherwise", async () => {
    const anchored = makeCannedGenerator();
    const fresh = makeCannedGenerator();
    const anchoredPaths = {
      ...makePaths(),
      pairsDir: writePairCase(PAIR_CASE_ID, EXPECTED_TS),
    };
    const freshPaths = {
      ...makePaths(),
      pairsDir: writePairCase(PAIR_CASE_ID, EXPECTED_TS),
    };
    const baseArgs = ["--no-baseline", "--case", PAIR_CASE_ID, "--runs", "1"];

    await runEval(parseArgs(baseArgs), stubBuilt(anchored), anchoredPaths);
    await runEval(
      parseArgs([...baseArgs, "--pair-fresh"]),
      stubBuilt(fresh),
      freshPaths,
    );

    const hasAnchorFence = (request: RecordedRequest) =>
      request.user.includes(ANCHOR_FENCE);
    expect(anchored.requests.some(hasAnchorFence)).toBe(true);
    expect(fresh.requests.some(hasAnchorFence)).toBe(false);
  });

  it("--record-base-brief stores the base brief and shows its cost", async () => {
    const paths = {
      ...makePaths(),
      pairsDir: writePairCase(PAIR_CASE_ID, REQUIRES_BASE_TS),
    };
    const built = stubBuilt();

    const code = await runEval(
      parseArgs(["--record-base-brief", "--case", PAIR_CASE_ID]),
      built,
      paths,
    );

    const pair = readJson(join(paths.pairsDir, PAIR_CASE_ID, "pair.json"));
    expect(code).toBe(EXIT_PASSED);
    expect(pair["baseBrief"]).toBeDefined();
    expect(readErrorLog()).toContain("review and commit it");
    expect(readErrorLog()).toContain(makeUnmeteredCostLine(built));
  });

  it("--record-base-brief shows the metered cost of the recording", async () => {
    const paths = {
      ...makePaths(),
      pairsDir: writePairCase(PAIR_CASE_ID, REQUIRES_BASE_TS),
    };
    const { canned, generator } = stubMeteredGenerator();
    const built = stubBuilt(generator);

    await runEval(
      parseArgs(["--record-base-brief", "--case", PAIR_CASE_ID]),
      built,
      paths,
    );

    const costLine = renderCostLine({
      key: readKey(built),
      billing: { kind: BillingKinds.API },
      usage: makeMeteredUsage(canned.requests.length),
      costUsd: null,
    });
    expect(readErrorLog()).toContain(costLine);
  });

  it("--record-base-brief refuses a case already storing one", async () => {
    const paths = {
      ...makePaths(),
      pairsDir: writePairCase(PAIR_CASE_ID, REQUIRES_BASE_TS),
    };
    const args = parseArgs(["--record-base-brief", "--case", PAIR_CASE_ID]);
    await runEval(args, stubBuilt(), paths);
    const generator = makeCannedGenerator();

    const code = await runEval(args, stubBuilt(generator), paths);

    expect(code).toBe(EXIT_REFUSED);
    expect(generator.requests).toEqual([]);
  });
});
