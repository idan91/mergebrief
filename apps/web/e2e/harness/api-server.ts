// The API process for the browser suite, started by `globalSetup` rather than
// by Playwright's `webServer`. Playwright starts every `webServer` entry AND
// waits for it to answer BEFORE `globalSetup` runs, so an API that connects to
// Postgres at boot would exit against a database `globalSetup` has not created
// yet, and a wait-for-database wrapper would deadlock against that same order.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_PID_PATH,
  buildApiServerEnv,
  E2E_API_ORIGIN,
  E2E_API_PORT,
} from "./env";

/** Absolute: `--import tsx` would resolve against the isolated cwd below. */
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");
const API_ENTRY = fileURLToPath(
  new URL("../../../api/src/main.ts", import.meta.url),
);
const READY_TIMEOUT_MS = 60_000;

/** Whether anything already accepts connections on the API's port. */
function portIsOccupied(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: E2E_API_PORT });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function answersReadyz(): Promise<boolean> {
  try {
    const response = await fetch(`${E2E_API_ORIGIN}/readyz`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start the API and resolve once it answers. The pid lands on disk before the
 * wait, so a teardown after a failed start still has something to kill.
 */
export async function startApiServer(): Promise<void> {
  // Before spawning: a stranger on this port answers `/readyz` too, and the
  // wait below would take that answer while our own child was still binding.
  // The suite would then run against an API nobody in this run configured.
  // Playwright's webServer refused an occupied port; nothing else does now.
  if (await portIsOccupied()) {
    throw new Error(
      `e2e api port ${String(E2E_API_PORT)} is already in use. Stop whatever holds it, or set MERGEBRIEF_E2E_API_PORT.`,
    );
  }
  // An empty cwd: the API's `readEnv` calls `loadEnvFile()` against it, and
  // starting in `apps/api` would let a developer's `.env` fill anything this
  // harness leaves unset.
  const child = spawn("node", ["--import", TSX_LOADER, API_ENTRY], {
    cwd: mkdtempSync(join(tmpdir(), "mergebrief-e2e-api-")),
    env: { PATH: process.env["PATH"] ?? "", ...buildApiServerEnv() },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => log.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => log.push(chunk.toString("utf8")));
  child.on("error", (error) => log.push(`spawn failed: ${error.message}\n`));

  if (child.pid !== undefined) {
    mkdirSync(dirname(API_PID_PATH), { recursive: true });
    writeFileSync(API_PID_PATH, String(child.pid));
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`e2e api exited early:\n${log.join("")}`);
    }
    if (await answersReadyz()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill("SIGKILL");
  throw new Error(`e2e api did not answer /readyz in 60s:\n${log.join("")}`);
}
