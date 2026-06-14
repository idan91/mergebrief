import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Brief, Chunk } from "./types.js";

interface MovedCommentAnchor {
  commentId: string;
  from: string;
  to: string;
}

interface DeltaBrief {
  previousSha: string;
  currentSha: string;
  summary: string;
  newChunkIds: string[];
  changedChunkIds: string[];
  reopenedRiskFlagIds: string[];
  movedCommentAnchors: MovedCommentAnchor[];
  orphanedCommentIds: string[];
  stillResolvedRiskFlagIds: string[];
}

const OUT_DIR = "out";

async function main(): Promise<void> {
  const briefPath = process.argv[2];
  if (!briefPath) {
    console.error("usage: pnpm make-delta-fixture <out/name.brief.json>");
    process.exit(1);
  }

  const raw = await readFile(briefPath, "utf8");
  const parsedJson: unknown = JSON.parse(raw);
  if (!isBrief(parsedJson)) {
    throw new Error("Expected a categorizer brief JSON file");
  }

  const delta = buildDeltaFixture(parsedJson);
  const outputName = basename(briefPath).replace(/\.brief\.json$/, ".delta.json");
  const outputPath = join(OUT_DIR, outputName);
  await writeFile(outputPath, `${JSON.stringify(delta, null, 2)}\n`);
  console.error(`wrote ${outputPath}`);
}

function buildDeltaFixture(brief: Brief): DeltaBrief {
  const riskyChunks = brief.chunks.filter((chunk) => chunk.riskSurface.length > 0);
  const newChunks = brief.chunks.slice(-2).map((chunk) => chunk.id);
  const changedChunks = brief.chunks.slice(0, 3).map((chunk) => chunk.id);
  const reopenedRiskFlagIds = riskyChunks.slice(0, 2).map((chunk) => riskFlagId(chunk, 0));
  const stillResolvedRiskFlagIds = riskyChunks.slice(2, 5).map((chunk) => riskFlagId(chunk, 0));

  return {
    previousSha: `${brief.pr.sha.slice(0, 8)}-prior`,
    currentSha: brief.pr.sha,
    summary: "Demo re-review state: the author pushed focused follow-up changes after the first review, reopening a few checks and leaving the rest resolved.",
    newChunkIds: newChunks,
    changedChunkIds: changedChunks,
    reopenedRiskFlagIds,
    movedCommentAnchors: [
      { commentId: "comment-demo-moved", from: `${brief.chunks[0]?.file ?? "src/file.ts"}:+12`, to: `${brief.chunks[0]?.file ?? "src/file.ts"}:+18` },
    ],
    orphanedCommentIds: ["comment-demo-orphaned"],
    stillResolvedRiskFlagIds,
  };
}

function riskFlagId(chunk: Chunk, riskIndex: number): string {
  const risk = chunk.riskSurface[riskIndex] ?? "no-tests";
  return `${chunk.id}-${risk}-${riskIndex}`;
}

function isBrief(value: unknown): value is Brief {
  return typeof value === "object" && value !== null && "pr" in value && "chunks" in value && "changeGroups" in value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
