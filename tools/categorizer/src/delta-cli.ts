import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fetchCompareDiff,
  fetchLinkedContext,
  fetchPrMetadata,
  fetchReviewComments,
  parsePrUrl,
} from "./github.js";
import { categorizeDelta } from "./categorize.js";
import { AnthropicGenerator } from "./generator.js";
import { splitDiffByFile } from "./diff.js";
import { lookupBriefIndex } from "./manifest.js";
import {
  deltaCommentsName,
  deltaDiffsName,
  deltaOutName,
  prStem,
  printDeltaSummary,
} from "./output.js";

const OUT_DIR = "out";

/** Load tools/categorizer/.env if present; otherwise rely on the ambient env. */
function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file — ANTHROPIC_API_KEY may still be set in the environment
  }
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
    lookupBriefIndex(OUT_DIR, stem, baselineSha),
    lookupBriefIndex(OUT_DIR, stem, headSha),
  ]);
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
    new AnthropicGenerator(),
    log,
  );

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, deltaOutName(delta));
  await writeFile(file, `${JSON.stringify(delta, null, 2)}\n`);
  const diffsFile = join(OUT_DIR, deltaDiffsName(delta));
  const fileDiffs = splitDiffByFile(incrementalDiff);
  await writeFile(diffsFile, `${JSON.stringify(fileDiffs, null, 2)}\n`);
  // Review comments sidecar (display data, +outdated) — ADR 0012; matches brief.
  const commentsFile = join(OUT_DIR, deltaCommentsName(delta));
  await writeFile(commentsFile, `${JSON.stringify(comments, null, 2)}\n`);
  console.error(`\n[${tag}] wrote ${file}`);
  console.error(`[${tag}] wrote ${diffsFile} (${fileDiffs.length} files)`);
  console.error(`[${tag}] wrote ${commentsFile} (${comments.length} comments)`);
  console.log("");
  printDeltaSummary(delta);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
