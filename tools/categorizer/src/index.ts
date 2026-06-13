import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { fetchPr } from "./github.js";
import { categorize } from "./categorize.js";
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

function outName(brief: Brief): string {
  return `${brief.pr.repo.replace("/", "-")}-${brief.pr.number}.brief.json`;
}

function printSummary(brief: Brief): void {
  const byId = new Map(brief.chunks.map((c) => [c.id, c]));
  const lines: string[] = [];
  lines.push(`PR  ${brief.pr.repo}#${brief.pr.number} — ${brief.pr.title}`);
  lines.push(`    ${brief.summary}`);
  lines.push("");

  lines.push(`Change groups (${brief.changeGroups.length}):`);
  for (const g of brief.changeGroups) {
    const secondary = g.secondaryCategories.length
      ? ` (+${g.secondaryCategories.join(", ")})`
      : "";
    const uncertain = g.uncertain
      ? `  ⚠ uncertain: ${g.uncertainBetween.join(" vs ")}`
      : "";
    lines.push(`  • [${g.dominantCategory}]${secondary} ${g.summary}${uncertain}`);
    lines.push(
      `      carriers: ${g.carrierChunkIds.join(", ") || "—"}` +
        `  supporting: ${g.supportingChunkIds.join(", ") || "—"}`,
    );
  }
  lines.push("");

  lines.push(`Concern view (LoC):`);
  for (const r of brief.concernView) {
    lines.push(`  ${r.concern.padEnd(14)} +${r.added} -${r.deleted}`);
  }
  lines.push("");

  const flagged = brief.chunks.filter((c) => c.riskSurface.length > 0);
  lines.push(`Risk-surface flags (${flagged.length}/${brief.chunks.length} chunks):`);
  for (const c of flagged) {
    const chunk = byId.get(c.id);
    lines.push(
      `  ${c.id} ${chunk?.file ?? ""} [${c.role}]: ${c.riskSurface.join(", ")}`,
    );
  }

  console.log(lines.join("\n"));
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
