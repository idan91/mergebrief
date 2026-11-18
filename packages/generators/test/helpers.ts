import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { expect, vi } from "vitest";
import { z } from "zod/v4";
import type { HarnessCliEnv } from "../src/harness/run";

/** The request URL, whatever shape `fetch` was handed. */
export function getRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/** One request a capturing fetch saw. */
export interface CapturedRequest {
  url: string;
  headers: Headers;
  /** How the request asked a 3xx answer to be handled. */
  redirect: RequestInit["redirect"];
}

export interface CapturingFetch {
  requests: CapturedRequest[];
  fetch: typeof fetch;
}

/** A fetch that records each request's url and headers, then answers via `respond`. */
export function stubCapturingFetch(
  respond: (
    url: string,
    init: RequestInit | undefined,
  ) => Response | Promise<Response>,
): CapturingFetch {
  const requests: CapturedRequest[] = [];
  const fixture: typeof fetch = async (input, init) => {
    const url = getRequestUrl(input);
    requests.push({
      url,
      headers: new Headers(init?.headers),
      redirect: init?.redirect,
    });
    return respond(url, init);
  };
  return { requests, fetch: fixture };
}

/** Canary values for the openai SDK's env-read host and account vars. */
export const AMBIENT_OPENAI_ENV = {
  OPENAI_BASE_URL: "https://redirect.invalid/v1",
  OPENAI_ORG_ID: "org-canary",
  OPENAI_PROJECT_ID: "proj-canary",
  OPENAI_ADMIN_KEY: "admin-key-canary",
} as const;

/** Points every openai SDK env read at a canary for the current test. */
export function stubAmbientOpenAiEnv(): void {
  for (const [name, value] of Object.entries(AMBIENT_OPENAI_ENV)) {
    vi.stubEnv(name, value);
  }
}

/** Asserts no request header names an organization or project. */
export function expectNoAmbientAccountHeaders(headers: Headers): void {
  expect(headers.has("openai-organization")).toBe(false);
  expect(headers.has("openai-project")).toBe(false);
}

const ShimCwdRecordSchema = z.object({
  argv: z.array(z.string()),
  cwd: z.string(),
  entries: z.array(z.string()),
  cursorConfig: z.string().optional(),
});

/** One shim invocation as `SHIM_CWD_LOG` recorded it, read during the run. */
export type ShimCwdRecord = z.infer<typeof ShimCwdRecordSchema>;

/** Every invocation a shim appended to its `SHIM_CWD_LOG` file, in order. */
export function readShimCwdLog(file: string): ShimCwdRecord[] {
  const text = readFileSync(file, "utf8");
  const lines = text.trim().split("\n");
  const records: ShimCwdRecord[] = [];
  for (const line of lines) {
    const value: unknown = JSON.parse(line);
    records.push(ShimCwdRecordSchema.parse(value));
  }
  return records;
}

/**
 * Asserts every recorded spawn ran in a temp dir named by `prefix`, under the
 * home cache rather than the shared temp dir, that held nothing but
 * `allowedEntries` while the CLI ran and is gone now; returns the records.
 */
export function expectEmptyRemovedCwds(
  file: string,
  prefix: string,
  allowedEntries: readonly string[] = [],
): ShimCwdRecord[] {
  const records = readShimCwdLog(file);
  const home = realpathSync(homedir());
  const harnessBase = join(home, ".cache", "mergebrief");
  expect(records.length).toBeGreaterThan(0);
  for (const record of records) {
    expect(record.cwd).toContain(prefix);
    expect(record.cwd.startsWith(harnessBase)).toBe(true);
    expect(record.cwd).not.toBe(process.cwd());
    expect(record.entries).toEqual(allowedEntries);
    expect(existsSync(record.cwd)).toBe(false);
  }
  return records;
}

/** Every `SHIM_*` setting the fakes read; direct harness calls pass them by name. */
export const SHIM_CLI_ENV: HarnessCliEnv = {
  passVars: [
    "SHIM_ABOUT",
    "SHIM_API_KEY_SOURCE",
    "SHIM_AUTH_STATUS",
    "SHIM_CWD_LOG",
    "SHIM_DRIP_COUNT",
    "SHIM_DRIP_MS",
    "SHIM_DRIP_THEN",
    "SHIM_ERROR",
    "SHIM_EXIT_CODE",
    "SHIM_GRANDCHILD_PID_FILE",
    "SHIM_LOGIN_STATUS",
    "SHIM_MARKER_FILE",
    "SHIM_MODEL",
    "SHIM_MODEL_DISPLAY",
    "SHIM_OUTPUT",
    "SHIM_PERMISSION_MODE",
    "SHIM_SCENARIO",
    "SHIM_SCHEMA_COPY",
    "SHIM_SCRIPT_DIR",
    "SHIM_SERVED_MODEL",
    "SHIM_STDERR",
    "SHIM_VERSION",
  ],
  fixedVars: {},
};

/** A fake CLI command plus the env left for the spawn allowlist to filter. */
export interface ShimCommand {
  command: string;
  env: Record<string, string | undefined>;
}

const SHIM_VAR_PREFIX = "SHIM_";

/**
 * The one executable every shim command links to. macOS scans each new
 * executable on its first exec (about half a second), so a fresh wrapper
 * per test starves the timing tests; a symlink to this one is not scanned.
 * It sources the settings file named after the link, then execs the shim.
 */
const WRAPPER_SCRIPT = [
  "#!/bin/sh",
  '. "$0.settings"',
  'exec "$SHIM_NODE" "$SHIM_TARGET" "$@"',
  "",
].join("\n");

let wrapperPath: string | undefined;

function getWrapperPath(): string {
  if (wrapperPath === undefined) {
    const dir = mkdtempSync(join(tmpdir(), "mergebrief-shim-"));
    process.once("exit", () => {
      rmSync(dir, { recursive: true, force: true });
    });
    const file = join(dir, "wrapper");
    writeFileSync(file, WRAPPER_SCRIPT, { mode: 0o700 });
    wrapperPath = file;
  }
  return wrapperPath;
}

function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Adapters spawn with their own allowlist, which drops a fake's `SHIM_*`
 * settings, so those ride in a settings file the shared `sh` wrapper sources
 * before it execs the shim under node. Every other var stays in `env` and
 * meets the allowlist like a real spawn's would.
 */
export function stubShimCommand(
  shim: string,
  env: Record<string, string | undefined>,
): ShimCommand {
  const exports = [
    `export SHIM_NODE=${quoteForShell(process.execPath)}`,
    `export SHIM_TARGET=${quoteForShell(shim)}`,
  ];
  const rest: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(SHIM_VAR_PREFIX)) {
      rest[key] = value;
      continue;
    }
    if (value !== undefined) {
      exports.push(`export ${key}=${quoteForShell(value)}`);
    }
  }

  const wrapper = getWrapperPath();
  const link = join(dirname(wrapper), `${basename(shim)}-${randomUUID()}`);
  writeFileSync(`${link}.settings`, [...exports, ""].join("\n"), {
    mode: 0o600,
  });
  symlinkSync(wrapper, link);
  return { command: link, env: rest };
}
