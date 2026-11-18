import { randomUUID } from "node:crypto";
import { Client } from "pg";

export interface FreshPostgresDatabase {
  readonly url: string;
  drop(): Promise<void>;
}

async function runAdminStatement(
  url: string,
  statement: string,
): Promise<void> {
  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(statement);
  } finally {
    await admin.end();
  }
}

/** An empty database on the server `serverUrl` names, for a suite that needs
 * what a first boot meets: no schema, no ledger, no queue. */
export async function createFreshPostgresDatabase(
  serverUrl: string,
): Promise<FreshPostgresDatabase> {
  const name = `fresh_${randomUUID().replaceAll("-", "")}`;
  await runAdminStatement(serverUrl, `create database ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: () =>
      runAdminStatement(serverUrl, `drop database ${name} with (force)`),
  };
}
