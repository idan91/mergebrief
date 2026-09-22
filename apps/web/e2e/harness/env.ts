// Shared constants for the e2e harness: the playwright config, the global
// setup, and the seed script must agree on every one of these. Values are
// fixed test-only identities, nothing here is a real credential.
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INBOX_INSTALLATIONS } from "../fixtures/inbox";
import { FIXTURE_PR_TITLE, FIXTURE_REV2_HEAD } from "../fixtures/ids";

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }
  return value;
}

/** Overridable per suite (the perf harness reuses everything but these). */
export const E2E_PORT = readEnvNumber("MERGEBRIEF_E2E_PORT", 3311);
export const E2E_BASE_URL = `http://localhost:${String(E2E_PORT)}`;

/** The API runs as its own process now; the web tier proxies `/api/*` to it. */
export const E2E_API_PORT = readEnvNumber("MERGEBRIEF_E2E_API_PORT", 3312);
export const E2E_API_ORIGIN = `http://127.0.0.1:${String(E2E_API_PORT)}`;

// ONE container + port for both suites: e2e and perf recreate it, so they
// must never run at the same time.
export const E2E_PG_CONTAINER = "mergebrief-e2e-pg";
/** Ownership mark: the harness removes a container only if it carries this. */
export const E2E_PG_LABEL = "mergebrief-e2e=1";
export const E2E_PG_PORT = 55432;
export const E2E_DATABASE_URL = `postgres://e2e:e2e@127.0.0.1:${String(E2E_PG_PORT)}/e2e?sslmode=disable`;

/** 32 bytes, base64, a fixed TEST key, never a secret. */
export const E2E_SESSION_KEY = Buffer.alloc(32, 7).toString("base64");

/** The seeded session's cookie value (stored hashed; test-only). */
export const E2E_SESSION_COOKIE = "e2e-session-cookie-value-0123456789";

/** The owner-world identity the fixtures are seeded under. */
export const E2E_OWNER_USER_ID = 555n;
export const E2E_REPO_ID = readEnvNumber("MERGEBRIEF_E2E_REPO_ID", 424242);
export const E2E_REPO_SLUG =
  process.env["MERGEBRIEF_E2E_REPO_SLUG"] ?? "mergebrief/e2e-fixture";

const fixtureDirOverride = process.env["MERGEBRIEF_E2E_FIXTURE_DIR"];
export const FIXTURE_DIR =
  fixtureDirOverride === undefined || fixtureDirOverride === ""
    ? fileURLToPath(new URL("../fixtures/briefs", import.meta.url))
    : resolve(fixtureDirOverride);

const ARTIFACTS_DIR = fileURLToPath(new URL("../.artifacts", import.meta.url));
export const STORAGE_STATE_PATH = `${ARTIFACTS_DIR}/storage-state.json`;
export const GITHUB_APP_KEY_PATH = `${ARTIFACTS_DIR}/github-app-key.pem`;
/**
 * Written by the setup that CREATED the container, read by the teardown that
 * removes it. Absent = this invocation created nothing, so it removes nothing
 * playwright runs the teardown even when the setup refused.
 *
 * Keyed by PID, and that is the whole point: a shared path would hold the
 * OTHER run's container id at exactly the moment this run refused because
 * that container was live, so the refusing run's teardown would kill it.
 * Setup and teardown are hooks of one playwright process, so the pid pairs
 * them and nothing else can read this run's file.
 */
export const CONTAINER_ID_PATH = `${ARTIFACTS_DIR}/pg-container-id-${String(process.pid)}`;
/** Same pid-keyed shape as the container id, for the same reason. */
export const API_PID_PATH = `${ARTIFACTS_DIR}/api-pid-${String(process.pid)}`;

/**
 * A throwaway RSA key so the GitHub App client construction has a valid PEM.
 * Regenerated on every config load; the stub means it never signs anything
 * a real service sees.
 */
export function writeThrowawayGitHubKey(): string {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  writeFileSync(
    GITHUB_APP_KEY_PATH,
    privateKey.export({ type: "pkcs1", format: "pem" }),
  );
  return GITHUB_APP_KEY_PATH;
}

/**
 * The API process env. It holds every credential and the database, because
 * that is where they now live; the GitHub stub intercepts `api.github.com`
 * inside this process, which is what keeps the suite network-free.
 */
export function buildApiServerEnv(): Record<string, string> {
  return {
    DATABASE_URL: E2E_DATABASE_URL,
    SESSION_KEY_V1: E2E_SESSION_KEY,
    PUBLIC_BASE_URL: E2E_BASE_URL,
    MERGEBRIEF_API_PORT: String(E2E_API_PORT),
    GITHUB_APP_ID: "1",
    GITHUB_APP_PRIVATE_KEY_PATH: writeThrowawayGitHubKey(),
    GITHUB_WEBHOOK_SECRET: "e2e-webhook-secret",
    GITHUB_OAUTH_CLIENT_ID: "Iv1.e2e-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "e2e-client-secret",
    NODE_OPTIONS: `--import ${fileURLToPath(new URL("./github-stub.mjs", import.meta.url))}`,
    // The stub is preloaded into THIS process, so the fixture surface it
    // serves has to be described here and not on the web tier.
    MERGEBRIEF_E2E_FIXTURES: FIXTURE_DIR,
    MERGEBRIEF_E2E_REPO_ID: String(E2E_REPO_ID),
    MERGEBRIEF_E2E_REPO_SLUG: E2E_REPO_SLUG,
    // The installations walk and the live read answer from the same fixture
    // the seed wrote, described here because the stub runs in that process.
    MERGEBRIEF_E2E_INBOX: JSON.stringify({
      installations: INBOX_INSTALLATIONS,
      urlRow: {
        slug: E2E_REPO_SLUG,
        repoId: E2E_REPO_ID,
        prNumber: 1,
        title: FIXTURE_PR_TITLE,
        headSha: FIXTURE_REV2_HEAD,
      },
    }),
  };
}

/**
 * The web process env. No credentials and no database: the tier proxies
 * `/api/*` to the API and reads only the file-backed fixture surface.
 */
export function buildWebServerEnv(): Record<string, string> {
  return {
    PUBLIC_BASE_URL: E2E_BASE_URL,
    MERGEBRIEF_API_ORIGIN: E2E_API_ORIGIN,
    MERGEBRIEF_E2E_FIXTURES: FIXTURE_DIR,
    MERGEBRIEF_E2E_REPO_ID: String(E2E_REPO_ID),
    MERGEBRIEF_E2E_REPO_SLUG: E2E_REPO_SLUG,
  };
}
