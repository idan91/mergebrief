// Playwright global setup: a disposable postgres container (OURS, created
// and removed by this harness, never a dev database), the seed, the API
// process, and the signed-in storage state. The API starts HERE and not as a
// `webServer` entry, because Playwright starts and awaits every webServer
// before this runs, and the API connects to Postgres before it listens.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startApiServer } from "./api-server";
import {
  CONTAINER_ID_PATH,
  E2E_PG_CONTAINER,
  E2E_PG_LABEL,
  E2E_PG_PORT,
  E2E_SESSION_COOKIE,
  STORAGE_STATE_PATH,
} from "./env";

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" });
}

function findContainer(...filters: string[]): string {
  return docker([
    "ps",
    "-aq",
    "--filter",
    `name=^${E2E_PG_CONTAINER}$`,
    ...filters,
  ]).trim();
}

/**
 * Frees the name for THIS run, or refuses. A container that is RUNNING is
 * never removed whoever created it: the label marks the harness, not the run,
 * so a live container under that name is another invocation whose database
 * this one must not pull out from under it, and the fixed port means the two
 * cannot coexist anyway, which is a loud stop rather than a race. A STOPPED
 * container carrying the label is this harness's own leftover from a crashed
 * run and is recreated from scratch; anything else keeps its name.
 */
function freeContainerNameForThisRun(): void {
  if (findContainer() === "") {
    return;
  }
  if (findContainer("--filter", "status=running") !== "") {
    throw new Error(
      `container ${E2E_PG_CONTAINER} is RUNNING. Another e2e run owns it, or a previous one is still up. Wait for it, or remove it yourself: docker rm -f ${E2E_PG_CONTAINER}`,
    );
  }
  const stale = findContainer("--filter", `label=${E2E_PG_LABEL}`);
  if (stale === "") {
    throw new Error(
      `container ${E2E_PG_CONTAINER} exists but this harness did not create it. Remove it yourself (docker rm -f ${E2E_PG_CONTAINER}) or free the name`,
    );
  }
  docker(["rm", "-f", stale]);
}

// oxlint-disable-next-line no-default-export -- playwright loads globalSetup by default export
export default async function globalSetup(): Promise<void> {
  freeContainerNameForThisRun();
  const containerId = docker([
    "run",
    "-d",
    "--name",
    E2E_PG_CONTAINER,
    "--label",
    E2E_PG_LABEL,
    "-e",
    "POSTGRES_USER=e2e",
    "-e",
    "POSTGRES_PASSWORD=e2e",
    "-e",
    "POSTGRES_DB=e2e",
    "-p",
    `127.0.0.1:${String(E2E_PG_PORT)}:5432`,
    "postgres:17-alpine",
  ]).trim();
  // The teardown removes THIS id and nothing else. It runs even when the
  // setup above refused, and a name-based removal would then take the
  // container belonging to whichever run is actually using it.
  mkdirSync(dirname(CONTAINER_ID_PATH), { recursive: true });
  writeFileSync(CONTAINER_ID_PATH, containerId);
  // Readiness from the HOST side: the postgres image's init phase runs a
  // temporary in-container server, so an in-container pg_isready can pass
  // while the mapped port still refuses connections.
  const deadline = Date.now() + 60_000;
  for (;;) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port: E2E_PG_PORT });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (reachable) {
      try {
        docker(["exec", E2E_PG_CONTAINER, "pg_isready", "-U", "e2e"]);
        break;
      } catch {
        // Port open but the server is still initializing. Keep waiting.
      }
    }
    if (Date.now() > deadline) {
      throw new Error("e2e postgres did not become ready in 60s");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Migrate + ingest + session, via tsx so workspace TS resolves natively.
  execFileSync("pnpm", ["exec", "tsx", "e2e/harness/seed.ts"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    stdio: "inherit",
  });

  // Only now: the database exists, is migrated and is seeded.
  await startApiServer();

  // The signed-in browser state: the seeded session's cookie.
  mkdirSync(dirname(STORAGE_STATE_PATH), { recursive: true });
  writeFileSync(
    STORAGE_STATE_PATH,
    JSON.stringify({
      cookies: [
        {
          name: "rs_session",
          value: E2E_SESSION_COOKIE,
          domain: "localhost",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
  );
}
