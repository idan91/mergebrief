import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchCompareDiff,
  fetchLinkedContext,
  fetchPrMetadata,
  fetchReviewComments,
  parsePrUrl,
  resolveFullSha,
} from "../github";
import { categorizeDelta } from "../generation/categorize";
import {
  createGenerator,
  defaultGeneratorConfig,
  loadGeneratorConfigFile,
  type Generator,
} from "generators";
import { extractConfigFlag } from "./config";
import { splitDiffByFile } from "../diff/diff";
import { lookupBriefIndex } from "../artifacts/manifest";
import { buildComparisonMarks, writeComparisonMarks } from "../diff/comparison";
import {
  deltaCommentsName,
  deltaDiffsName,
  deltaOutName,
  prStem,
  printDeltaSummary,
} from "../artifacts/output";
import type { DeltaBrief, Effort } from "../types";

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
  effort?: Effort,
): Promise<DeltaBrief> {
  const locator = parsePrUrl(url);

  // CLI SHAs may arrive abbreviated; artifacts must carry full SHAs or the
  // FE's exact-equality joins (marks -> brief head, delta -> checkpoint
  // marks) silently never match.
  [baselineSha, headSha] = await Promise.all([
    resolveFullSha(locator, baselineSha),
    resolveFullSha(locator, headSha),
  ]);

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

  // Split the incremental diff once: the marks parse and the per-file diffs
  // sidecar below share the same per-file patches.
  const fileDiffs = splitDiffByFile(incrementalDiff);

  await mkdir(outDir, { recursive: true });
  const marks = buildComparisonMarks(headSha, baselineSha, "checkpoint", baselineIndex, fileDiffs);
  await writeComparisonMarks(outDir, stem, marks, log);

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
    effort,
  );

  const file = join(outDir, deltaOutName(delta));
  await writeFile(file, `${JSON.stringify(delta, null, 2)}\n`);
  const diffsFile = join(outDir, deltaDiffsName(delta));
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
  const flagged = extractConfigFlag(process.argv.slice(2));
  const [url, baselineSha, headSha] = flagged ? flagged.rest : [];
  if (!flagged || !url || !baselineSha || !headSha) {
    console.error(
      "usage: pnpm delta [--config <mergebrief.config.yaml>] <pr-url> <baseline-sha> <head-sha>",
    );
    process.exit(1);
  }

  loadEnv();
  // Explicit --config only (no ambient MERGEBRIEF_CONFIG); absent →
  // zero-config default through the registry seam (BRIEF-11).
  const loaded =
    flagged.configPath !== null
      ? loadGeneratorConfigFile(flagged.configPath)
      : { ok: true as const, value: { generator: defaultGeneratorConfig } };
  if (!loaded.ok) {
    console.error(loaded.error.issues.join("; "));
    process.exit(1);
  }
  const constructed = await createGenerator(loaded.value.generator, {
    env: process.env,
    failureDir: OUT_DIR,
  });
  if (!constructed.ok) {
    console.error(
      `${constructed.error.issues.join("; ")} — add it to tools/categorizer/.env (see .env.example).`,
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
    constructed.value,
    log,
    loaded.value.generator.effort,
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
