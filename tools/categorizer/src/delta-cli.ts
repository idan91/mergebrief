import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchCompareDiff,
  fetchLinkedContext,
  fetchPrMetadata,
  fetchReviewComments,
  parsePrUrl,
} from "./github.js";
import { categorizeDelta } from "./categorize.js";
import { AnthropicGenerator, type Generator } from "./generator.js";
import { splitDiffByFile } from "./diff.js";
import { lookupBriefIndex } from "./manifest.js";
import { buildComparisonMarks } from "./comparison.js";
import {
  comparisonMarksName,
  deltaCommentsName,
  deltaDiffsName,
  deltaOutName,
  prStem,
  printDeltaSummary,
} from "./output.js";
import type { DeltaBrief } from "./types.js";

const OUT_DIR = "out";

/** Load tools/categorizer/.env if present; otherwise rely on the ambient env. */
function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file — ANTHROPIC_API_KEY may still be set in the environment
  }
}

/**
 * Fetch inputs, write checkpoint comparison marks, generate the Delta, and
 * write its artifacts under `outDir`. Extracted from `main()` (mirroring
 * `index.ts`'s `generateAndWrite`) so the marks-before-LLM-call ordering is
 * directly testable without shelling out to `gh` or hitting the Anthropic API.
 *
 * Marks are written from the incremental diff we already fetched — BEFORE the
 * Delta LLM call — so a failed Delta generation still leaves marks on disk and
 * the FE can show highlights with the honest "summary unavailable" state
 * (ADR 0021/0024 marks-emission rule: no reuse trick keyed on the delta
 * baseline coinciding with a previous-brief head).
 */
export async function generateAndWriteDelta(
  outDir: string,
  url: string,
  baselineSha: string,
  headSha: string,
  generator: Generator,
  log: (msg: string) => void,
): Promise<DeltaBrief> {
  const locator = parsePrUrl(url);

  log(`fetching metadata + compare ${baselineSha.slice(0, 8)}..${headSha.slice(0, 8)}…`);
  const [meta, incrementalDiff, comments] = await Promise.all([
    fetchPrMetadata(locator),
    fetchCompareDiff(locator, baselineSha, headSha),
    fetchReviewComments(locator),
  ]);
  const links = await fetchLinkedContext(meta.body, log);
  // Endpoint brief indices (read-only) for the `_b→_h` label — null if unbriefed.
  const stem = prStem(`${locator.owner}/${locator.repo}`, locator.number);
  const [baselineIndex, headIndex] = await Promise.all([
    lookupBriefIndex(outDir, stem, baselineSha),
    lookupBriefIndex(outDir, stem, headSha),
  ]);

  await mkdir(outDir, { recursive: true });
  const marks = buildComparisonMarks(headSha, baselineSha, "checkpoint", baselineIndex, incrementalDiff);
  const marksFile = join(outDir, comparisonMarksName(stem, marks));
  await writeFile(marksFile, `${JSON.stringify(marks, null, 2)}\n`);
  log(`wrote ${marksFile} (${marks.files.length} files changed since checkpoint)`);

  log(
    `fetched ${links.length} linked refs, ${comments.length} review comments; generating delta…`,
  );

  const delta = await categorizeDelta(
    {
      locator,
      meta,
      baselineSha,
      headSha,
      baselineIndex,
      headIndex,
      incrementalDiff,
      links,
      comments,
    },
    generator,
    log,
  );

  const file = join(outDir, deltaOutName(delta));
  await writeFile(file, `${JSON.stringify(delta, null, 2)}\n`);
  const diffsFile = join(outDir, deltaDiffsName(delta));
  const fileDiffs = splitDiffByFile(incrementalDiff);
  await writeFile(diffsFile, `${JSON.stringify(fileDiffs, null, 2)}\n`);
  // Review comments sidecar (display data, +outdated) — ADR 0012; matches brief.
  const commentsFile = join(outDir, deltaCommentsName(delta));
  await writeFile(commentsFile, `${JSON.stringify(comments, null, 2)}\n`);
  log(`wrote ${file}`);
  log(`wrote ${diffsFile} (${fileDiffs.length} files)`);
  log(`wrote ${commentsFile} (${comments.length} comments)`);
  return delta;
}

async function main(): Promise<void> {
  const [url, baselineSha, headSha] = process.argv.slice(2);
  if (!url || !baselineSha || !headSha) {
    console.error("usage: pnpm delta <pr-url> <baseline-sha> <head-sha>");
    process.exit(1);
  }

  loadEnv();
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error(
      "ANTHROPIC_API_KEY not set — add it to tools/categorizer/.env (see .env.example).",
    );
    process.exit(1);
  }

  const locator = parsePrUrl(url);
  const tag = `${locator.owner}/${locator.repo}#${locator.number}`;
  const log = (msg: string): void => console.error(`[${tag}] ${msg}`);

  const delta = await generateAndWriteDelta(
    OUT_DIR,
    url,
    baselineSha,
    headSha,
    new AnthropicGenerator(),
    log,
  );

  console.log("");
  printDeltaSummary(delta);
}

// Only run the CLI when this file is the process entry point — `generateAndWriteDelta`
// must be importable by tests (and other front doors) without triggering argv
// parsing / process.exit.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
