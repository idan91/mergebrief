import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { Client } from "pg";
import type {
  ScratchContainerName,
  ScratchPostgres,
  ScratchPostgresUrl,
} from "../types";

const execFileAsync = promisify(execFile);

/** The image CI and compose run, so pg_dump and the server share a version. */
const POSTGRES_IMAGE = "postgres:17-alpine";
/** Loopback only, container-lived, never a secret. */
const THROWAWAY_PASSWORD = "throwaway";
const READY_POLL_MS = 500;
const READY_ATTEMPTS = 120;

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("could not reserve a loopback port"));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Ready means the FINAL server answers over TCP from the host. The image's
 * entrypoint first runs an init-phase server on the unix socket only, which a
 * bare `pg_isready` inside the container would mistake for ready.
 */
async function acceptsConnections(url: ScratchPostgresUrl): Promise<boolean> {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function waitUntilReady(
  container: ScratchContainerName,
  url: ScratchPostgresUrl,
): Promise<void> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    if (await acceptsConnections(url)) {
      return;
    }
    await sleep(READY_POLL_MS);
  }
  throw new Error(`container ${container} did not accept connections in time`);
}

/**
 * A throwaway Postgres this run owns: `docker run --rm` under a pid-stamped
 * name, stopped (and so removed) by `stop()`, which the caller runs in a
 * `finally`.
 */
export async function startPostgres(): Promise<ScratchPostgres> {
  const port = await findFreePort();
  const container: ScratchContainerName = `mergebrief-squash-${process.pid}`;
  await execFileAsync("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    container,
    "-p",
    `127.0.0.1:${port}:5432`,
    "-e",
    `POSTGRES_PASSWORD=${THROWAWAY_PASSWORD}`,
    POSTGRES_IMAGE,
  ]);

  const postgres: ScratchPostgres = {
    container,
    port,
    getDatabaseUrl(database) {
      return `postgres://postgres:${THROWAWAY_PASSWORD}@127.0.0.1:${port}/${database}`;
    },
    async stop() {
      await execFileAsync("docker", ["stop", container]);
    },
  };
  try {
    await waitUntilReady(container, postgres.getDatabaseUrl("postgres"));
  } catch (error) {
    await postgres.stop();
    throw error;
  }
  return postgres;
}
