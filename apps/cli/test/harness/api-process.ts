// Start the API from its own executable and wait until it answers. This
// helper owns subprocess startup, readiness and cleanup and nothing else: it
// imports no app, and it hides no API behaviour behind a stub.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordApiPid } from "./pid-registry";

/** Absolute: `--import tsx` would resolve against the isolated cwd below. */
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");

const API_ENTRY = fileURLToPath(
  new URL("../../../api/src/main.ts", import.meta.url),
);
/**
 * An empty directory to run from. The API's `readEnv` calls `loadEnvFile()`
 * against its cwd, so starting in `apps/api` would let a developer's `.env`
 * supply every variable this harness leaves unset: a URL-box token opens the
 * fallback ladder, `MERGEBRIEF_CONFIG` swaps the draft policy, and a private
 * key PATH conflicts with the inline key and stops boot.
 */
const ISOLATED_CWD = mkdtempSync(join(tmpdir(), "mergebrief-api-cwd-"));
const PRELOAD = fileURLToPath(new URL("./github-preload.mjs", import.meta.url));
const READY_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;

export interface ApiProcessOptions {
  /** Chosen by the harness, so readiness is a probe rather than log parsing. */
  readonly port: number;
  readonly databaseUrl: string;
  /** Base64 32 bytes; the suite seals its seeded tokens under the same key. */
  readonly sessionKey: string;
  readonly publicBaseUrl: string;
  readonly githubStubOrigin: string;
  readonly serverVersion?: string;
  /** An absolute `mergebrief.config.yaml` path the api reads as MERGEBRIEF_CONFIG. */
  readonly configPath?: string;
  /** A PEM the App client can parse; the stub means it signs nothing real. */
  readonly githubPrivateKey: string;
}

export interface ApiProcess {
  readonly origin: string;
  /** Everything the process wrote, for a failure message worth reading. */
  output(): string;
  close(): Promise<void>;
}

/** An unused loopback port. Test-only: the window between close and bind. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port =
        address !== null && typeof address === "object" ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * What the child needs from this shell, and nothing else. Inheriting the
 * parent environment would let a developer's `MERGEBRIEF_AUTO_MIGRATE`,
 * `GITHUB_API_URL` or App credentials reach an API the suite believes it
 * configured completely.
 */
const INHERITED_ENV = ["PATH", "HOME", "TMPDIR", "NODE_ENV"] as const;

function inheritedEnv(): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined) {
      inherited[name] = value;
    }
  }
  return inherited;
}

function buildEnv(options: ApiProcessOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...inheritedEnv(),
    DATABASE_URL: options.databaseUrl,
    SESSION_KEY_V1: options.sessionKey,
    PUBLIC_BASE_URL: options.publicBaseUrl,
    MERGEBRIEF_API_HOST: "127.0.0.1",
    MERGEBRIEF_API_PORT: String(options.port),
    MERGEBRIEF_GITHUB_STUB_ORIGIN: options.githubStubOrigin,
    GITHUB_APP_ID: "1",
    GITHUB_APP_PRIVATE_KEY: options.githubPrivateKey,
    GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
    GITHUB_OAUTH_CLIENT_ID: "Iv1.test-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "test-client-secret",
    GITHUB_APP_SLUG: "mergebrief-test",
    // Explicit, not defaulted: `main.ts` loads `apps/api/.env` from its own
    // cwd, and a developer's copy setting this to false would turn boot into
    // a read-only schema check against a database that is always fresh.
    MERGEBRIEF_AUTO_MIGRATE: "true",
    NODE_OPTIONS: `--import ${PRELOAD}`,
    // Quiet, but not silent: a failing boot must still say why.
    LOG_LEVEL: "error",
  };
  if (options.serverVersion !== undefined) {
    env["SERVER_VERSION"] = options.serverVersion;
  }
  if (options.configPath !== undefined) {
    env["MERGEBRIEF_CONFIG"] = options.configPath;
  }
  return env;
}

async function isReady(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/readyz`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Signal-aware: a killed child exits with a null CODE and a signal. */
function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Ready means the API answers its own `/readyz`, not that a log line
 * appeared: the harness runs it quiet, so no log level is load-bearing.
 */
async function waitForReady(
  child: ChildProcess,
  origin: string,
  log: string[],
): Promise<void> {
  const started = Date.now();
  const deadline = started + READY_TIMEOUT_MS;
  let polls = 0;
  while (Date.now() < deadline) {
    if (!isAlive(child)) {
      const how = child.exitCode ?? child.signalCode;
      throw new Error(`api exited with ${String(how)}:\n${log.join("")}`);
    }
    polls += 1;
    if (await isReady(origin)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // Elapsed far past the budget is the only reading that means this process
  // was starved of CPU and never ran the timer. Polls alone do not say it: a
  // refused connection answers fast and a listening-but-hung api answers slow.
  const elapsed = Date.now() - started;
  throw new Error(
    `api did not become ready: ${String(elapsed)}ms elapsed against a ` +
      `${String(READY_TIMEOUT_MS)}ms budget, ${String(polls)} polls, ` +
      `child alive: ${String(isAlive(child))}\n${log.join("")}`,
  );
}

/** Spawn the API, wait until it is listening, and hand back its origin. */
export async function startApiProcess(
  options: ApiProcessOptions,
): Promise<ApiProcess> {
  const log: string[] = [];
  const child = spawn("node", ["--import", TSX_LOADER, API_ENTRY], {
    cwd: ISOLATED_CWD,
    env: buildEnv(options),
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Recorded before the first await: a worker killed during startup still
  // leaves the pid where globalTeardown can find it.
  if (child.pid !== undefined) {
    recordApiPid(child.pid);
  }
  const collect = (chunk: Buffer): void => {
    log.push(chunk.toString("utf8"));
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  // Without a listener a spawn failure is an uncaught exception, which takes
  // the whole test file down instead of failing the one world that could not
  // start.
  child.on("error", (error) => {
    log.push(`spawn failed: ${error.message}\n`);
  });
  const origin = `http://127.0.0.1:${String(options.port)}`;
  try {
    await waitForReady(child, origin, log);
  } catch (error) {
    // Nothing else can reach this child: the caller only ever sees an
    // ApiProcess, and a throw here means it never got one.
    child.kill("SIGKILL");
    throw error;
  }
  return {
    origin,
    output: () => log.join(""),
    close: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        // One settle: a process that ignores SIGTERM is killed, and its exit
        // then arrives after the timeout already answered.
        let settled = false;
        const settle = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          resolve();
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          settle();
        }, STOP_TIMEOUT_MS);
        child.on("exit", () => {
          clearTimeout(timer);
          settle();
        });
        child.kill("SIGTERM");
      }),
  };
}
