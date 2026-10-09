// The runnable migration. Dry run by default: `--apply` writes. `--dir <path>`
// normalizes a local out dir's brief files instead of the database, whose URL
// comes from DATABASE_URL.
import process from "node:process";
import { Client } from "pg";
import { normalizeBriefFiles, normalizeStoredShapes } from ".";

const APPLY_FLAG = "--apply";
const DIR_FLAG = "--dir";

/** A `--dir` with no path fails, rather than falling through to the database. */
function readDirFlag(argv: readonly string[]): string | undefined {
  const at = argv.indexOf(DIR_FLAG);
  if (at === -1) {
    return undefined;
  }
  const dir = argv[at + 1];
  const isMissing = dir === undefined || dir.startsWith("--");
  if (isMissing) {
    throw new Error(`${DIR_FLAG} needs a path`);
  }
  return dir;
}

async function normalizeDatabase(apply: boolean): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const summary = await normalizeStoredShapes(
      {
        query: async (text, params) => (await client.query(text, params)).rows,
      },
      { apply },
    );
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes(APPLY_FLAG);
  const dir = readDirFlag(argv);
  process.stdout.write(apply ? "applying\n" : "dry run: nothing is written\n");

  if (dir === undefined) {
    await normalizeDatabase(apply);
    return;
  }
  const summary = await normalizeBriefFiles(dir, { apply });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `normalize failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
