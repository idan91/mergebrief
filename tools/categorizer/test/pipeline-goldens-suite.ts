import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { generateBrief, type GenerateBriefOptions } from "brief-core";
import type { Brief } from "brief-core/types";
import type { Effort, Generator } from "generators";
import { loadCases, type EvalCase, type EvalFixture } from "../eval/loadCase";
import { loadPairCases, runPairCase, type PairCase } from "../eval/pairs";
import {
  DETAIL_LABEL_PREFIX,
  makeAdversarialGenerator,
  makeCannedGenerator,
  type CannedGenerator,
  type RecordedRequest,
} from "./canned-generator";

const EFFORT: Effort = "medium";
const JSON_INDENT = 2;
const STITCH_WARNING_PREFIX = "⚠ anchored stitch issues:\n";
const STITCH_WARNING_FAMILIES = [
  ["claim", "claimed by the model output"],
  ["re-emit", "re-emitted without a new file"],
  ["slip", "treated as a numbering slip"],
  ["departed", "the PR no longer changes it"],
] as const;
const VALIDATION_WARNING_FAMILIES = [
  ["unknown group", "⚠ unknown group issues:\n", "names unknown group"],
  ["overlap", "⚠ loc overlap issues:\n", "both claim"],
  ["ungrouped", "⚠ loc coverage issues:\n", "file(s) in no group"],
  ["unattributed", "⚠ loc coverage issues:\n", "unattributed to any chunk"],
  ["reading order", "⚠ reading order issues:\n", "references unknown group"],
  ["intent", "⚠ intent check issues:\n", "has no valid group anchor"],
] as const;
const VALIDATION_SUBSTRINGS = VALIDATION_WARNING_FAMILIES.map(
  ([, , substring]) => substring,
);
const CHECK_PREFIX = /^⚠ (.+?) issues:\n/;
const RISK_ATTRIBUTE_DROP = "dropped comment-contradicts-code";
/** A brief golden past this records its digest: a large case's brief is unreviewable as text. */
const BRIEF_GOLDEN_MAX_BYTES = 64 * 1024;
/** The large cases' multi-call runs take seconds each, past vitest's 10 s hook default. */
const GOLDEN_RUNS_TIMEOUT_MS = 120_000;

export interface GoldenSuiteOptions {
  casesDir: string;
  pairsDir: string;
  /** The corpus must reach every stitch and validation warning family. */
  requiresEveryWarningFamily: boolean;
}

export interface GoldenCorpus {
  singleCases: readonly EvalCase[];
  pairCases: readonly PairCase[];
}

interface GoldenRun {
  requests: readonly RecordedRequest[];
  output: unknown;
}

interface AnchoringGolden {
  baseGroupIds: readonly string[];
  frozenGroupIds: readonly string[];
  reLook: readonly { id: string; reason: string | undefined }[];
  previousGroupIds: readonly string[];
  carriedChunkIds: readonly string[];
  carriedGroupIds: readonly string[];
  regeneratedGroupIds: readonly string[];
  groupIds: readonly string[];
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
  userPrefix?: TextDigest;
  user: TextDigest;
  schema: TextDigest;
}

type GoldenRuns = ReadonlyMap<string, GoldenRun>;
type AdversarialRuns = ReadonlyMap<string, AdversarialRun>;

async function loadSingleCases(casesDir: string): Promise<EvalCase[]> {
  const loaded = await loadCases(casesDir);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }

  return loaded.value;
}

async function loadPairs(pairsDir: string): Promise<PairCase[]> {
  const loaded = await loadPairCases(pairsDir);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }

  return loaded.value;
}

function makeOptions(
  fixture: EvalFixture,
  headIndex: number,
  generator: Generator,
): GenerateBriefOptions {
  return {
    pr: fixture.pr,
    headIndex,
    commitRange: fixture.commitRange,
    generator,
    effort: EFFORT,
    repoContext: fixture.repoContext,
    multiCallHooks: {},
  };
}

async function runSingleCase(evalCase: EvalCase): Promise<GoldenRun> {
  const { fixture } = evalCase;
  const generator = makeCannedGenerator();

  const { brief } = await generateBrief(makeOptions(fixture, 1, generator));

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

async function runAnchoring(
  pairCase: PairCase,
  chainGroupIds: readonly string[],
): Promise<AnchoringGolden> {
  const { fixture } = pairCase;
  const generator = makeCannedGenerator();

  const base = await generateBrief(makeOptions(fixture.base, 1, generator));
  const revised = await generateBrief({
    ...makeOptions(fixture.revised, 2, generator),
    previous: { brief: base.brief, ...fixture.increment, chainGroupIds },
  });
  if (revised.anchoring === undefined) {
    throw new Error(`${pairCase.id}: the anchored run returned no anchoring`);
  }

  const { plan, ...carry } = revised.anchoring;
  return {
    baseGroupIds: base.brief.changeGroups.map((group) => group.id),
    frozenGroupIds: plan.frozen.map((frozen) => frozen.group.id),
    reLook: plan.reLook.map(({ id, reason }) => ({ id, reason })),
    previousGroupIds: plan.previousGroupIds,
    carriedChunkIds: carry.carriedChunkIds,
    carriedGroupIds: carry.carriedGroupIds,
    regeneratedGroupIds: carry.regeneratedGroupIds,
    groupIds: revised.brief.changeGroups.map((group) => group.id),
  };
}

function listMintedGroupIds(golden: AnchoringGolden): string[] {
  return golden.regeneratedGroupIds.filter(
    (id) => !golden.baseGroupIds.includes(id),
  );
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
  const digest: RequestDigest = {
    label: request.label,
    system: digestText(request.system),
    user: digestText(request.user),
    schema: digestText(JSON.stringify(request.wireSchema)),
  };
  if (request.userPrefix !== undefined) {
    digest.userPrefix = digestText(request.userPrefix);
  }

  return digest;
}

function isDetailRequest(request: RecordedRequest): boolean {
  return request.label.startsWith(DETAIL_LABEL_PREFIX);
}

/** Detail calls run in a pool, so their call order is scheduling; they are listed by part key after the rest. */
function orderRequests(
  requests: readonly RecordedRequest[],
): RecordedRequest[] {
  const details = requests
    .filter(isDetailRequest)
    .toSorted((left, right) =>
      left.label.localeCompare(right.label, "en", { numeric: true }),
    );
  const others = requests.filter((request) => !isDetailRequest(request));

  return [...others, ...details];
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

function shapeBriefGolden(output: unknown): string {
  const serialized = serializeGolden(output);
  const fitsInline =
    Buffer.byteLength(serialized, "utf8") <= BRIEF_GOLDEN_MAX_BYTES;

  return fitsInline ? serialized : serializeGolden(digestText(serialized));
}

function requireRun(runs: GoldenRuns, caseId: string): GoldenRun {
  const run = runs.get(caseId);
  if (run === undefined) {
    throw new Error(`no golden run for ${caseId}`);
  }

  return run;
}

function requireAdversarialRun(
  adversarialRuns: AdversarialRuns,
  caseId: string,
): AdversarialRun {
  const run = adversarialRuns.get(caseId);
  if (run === undefined) {
    throw new Error(`no adversarial run for ${caseId}`);
  }

  return run;
}

function collectAdversarialWarnings(
  adversarialRuns: AdversarialRuns,
): string[] {
  return [...adversarialRuns.values()].flatMap(
    (run) => run.revised.generationWarnings ?? [],
  );
}

function describeRequestGoldens(
  caseIds: readonly string[],
  runs: GoldenRuns,
): void {
  describe("request goldens", () => {
    it.each(caseIds)("%s sends the recorded request digests", (caseId) => {
      const requests = orderRequests(requireRun(runs, caseId).requests);
      const digests = requests.map(digestRequest);

      expect(serializeGolden(digests)).toMatchSnapshot();
    });
  });
}

function describeBriefGoldens(
  caseIds: readonly string[],
  runs: GoldenRuns,
): void {
  describe("brief goldens", () => {
    it.each(caseIds)("%s produces the recorded brief", (caseId) => {
      const run = requireRun(runs, caseId);

      expect(shapeBriefGolden(run.output)).toMatchSnapshot();
    });
  });
}

function describeAnchoringGoldens(pairCases: readonly PairCase[]): void {
  describe("anchoring goldens", () => {
    it.each(pairCases)(
      "$id records the plan and the carried set",
      async (pairCase) => {
        const golden = await runAnchoring(pairCase, []);

        expect(serializeGolden(golden)).toMatchSnapshot();
      },
    );

    it("skips reserved chain ids when descent mints a group id", async () => {
      const unchained = await Promise.all(
        pairCases.map(async (pairCase) => ({
          pairCase,
          minted: listMintedGroupIds(await runAnchoring(pairCase, [])),
        })),
      );
      const minting = unchained.find((found) => found.minted.length > 0);
      if (minting === undefined) {
        throw new Error("no pair case mints a group id under descent");
      }

      const chained = await runAnchoring(minting.pairCase, minting.minted);

      expect(chained.previousGroupIds).toEqual(
        expect.arrayContaining(minting.minted),
      );
      expect(
        chained.groupIds.filter((id) => minting.minted.includes(id)),
      ).toEqual([]);
      expect(
        serializeGolden({ caseId: minting.pairCase.id, chained }),
      ).toMatchSnapshot();
    });
  });
}

function describeWarningFamilyReach(adversarialRuns: AdversarialRuns): void {
  it.each(STITCH_WARNING_FAMILIES)(
    "reaches the %s stitch warning",
    (_family, substring) => {
      const stitchWarnings = collectAdversarialWarnings(adversarialRuns).filter(
        (line) => line.startsWith(STITCH_WARNING_PREFIX),
      );

      expect(stitchWarnings.some((line) => line.includes(substring))).toBe(
        true,
      );
    },
  );

  it.each(VALIDATION_WARNING_FAMILIES)(
    "reaches the %s warning from the final validation",
    (_family, prefix, substring) => {
      const checkWarnings = collectAdversarialWarnings(adversarialRuns).filter(
        (line) => line.startsWith(prefix),
      );

      expect(checkWarnings.some((line) => line.includes(substring))).toBe(true);
    },
  );

  it("reaches the risk attribute drop", () => {
    const warnings = collectAdversarialWarnings(adversarialRuns);

    expect(warnings.some((line) => line.includes(RISK_ATTRIBUTE_DROP))).toBe(
      true,
    );
  });
}

function describeAdversarialGoldens(
  pairCaseIds: readonly string[],
  adversarialRuns: AdversarialRuns,
  requiresEveryWarningFamily: boolean,
): void {
  describe("adversarial stitch goldens", () => {
    it.each(pairCaseIds)("%s stitches the adversarial output", (caseId) => {
      const run = requireAdversarialRun(adversarialRuns, caseId);

      expect(serializeGolden(run.revised)).toMatchSnapshot();
    });

    if (requiresEveryWarningFamily) {
      describeWarningFamilyReach(adversarialRuns);
    }

    it("keeps validation findings off the stitch line", () => {
      const stitchWarnings = collectAdversarialWarnings(adversarialRuns).filter(
        (line) => line.startsWith(STITCH_WARNING_PREFIX),
      );

      for (const substring of VALIDATION_SUBSTRINGS) {
        expect(
          stitchWarnings.filter((line) => line.includes(substring)),
        ).toEqual([]);
      }
    });

    it("reports each check at most once per brief", () => {
      for (const run of adversarialRuns.values()) {
        const checks = (run.revised.generationWarnings ?? []).flatMap(
          (line) => {
            const check = CHECK_PREFIX.exec(line)?.[1];
            return check === undefined ? [] : [check];
          },
        );

        expect(checks).toEqual([...new Set(checks)]);
      }
    });
  });
}

/**
 * Registers the goldens over one case-dir pair against the calling test
 * file's snapshot. The adversarial rotation is a pair's index in this
 * corpus, so a corpus change moves the adversarial goldens after it.
 */
export async function describePipelineGoldens(
  options: GoldenSuiteOptions,
): Promise<GoldenCorpus> {
  const singleCases = await loadSingleCases(options.casesDir);
  const pairCases = await loadPairs(options.pairsDir);
  const caseIds = [...singleCases, ...pairCases].map((found) => found.id);
  const pairCaseIds = pairCases.map((found) => found.id);
  const runs = new Map<string, GoldenRun>();
  const adversarialRuns = new Map<string, AdversarialRun>();

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
  }, GOLDEN_RUNS_TIMEOUT_MS);

  describeRequestGoldens(caseIds, runs);
  describeBriefGoldens(caseIds, runs);
  describeAnchoringGoldens(pairCases);
  describeAdversarialGoldens(
    pairCaseIds,
    adversarialRuns,
    options.requiresEveryWarningFamily,
  );

  return { singleCases, pairCases };
}
