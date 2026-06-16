import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  fetchCompareDiff,
  fetchLinkedContext,
  fetchPrMetadata,
  parsePrUrl,
} from "./github.js";
import { categorizeDelta } from "./categorize.js";
import { deltaOutName, printDeltaSummary } from "./output.js";

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
  const [meta, incrementalDiff] = await Promise.all([
    fetchPrMetadata(locator),
    fetchCompareDiff(locator, baselineSha, headSha),
  ]);
  const links = await fetchLinkedContext(meta.body, log);
  log(`fetched ${links.length} linked refs; generating delta…`);

  const client = new Anthropic();
  const delta = await categorizeDelta(
    { locator, meta, baselineSha, headSha, incrementalDiff, links },
    client,
    log,
  );

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, deltaOutName(delta));
  await writeFile(file, `${JSON.stringify(delta, null, 2)}\n`);
  console.error(`\n[${tag}] wrote ${file}`);
  console.log("");
  printDeltaSummary(delta);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
