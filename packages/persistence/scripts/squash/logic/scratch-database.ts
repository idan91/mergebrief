import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import type { ScratchPostgres, ScratchPostgresUrl } from "../types";

async function runWithClient<Value>(
  url: ScratchPostgresUrl,
  run: (client: Client) => Promise<Value>,
): Promise<Value> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Creates `name` on the scratch server and returns its connection string. */
export async function createDatabase(
  postgres: ScratchPostgres,
  name: string,
): Promise<ScratchPostgresUrl> {
  await runWithClient(postgres.getDatabaseUrl("postgres"), (client) =>
    client.query(`create database "${name}"`),
  );
  return postgres.getDatabaseUrl(name);
}

/** Drizzle's node-postgres migrator over an arbitrary folder, the same
 * migrator boot runs over the checked-in one. */
export async function migrateFolder(
  url: ScratchPostgresUrl,
  migrationsFolder: string,
): Promise<void> {
  await runWithClient(url, (client) =>
    migrate(drizzle(client), { migrationsFolder }),
  );
}

export async function queryRows(
  url: ScratchPostgresUrl,
  sql: string,
): Promise<Record<string, unknown>[]> {
  return runWithClient(url, async (client) => {
    const result = await client.query<Record<string, unknown>>(sql);
    return result.rows;
  });
}
