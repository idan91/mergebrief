// The runnable ingest: argv + env + gh subprocess wiring around the core.
//
//   pnpm -C tools/ingest-briefs ingest -- \
//     --dir tools/categorizer/out \
//     --target user:<github-user-id> | installation:<installation-id> \
//     [--repo-id <numeric-repo-id>]   one repo id for every artifact, OR
//     [--resolve-repos]               resolve ids + PR lifecycles via `gh api`
//     [--state open|merged]           static lifecycle when not resolving
//
// DATABASE_URL comes from the environment (or ../../.env via --env-file-less
// node: we read process.env only).
import process from "node:process";
import { closeDb, createDb } from "persistence";
import { parseArgs } from "./args";
import { createRepoResolver } from "./cli/repo-resolver";
import { EXIT_UNMAPPED, writeIngestReport } from "./cli/report";
import { buildTargetContext } from "./cli/scope";
import { ingestBriefDirectory } from "./ingest";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
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
