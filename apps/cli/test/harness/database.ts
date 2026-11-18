// The migrated test database, served over a TCP socket so the API process can
// connect to the SAME store the suite seeds through. `maxConnections` is
// explicit: the default is one, and the API opens a pool.
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";

/** The API opens a pool and probes readiness; one connection is not enough. */
const MAX_CONNECTIONS = 12;

export interface ServedDatabase {
  readonly harness: PgliteHarness;
  /** What the API process is handed as `DATABASE_URL`. */
  readonly databaseUrl: string;
  close(): Promise<void>;
}

/**
 * Serve a fresh migrated database on `port`, for one test's API process. No
 * `graphile_worker` stub: the API runs graphile's real migration at boot, and
 * the two would collide.
 */
export async function serveTestDatabase(port: number): Promise<ServedDatabase> {
  const harness = await createPgliteHarness({ graphileStub: false });
  const server = new PGLiteSocketServer({
    db: harness.database,
    host: "127.0.0.1",
    port,
    maxConnections: MAX_CONNECTIONS,
  });
  await server.start();
  return {
    harness,
    databaseUrl: `postgres://postgres:postgres@127.0.0.1:${String(port)}/postgres`,
    close: async () => {
      await server.stop();
      await harness.close();
    },
  };
}
