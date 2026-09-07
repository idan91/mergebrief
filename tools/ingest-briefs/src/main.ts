// The runnable ingest: argv, env and gh subprocess wiring around the core. Pass
// --dir and --target, then either --repo-id for one id across every artifact or
// --resolve-repos to resolve ids and PR lifecycles via `gh api`, with --state
// setting a static lifecycle. DATABASE_URL comes from the environment.
import process from "node:process";
import { closeDb, createDb } from "persistence";
import { parseArgs } from "./args";
import { createRepoResolver } from "./cli/repo-resolver";
import { EXIT_UNMAPPED, writeIngestReport } from "./cli/report";
import { buildTargetContext } from "./cli/scope";
import { ingestBriefDirectory } from "./ingest";

async function main(): Promise<void> {
  const invokerDir = process.env["INIT_CWD"] ?? process.cwd();
  const args = parseArgs(process.argv.slice(2), invokerDir);
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required");
  }

  const handle = createDb(databaseUrl);
  try {
    const summary = await ingestBriefDirectory(handle, {
      dir: args.dir,
      ctx: buildTargetContext(args.target),
      resolveRepo: createRepoResolver(args),
      log: (message) => process.stdout.write(`${message}\n`),
    });

    writeIngestReport(summary, (line) => process.stdout.write(line));
    if (summary.unmapped.length > 0) {
      process.exitCode = EXIT_UNMAPPED;
    }
  } finally {
    await closeDb(handle);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `ingest failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
