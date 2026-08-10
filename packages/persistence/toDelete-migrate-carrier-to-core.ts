// One-off data migration for the carrier -> core role rename. Rewrites kept
// generations: `brief` and `delta` rows plus local artifact JSON
// (*.brief.json, *.revchanges.json, *.delta.json). Idempotent — a second run
// finds nothing
// left to change. Delete at the OSS launch cutover.
//
// Run from the repo root with the app env loaded:
//   set -a && . ./.env && set +a
//   pnpm -C packages/worker exec tsx ../persistence/toDelete-migrate-carrier-to-core.ts [out-dir]
//
// [out-dir] defaults to MERGEBRIEF_OUT_DIR, then tools/categorizer/out.
// Without a resolvable DATABASE_URL the DB pass is skipped.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { resolveDatabaseUrl } from "./src/db/dsn";

interface Migrated {
  readonly value: unknown;
  readonly changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rename `carrierChunkIds` keys and flip `role: "carrier"` values, deep.
 * Only those two shapes move — prose fields that merely contain the word
 * "carrier" are left alone.
 */
function migrateTree(value: unknown): Migrated {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const result = migrateTree(item);
      changed ||= result.changed;
      return result.value;
    });
    return { value: changed ? items : value, changed };
  }
  if (!isRecord(value)) return { value, changed: false };
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const nextKey = key === "carrierChunkIds" ? "coreChunkIds" : key;
    let next = child;
    if (key === "role" && child === "carrier") {
      next = "core";
    } else {
      const result = migrateTree(child);
      next = result.value;
      changed ||= result.changed;
    }
    changed ||= nextKey !== key || next !== child;
    out[nextKey] = next;
  }
  return { value: changed ? out : value, changed };
}

const ARTIFACT_TABLES = ["brief", "delta"] as const;
type ArtifactTable = (typeof ARTIFACT_TABLES)[number];

async function migrateTable(pool: Pool, table: ArtifactTable): Promise<void> {
  const { rows } = await pool.query<{ id: string; body: string }>(
    `SELECT id, body FROM "${table}" WHERE body LIKE '%carrier%'`,
  );
  let rewritten = 0;
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.body);
    } catch {
      console.warn(`${table} row ${row.id}: body is not JSON — skipped`);
      continue;
    }
    const result = migrateTree(parsed);
    if (!result.changed) continue;
    const pretty = row.body.includes("\n");
    const body = JSON.stringify(result.value, null, pretty ? 2 : undefined);
    await pool.query(
      `UPDATE "${table}" SET body = $1, byte_size = $2 WHERE id = $3`,
      [body, Buffer.byteLength(body, "utf8"), row.id],
    );
    rewritten += 1;
  }
  console.info(
    `${table}: ${rewritten}/${rows.length} candidate rows rewritten`,
  );
}

const ARTIFACT_SUFFIXES = [
  ".brief.json",
  ".revchanges.json",
  ".delta.json",
] as const;

async function migrateFiles(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    console.info(`out dir ${dir} not found — file pass skipped`);
    return;
  }
  const targets = entries.filter((entry) =>
    ARTIFACT_SUFFIXES.some((suffix) => entry.endsWith(suffix)),
  );
  let rewritten = 0;
  for (const entry of targets) {
    const path = join(dir, entry);
    const raw = await readFile(path, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`${entry}: not JSON — skipped`);
      continue;
    }
    const result = migrateTree(parsed);
    if (!result.changed) continue;
    const pretty = raw.includes("\n");
    const body = JSON.stringify(result.value, null, pretty ? 2 : undefined);
    await writeFile(path, raw.endsWith("\n") ? `${body}\n` : body);
    rewritten += 1;
  }
  console.info(
    `${dir}: ${rewritten}/${targets.length} artifact files rewritten`,
  );
}

async function main(): Promise<void> {
  const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");
  const outDirArg = process.argv[2];
  const outDirEnv = process.env["MERGEBRIEF_OUT_DIR"];
  const outDir = outDirArg
    ? resolve(outDirArg)
    : outDirEnv
      ? resolve(outDirEnv)
      : join(repoRoot, "tools/categorizer/out");

  await migrateFiles(outDir);

  const dsn = resolveDatabaseUrl(process.env, { onWarning: console.warn });
  if (!dsn.ok || dsn.value === undefined) {
    console.info("no DATABASE_URL resolved — DB pass skipped");
    return;
  }
  // Raw Pool on purpose: whole-DB one-off, exempt from the forTenant surface.
  const pool = new Pool({ connectionString: dsn.value });
  try {
    for (const table of ARTIFACT_TABLES) {
      await migrateTable(pool, table);
    }
  } finally {
    await pool.end();
  }
}

await main();
