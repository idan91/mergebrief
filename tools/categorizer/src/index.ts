import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { fetchPr } from "./github.js";
import { categorize } from "./categorize.js";
import { outName, printSummary } from "./output.js";
import type { Brief } from "./types.js";

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
      async (url): Promise<{ url: string; brief: Brief } | { url: string; error: unknown }> => {
        try {
          console.error(`→ ${url}`);
          const pr = await fetchPr(url);
          console.error(`  fetched ${pr.meta.files.length} files from ${url}`);
          return { url, brief: await categorize(pr, client) };
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
    const file = join(OUT_DIR, outName(result.brief));
    await writeFile(file, `${JSON.stringify(result.brief, null, 2)}\n`);
    console.error(`\n  wrote ${file}`);
    console.log("");
    printSummary(result.brief);
  }

  if (failures > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
