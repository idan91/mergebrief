import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { fetchPr, parsePrUrl } from "./github.js";
import { categorize } from "./categorize.js";
import { splitDiffByFile } from "./diff.js";
import { diffsName, outName, printSummary } from "./output.js";
import type { Brief } from "./types.js";

const OUT_DIR = "out";

/** Short, stable label for log lines: `owner/repo#number`, or the URL if unparseable. */
function prTag(url: string): string {
  try {
    const { owner, repo, number } = parsePrUrl(url);
    return `${owner}/${repo}#${number}`;
  } catch {
    return url;
  }
}

/** Load tools/categorizer/.env if present; otherwise rely on the ambient env. */
function loadEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file — ANTHROPIC_API_KEY may still be set in the environment
  }
}

async function main(): Promise<void> {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("usage: pnpm categorize <pr-url> [<pr-url> …]");
    process.exit(1);
  }

  loadEnv();
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.error(
      "ANTHROPIC_API_KEY not set — add it to tools/categorizer/.env (see .env.example).",
    );
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  // PRs are independent — fetch and categorize them in parallel, sharing one
  // client so the SDK's connection pool is reused. A single bad URL must not
  // kill the whole batch, so each result is captured as success or failure.
  const client = new Anthropic();
  const results = await Promise.all(
    urls.map(
      async (
        url,
      ): Promise<
        | { url: string; brief: Brief; diff: string }
        | { url: string; error: unknown }
      > => {
        // Tag every line with the PR so parallel runs stay legible.
        const tag = prTag(url);
        const log = (msg: string): void => console.error(`[${tag}] ${msg}`);
        try {
          log("fetching diff + metadata…");
          const pr = await fetchPr(url, log);
          log(
            `fetched ${pr.meta.files.length} files, ${pr.links.length} linked refs; categorizing…`,
          );
          const brief = await categorize(pr, client, log);
          return { url, brief, diff: pr.diff };
        } catch (error) {
          return { url, error };
        }
      },
    ),
  );

  // Write + print in input order so output stays deterministic.
  let failures = 0;
  for (const result of results) {
    if ("error" in result) {
      failures++;
      const { error } = result;
      console.error(
        `\n✗ ${result.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const tag = prTag(result.url);
    const briefFile = join(OUT_DIR, outName(result.brief));
    await writeFile(briefFile, `${JSON.stringify(result.brief, null, 2)}\n`);

    // Per-file diffs sidecar, so a UI can show the actual code for each chunk.
    const diffsFile = join(OUT_DIR, diffsName(result.brief));
    const fileDiffs = splitDiffByFile(result.diff);
    await writeFile(diffsFile, `${JSON.stringify(fileDiffs, null, 2)}\n`);

    console.error(`\n[${tag}] wrote ${briefFile}`);
    console.error(`[${tag}] wrote ${diffsFile} (${fileDiffs.length} files)`);
    console.log("");
    printSummary(result.brief);
  }

  if (failures > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
