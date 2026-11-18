// Returns a shared PGlite harness to the state a fresh `createPgliteHarness()`
// gives, so one instance serves a whole test file. The first call on an
// instance records the baseline, what the migrations seeded and where every
// sequence stands, so it belongs right after creation; every later call
// truncates every table the catalog lists and restores that record.
import type { PGlite } from "@electric-sql/pglite";
import type { PgliteHarness } from "./index";

/**
 * The app schema and the graphile stub. The `drizzle` schema stays out: it
 * holds only the migration journal the migrator and `ensureAppSchema` read.
 */
const RESET_SCHEMAS = ["public", "graphile_worker"];

interface SeededTable {
  readonly name: string;
  /** The rows as one JSON array, Postgres's own encoding of every column. */
  readonly rows: string;
}

interface SequencePosition {
  readonly name: string;
  readonly value: string;
  readonly called: boolean;
}

interface PgliteBaseline {
  /** Every table in the reset schemas, `schema.table`, quoted for SQL. */
  readonly tables: readonly string[];
  readonly seeded: readonly SeededTable[];
  /** Every sequence's position, as one JSON array for a single `setval` pass. */
  readonly sequences: string;
}

const baselines = new WeakMap<PGlite, PgliteBaseline>();

async function captureSeededRows(
  client: PGlite,
  name: string,
): Promise<SeededTable | undefined> {
  const result = await client.query<{ rows: string | null }>(
    `select json_agg(seed)::text as rows from ${name} as seed`,
  );
  const rows = result.rows[0]?.rows;
  if (rows === null || rows === undefined) {
    return undefined;
  }
  return { name, rows };
}

async function captureBaseline(client: PGlite): Promise<PgliteBaseline> {
  const tables = await client.query<{ name: string }>(
    "select format('%I.%I', schemaname, tablename) as name from pg_tables " +
      "where schemaname = any($1) order by 1",
    [RESET_SCHEMAS],
  );
  const names = tables.rows.map((row) => row.name);
  const seeded = await Promise.all(
    names.map((name) => captureSeededRows(client, name)),
  );
  // `last_value` is null until the sequence is first called.
  const sequences = await client.query<SequencePosition>(
    "select format('%I.%I', schemaname, sequencename) as name, " +
      "coalesce(last_value, start_value)::text as value, " +
      "last_value is not null as called " +
      "from pg_sequences where schemaname = any($1) order by 1",
    [RESET_SCHEMAS],
  );
  return {
    tables: names,
    seeded: seeded.filter((table) => table !== undefined),
    sequences: JSON.stringify(sequences.rows),
  };
}

async function restoreBaseline(
  client: PGlite,
  baseline: PgliteBaseline,
): Promise<void> {
  await client.exec(
    `truncate table ${baseline.tables.join(", ")} restart identity cascade`,
  );
  await Promise.all(
    baseline.seeded.map((table) =>
      client.query(
        `insert into ${table.name} overriding system value ` +
          `select * from json_populate_recordset(null::${table.name}, $1::json)`,
        [table.rows],
      ),
    ),
  );
  await client.query(
    "select setval(name::regclass, value, called) from json_to_recordset($1::json) " +
      "as positions(name text, value bigint, called boolean)",
    [baseline.sequences],
  );
}

/**
 * Put the database back to its post-migration state: every table in the app
 * schema and the graphile stub truncated, seeded rows re-inserted, every
 * sequence at its post-migration position. The first call records that
 * state instead, so call it once right after creation and then before each
 * test. A transaction a failed test left open is rolled back first.
 */
export async function resetPgliteHarness(
  harness: PgliteHarness,
): Promise<void> {
  const client = harness.database;
  await client.exec("rollback");

  const baseline = baselines.get(client);
  if (baseline === undefined) {
    baselines.set(client, await captureBaseline(client));
    return;
  }

  await restoreBaseline(client, baseline);
}
