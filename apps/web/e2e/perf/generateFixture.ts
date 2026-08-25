// Deterministic large-brief artifact generator for the perf harness (and any
// consumer needing a big local brief, e.g. list-virtualization work). Emits a
// two-revision artifact set shaped exactly like the committed e2e fixtures —
// the ingest tool's filename grammar — but at
// a size where revision/lens interaction cost is measurable. Output is
// self-validated through the app's own parsers before writing: a drifted
// schema fails generation, never the measurement run.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LineRange } from "../../src/features/brief/types";
import {
  parseBrief,
  parseComparisonMarks,
  parseRevisionNarrativeArtifact,
} from "../../src/features/brief/utils/validation";
import { parseUnifiedDiffPatch } from "../../src/features/brief/utils/diffSlicing";

import {
  PERF_COMPARISON_ID,
  PERF_FIXTURE_REV1_ID,
  PERF_FIXTURE_REV2_ID,
  PERF_SHA_BASE as SHA_BASE,
  PERF_SHA_REV1 as SHA_REV1,
  PERF_SHA_REV2 as SHA_REV2,
} from "./ids";

/** Default scale: large enough to reproduce the lag, small enough to boot. */
const DEFAULT_GROUPS = 12;
const DEFAULT_CHUNKS_PER_GROUP = 25;

const OUT_DIR_DEFAULT = fileURLToPath(new URL("./generated", import.meta.url));

interface Scale {
  groups: number;
  chunksPerGroup: number;
  outDir: string;
}

function parseArgs(argv: string[]): Scale {
  const scale: Scale = {
    groups: DEFAULT_GROUPS,
    chunksPerGroup: DEFAULT_CHUNKS_PER_GROUP,
    outDir: OUT_DIR_DEFAULT,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag ?? ""}`);
    if (flag === "--groups") scale.groups = Number(value);
    else if (flag === "--chunks-per-group")
      scale.chunksPerGroup = Number(value);
    else if (flag === "--out") scale.outDir = resolve(value);
    else throw new Error(`Unknown flag ${flag ?? ""}`);
  }
  if (!Number.isInteger(scale.groups) || scale.groups < 1)
    throw new Error("--groups must be a positive integer");
  if (!Number.isInteger(scale.chunksPerGroup) || scale.chunksPerGroup < 1)
    throw new Error("--chunks-per-group must be a positive integer");
  return scale;
}

/** Deterministic pseudo-variety: stable per index, no RNG. */
const vary = (index: number, span: number): number => (index * 7919) % span;

/** Context rows on each side of a generated hunk. */
const PATCH_CONTEXT = 6;

const chunkFile = (group: number, chunk: number): string =>
  `apps/web/src/perf-fixture/area-${String(group)}/Module${String(chunk)}.ts`;

interface ChunkSpec {
  id: string;
  groupId: string;
  file: string;
  added: number;
  deleted: number;
  addedRanges: LineRange[];
  removedRanges: LineRange[];
  risk: string[];
}

function buildChunkSpecs(scale: Scale): ChunkSpec[] {
  const chunks: ChunkSpec[] = [];
  let n = 0;
  for (let g = 1; g <= scale.groups; g += 1) {
    for (let c = 1; c <= scale.chunksPerGroup; c += 1) {
      n += 1;
      const added = 12 + vary(n, 40);
      const deleted = 2 + vary(n, 14);
      const start = 10 + vary(n, 300);
      let risk: string[] = [];
      if (n % 13 === 0) risk = ["hot-path"];
      else if (n % 7 === 0) risk = ["dense-logic"];
      // Ranges mirror the patch layout exactly (one hunk, adds/dels starting
      // after PATCH_CONTEXT context rows) so the brief's claimed spans and the
      // rendered diff rows agree — the fixture's one job is honest size.
      chunks.push({
        id: `c${String(n)}`,
        groupId: `g${String(g)}`,
        file: chunkFile(g, n),
        added,
        deleted,
        addedRanges: [
          {
            start: start + PATCH_CONTEXT,
            end: start + PATCH_CONTEXT + added - 1,
          },
        ],
        removedRanges: [
          {
            start: start + PATCH_CONTEXT,
            end: start + PATCH_CONTEXT + deleted - 1,
          },
        ],
        risk,
      });
    }
  }
  return chunks;
}

function buildBrief(revision: 1 | 2, scale: Scale, chunks: ChunkSpec[]) {
  const sha = revision === 1 ? SHA_REV1 : SHA_REV2;
  const revTag = `r${String(revision)}`;
  const totalAdded = chunks.reduce((sum, chunk) => sum + chunk.added, 0);
  const totalDeleted = chunks.reduce((sum, chunk) => sum + chunk.deleted, 0);
  return {
    summary: `## Overview\nSynthetic large brief for the perf harness: ${String(
      scale.groups,
    )} change groups over ${String(
      chunks.length,
    )} chunks (${revTag}).\n\n## What it does\n- Exercises revision navigation and lens switching at a size where interaction cost is measurable.\n`,
    changeGroups: Array.from({ length: scale.groups }, (_, index) => {
      const g = index + 1;
      return {
        id: `g${String(g)}`,
        title: `Group ${String(g)}: rework synthetic subsystem area-${String(g)} (${revTag})`,
        summary: `Restructures area-${String(g)} modules: extracts helpers, tightens types, and rewires call sites across ${String(
          scale.chunksPerGroup,
        )} files. Synthetic content for measurement only.`,
        dominantCategory: g % 3 === 0 ? "bugfix" : "new-feature",
        secondaryCategories: [],
        uncertain: false,
        uncertainBetween: [],
      };
    }),
    chunks: chunks.map((chunk) => ({
      id: chunk.id,
      changeGroupId: chunk.groupId,
      file: chunk.file,
      concern: "implementation",
      role: "core",
      loc: { added: chunk.added, deleted: chunk.deleted },
      addedRanges: chunk.addedRanges,
      removedRanges: chunk.removedRanges,
      riskSurface: chunk.risk,
    })),
    concernView: [
      { concern: "implementation", added: totalAdded, deleted: totalDeleted },
    ],
    // Synthetic chunks claim every changed line — fully attributed.
    unattributed: [],
    pr: {
      repo: "mergebrief/perf-fixture",
      number: 1,
      title: "feat: synthetic large change set for perf measurement",
      url: "https://github.com/mergebrief/perf-fixture/pull/1",
      sha,
      description:
        "## Summary\n- Synthetic large PR backing the perf measurement harness.\n",
    },
    index: revision,
    commitRange: { base: SHA_BASE, head: sha },
    generation: {
      provider: "anthropic",
      model: "claude-opus-4-8",
      effort: "medium",
    },
  };
}

/**
 * One well-formed single-hunk unified diff per chunk file. Row layout is the
 * contract `buildChunkSpecs` derives ranges from: PATCH_CONTEXT context rows,
 * then every del row (old side) and every add row (new side), both starting
 * at the same line number, then trailing context.
 */
function buildPatch(chunk: ChunkSpec): string {
  const hunkStart = (chunk.addedRanges[0]?.start ?? 10) - PATCH_CONTEXT;
  const oldCount = PATCH_CONTEXT * 2 + chunk.deleted;
  const newCount = PATCH_CONTEXT * 2 + chunk.added;
  const lines: string[] = [
    `diff --git a/${chunk.file} b/${chunk.file}`,
    "index 1111111..2222222 100644",
    `--- a/${chunk.file}`,
    `+++ b/${chunk.file}`,
    `@@ -${String(hunkStart)},${String(oldCount)} +${String(hunkStart)},${String(newCount)} @@ function synthetic${chunk.id}()`,
  ];
  for (let i = 0; i < PATCH_CONTEXT; i += 1)
    lines.push(` const before${String(i)} = compute(input, ${String(i)});`);
  for (let i = 0; i < chunk.deleted; i += 1)
    lines.push(`-  legacyPath(records[${String(i)}], { strict: false });`);
  for (let i = 0; i < chunk.added; i += 1)
    lines.push(
      `+  nextPath(records[${String(i)}], { strict: true, tag: "${chunk.id}" });`,
    );
  for (let i = 0; i < PATCH_CONTEXT; i += 1)
    lines.push(` const after${String(i)} = finalize(output, ${String(i)});`);
  return `${lines.join("\n")}\n`;
}

function buildComparison(chunks: ChunkSpec[]) {
  return {
    baselineSha: SHA_REV1,
    headSha: SHA_REV2,
    baselineLabel: "previous-brief",
    baselineIndex: 1,
    files: chunks
      .filter((_, index) => index % 3 === 0)
      .map((chunk) => ({
        file: chunk.file,
        addedRanges: chunk.addedRanges.slice(0, 1),
        removedRanges: chunk.removedRanges,
      })),
  };
}

function buildNarrative(scale: Scale, chunks: ChunkSpec[]) {
  const narrated = chunks.filter((_, index) => index % 5 === 0);
  return {
    artifactKind: "revisionNarrative",
    pr: buildBrief(2, scale, chunks).pr,
    prevHeadSha: SHA_REV1,
    headSha: SHA_REV2,
    prevIndex: 1,
    headIndex: 2,
    overview:
      "Synthetic revision narrative: every fifth module picks up a follow-up adjustment between revision 1 and revision 2.",
    generation: {
      provider: "anthropic",
      model: "claude-opus-4-8",
      effort: "medium",
    },
    chunks: narrated.map((chunk, index) => ({
      id: `rc${String(index + 1)}`,
      briefChangeGroupId: chunk.groupId,
      file: chunk.file,
      addedRanges: chunk.addedRanges.slice(0, 1),
      removedRanges: [],
      summary: `Follow-up adjustment to ${chunk.file} between revisions.`,
    })),
  };
}

function buildComments(chunks: ChunkSpec[]) {
  return chunks.slice(0, 3).map((chunk, index) => ({
    id: String(2001 + index),
    file: chunk.file,
    startLine: null,
    line: chunk.addedRanges[0]?.start ?? 1,
    originalStartLine: null,
    originalLine: chunk.addedRanges[0]?.start ?? 1,
    author: "fixture-reviewer",
    body: `Synthetic review comment ${String(index + 1)} for the perf fixture.`,
    inReplyToId: null,
    outdated: false,
  }));
}

function assertOk<T>(
  result: { ok: true; value: T } | { ok: false; error: string },
  what: string,
): T {
  if (!result.ok)
    throw new Error(`Generated ${what} failed validation: ${result.error}`);
  return result.value;
}

async function main(): Promise<void> {
  const scale = parseArgs(process.argv.slice(2));
  const chunks = buildChunkSpecs(scale);

  const rev1 = buildBrief(1, scale, chunks);
  const rev2 = buildBrief(2, scale, chunks);
  const comparison = buildComparison(chunks);
  const narrative = buildNarrative(scale, chunks);

  assertOk(parseBrief(rev1), "revision-1 brief");
  assertOk(parseBrief(rev2), "revision-2 brief");
  assertOk(parseComparisonMarks(comparison), "comparison marks");
  assertOk(parseRevisionNarrativeArtifact(narrative), "revision narrative");

  const diffs = chunks.map((chunk) => ({
    file: chunk.file,
    patch: buildPatch(chunk),
  }));
  for (const diff of diffs) {
    if (parseUnifiedDiffPatch(diff.patch).length === 0)
      throw new Error(`Generated patch for ${diff.file} parsed to zero rows`);
  }

  await rm(scale.outDir, { recursive: true, force: true });
  await mkdir(scale.outDir, { recursive: true });
  const write = (name: string, value: unknown): Promise<void> =>
    writeFile(
      resolve(scale.outDir, name),
      `${JSON.stringify(value, null, 2)}\n`,
    );

  await Promise.all([
    write(`${PERF_FIXTURE_REV1_ID}.brief.json`, rev1),
    write(`${PERF_FIXTURE_REV1_ID}.diffs.json`, diffs),
    write(`${PERF_FIXTURE_REV1_ID}.comments.json`, buildComments(chunks)),
    write(`${PERF_FIXTURE_REV2_ID}.brief.json`, rev2),
    write(`${PERF_FIXTURE_REV2_ID}.diffs.json`, diffs),
    write(`${PERF_FIXTURE_REV2_ID}.comments.json`, buildComments(chunks)),
    write(`${PERF_COMPARISON_ID}.comparison.json`, comparison),
    write(`${PERF_FIXTURE_REV2_ID}.revision-narrative.json`, narrative),
  ]);

  process.stdout.write(
    `Perf fixture written to ${scale.outDir}: ${String(scale.groups)} groups, ${String(chunks.length)} chunks per revision.\n`,
  );
}

await main();
