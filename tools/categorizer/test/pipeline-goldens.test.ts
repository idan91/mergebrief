import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { categorize } from "brief-core";
import type { Brief } from "brief-core/types";
import type { Effort } from "generators";
import { loadCases, type EvalCase, type EvalFixture } from "../eval/loadCase";
import { loadPairCases, runPairCase, type PairCase } from "../eval/pairs";
import {
  makeAdversarialGenerator,
  makeCannedGenerator,
  type CannedGenerator,
  type RecordedRequest,
} from "./canned-generator";

const CASES_DIR = fileURLToPath(new URL("../eval/cases", import.meta.url));
const PAIRS_DIR = fileURLToPath(new URL("../eval/pair-cases", import.meta.url));
const EFFORT: Effort = "medium";
const JSON_INDENT = 2;
const STITCH_WARNING_PREFIX = "anchored stitch: ";
const STITCH_WARNING_FAMILIES = [
  ["claim", "claimed by the model output"],
  ["re-emit", "re-emitted without a new file"],
  ["slip", "treated as a numbering slip"],
  ["departed", "the PR no longer changes it"],
  ["overlap", "both claim"],
  ["ungrouped", "file(s) in no group"],
  ["unattributed", "unattributed to any chunk"],
  ["partition", "references unknown group"],
  ["reading order", "reading order dropped"],
  ["intent", "intent item dropped (dangling group anchor)"],
] as const;
const RISK_ATTRIBUTE_DROP = "dropped comment-contradicts-code";

interface GoldenRun {
  requests: readonly RecordedRequest[];
  output: unknown;
}

interface AdversarialRun {
  revised: Brief;
}

interface TextDigest {
  bytes: number;
  sha256: string;
}

interface RequestDigest {
  label: string;
  system: TextDigest;
  user: TextDigest;
  schema: TextDigest;
}

async function loadSingleCases(): Promise<EvalCase[]> {
  const loaded = await loadCases(CASES_DIR);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }

  return loaded.value;
}

async function loadPairs(): Promise<PairCase[]> {
  const loaded = await loadPairCases(PAIRS_DIR);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }

  return loaded.value;
}

async function runSingleCase(evalCase: EvalCase): Promise<GoldenRun> {
  const { fixture } = evalCase;
  const generator = makeCannedGenerator();

  const brief = await categorize(
    fixture.pr,
    1,
    fixture.commitRange,
    generator,
    () => {},
    fixture.repoContext,
    EFFORT,
  );

  return { requests: generator.requests, output: brief };
}

async function runPair(
  pairCase: PairCase,
  generator: CannedGenerator,
): Promise<GoldenRun> {
  const result = await runPairCase(pairCase, generator, EFFORT, 1);
  const pair = result.pairs[0];
  if (pair === undefined) {
    throw new Error(`${pairCase.id}: ${result.failureMessages.join("; ")}`);
  }

  return {
    requests: generator.requests,
    output: { base: pair.base, revised: pair.revised },
  };
}

async function runAdversarialPair(
  pairCase: PairCase,
  rotation: number,
): Promise<AdversarialRun> {
  const result = await runPairCase(
    pairCase,
    makeAdversarialGenerator(rotation),
    EFFORT,
    1,
  );
  const pair = result.pairs[0];
  if (pair === undefined) {
    throw new Error(`${pairCase.id}: ${result.failureMessages.join("; ")}`);
  }

  return { revised: pair.revised };
}

function digestText(text: string): TextDigest {
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

function digestRequest(request: RecordedRequest): RequestDigest {
  return {
    label: request.label,
    system: digestText(request.system),
    user: digestText(request.user),
    schema: digestText(JSON.stringify(request.wireSchema)),
  };
}

function compareKeys(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const entries = Object.entries(value).toSorted(([left], [right]) =>
    compareKeys(left, right),
  );
  return Object.fromEntries(
    entries.map(([key, inner]) => [key, sortKeys(inner)]),
  );
}

function serializeGolden(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, JSON_INDENT);
}

function hasCustomAttributes(fixture: EvalFixture): boolean {
  return (fixture.repoContext?.customAttributes.length ?? 0) > 0;
}

const singleCases = await loadSingleCases();
const pairCases = await loadPairs();
const caseIds = [...singleCases, ...pairCases].map((found) => found.id);
const customAttributeCaseIds = [
  ...singleCases.filter((found) => hasCustomAttributes(found.fixture)),
  ...pairCases.filter(
    (found) =>
      hasCustomAttributes(found.fixture.base) ||
      hasCustomAttributes(found.fixture.revised),
  ),
].map((found) => found.id);
const pairCaseIds = pairCases.map((found) => found.id);
const runs = new Map<string, GoldenRun>();
const adversarialRuns = new Map<string, AdversarialRun>();

function requireRun(caseId: string): GoldenRun {
  const run = runs.get(caseId);
  if (run === undefined) {
    throw new Error(`no golden run for ${caseId}`);
  }

  return run;
}

function requireAdversarialRun(caseId: string): AdversarialRun {
  const run = adversarialRuns.get(caseId);
  if (run === undefined) {
    throw new Error(`no adversarial run for ${caseId}`);
  }

  return run;
}

function collectAdversarialWarnings(): string[] {
  return [...adversarialRuns.values()].flatMap(
    (run) => run.revised.generationWarnings ?? [],
  );
}

beforeAll(async () => {
  const singleRuns = singleCases.map(async (evalCase) => {
    runs.set(evalCase.id, await runSingleCase(evalCase));
  });
  const pairRuns = pairCases.map(async (pairCase) => {
    runs.set(pairCase.id, await runPair(pairCase, makeCannedGenerator()));
  });
  const adversarialPairRuns = pairCases.map(async (pairCase, rotation) => {
    const run = await runAdversarialPair(pairCase, rotation);
    adversarialRuns.set(pairCase.id, run);
  });

  await Promise.all([...singleRuns, ...pairRuns, ...adversarialPairRuns]);
});

describe("request goldens", () => {
  it.each(caseIds)("%s sends the recorded request digests", (caseId) => {
    const digests = requireRun(caseId).requests.map(digestRequest);

    expect(serializeGolden(digests)).toMatchSnapshot();
  });
});

describe("brief goldens", () => {
  it.each(caseIds)("%s produces the recorded brief", (caseId) => {
    expect(serializeGolden(requireRun(caseId).output)).toMatchSnapshot();
  });
});

describe("wire schema goldens", () => {
  it("covers every fixture that declares custom attributes", () => {
    expect(customAttributeCaseIds).not.toHaveLength(0);
  });

  it.each(customAttributeCaseIds)("%s sends the recorded schema", (caseId) => {
    for (const request of requireRun(caseId).requests) {
      const schema = JSON.stringify(request.wireSchema, null, JSON_INDENT);

      expect(schema).toMatchSnapshot();
    }
  });
});

describe("adversarial stitch goldens", () => {
  it.each(pairCaseIds)("%s stitches the adversarial output", (caseId) => {
    const run = requireAdversarialRun(caseId);

    expect(serializeGolden(run.revised)).toMatchSnapshot();
  });

  it.each(STITCH_WARNING_FAMILIES)(
    "reaches the %s stitch warning",
    (_family, substring) => {
      const stitchWarnings = collectAdversarialWarnings().filter((line) =>
        line.startsWith(STITCH_WARNING_PREFIX),
      );

      expect(stitchWarnings.some((line) => line.includes(substring))).toBe(
        true,
      );
    },
  );

  it("reaches the risk attribute drop", () => {
    const warnings = collectAdversarialWarnings();

    expect(warnings.some((line) => line.includes(RISK_ATTRIBUTE_DROP))).toBe(
      true,
    );
  });
});
