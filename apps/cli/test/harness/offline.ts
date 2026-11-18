// The CLI over a written profile and a scripted fetch: no login, no api
// process. A refusal decided before any request proves it with an empty
// request log; a relay test pins the request the CLI sends (method, path,
// body) and what it prints back from the scripted answer.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiErrorCodes } from "contract";
import type { Mutable } from "types/utils";
import { expect } from "vitest";
import type { FetchInit } from "../../src/client";
import { ExitCodes } from "../../src/exit";
import { saveConfig, type CliConfig } from "../../src/profile/config";
import { runCli } from "../../src/program";
import type { CliDeps } from "../../src/types";
import { BASE_URL } from "./consts";

export const OFFLINE_TOKEN = "mergebrief_offline";
/** The one repository the offline profile targets, as its origin remote names it. */
export const OFFLINE_REPO_ID = 42001;
const OFFLINE_REPO_FULL_NAME = "octo/hello";
const OFFLINE_ORIGIN_URL = `git@github.com:${OFFLINE_REPO_FULL_NAME}.git`;

/** One request the CLI sent, as the scripted fetch saw it. */
export interface SentRequest {
  readonly method: string;
  /** The URL with the profile's base URL stripped. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array | undefined;
}

/** A scripted answer, matched on method and path; the body is raw text. */
export interface ScriptedRoute {
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface OfflineRunOptions {
  readonly routes?: readonly ScriptedRoute[];
  /** An `Error` makes reading stdin fail with it. */
  readonly stdin?: string | Error;
  /** The files `-F <path>` and `draft attach <file>` may read; any other path throws. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  readonly env?: CliDeps["env"];
  /** The config on disk; absent, one logged-in `default` profile. */
  readonly config?: CliConfig;
  /** One profile's repo cache on disk before the run, by profile name. */
  readonly repoCaches?: Readonly<Record<string, string>>;
  /** Profiles whose cache file is a folder, so deleting it fails whoever runs the test. */
  readonly undeletableRepoCaches?: readonly string[];
  /** The success-only sink `bin.ts` prints after the flush; absent, those lines go to stderr. */
  readonly successNotice?: CliDeps["successNotice"];
  /** What `bin.ts` reads off a real stdout; absent, a pipe. */
  readonly stdoutIsTerminal?: boolean;
  readonly pager?: CliDeps["pager"];
  /** The cache a previous run left; absent, a fresh one. */
  readonly cacheDir?: string;
}

export interface OfflineRun {
  readonly code: number;
  readonly out: string;
  readonly err: string[];
  readonly requests: SentRequest[];
  readonly configDir: string;
  readonly cacheDir: string;
}

const NO_CONTENT = 204;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** `GET /api/version`, the probe `auth login` and `auth status` verify with. */
export const OFFLINE_VERSION_ROUTE: ScriptedRoute = {
  method: "GET",
  path: "/api/version",
  body: JSON.stringify({ version: "test-version" }),
};

/** `GET /api/repos` naming the offline repository, the first hop of every PR command. */
export const OFFLINE_REPOS_ROUTE: ScriptedRoute = {
  method: "GET",
  path: "/api/repos",
  body: JSON.stringify({
    repos: [
      { repoId: String(OFFLINE_REPO_ID), fullName: OFFLINE_REPO_FULL_NAME },
    ],
  }),
};

/** The 403 body the api answers a token with on a clearing write. */
export const HUMAN_ONLY_REFUSAL = JSON.stringify({
  error: "a reviewer clears this by hand",
  code: ApiErrorCodes.HUMAN_ONLY,
});

function makeScriptedResponse(route: ScriptedRoute): Response {
  if (route.body === undefined) {
    return new Response(null, { status: route.status ?? NO_CONTENT });
  }
  return new Response(route.body, {
    status: route.status ?? 200,
    headers: { "content-type": JSON_CONTENT_TYPE, ...route.headers },
  });
}

function makeScriptedFetch(
  routes: readonly ScriptedRoute[],
  requests: SentRequest[],
): CliDeps["fetch"] {
  return async (url: string, init?: FetchInit) => {
    const method = init?.method ?? "GET";
    const path = url.startsWith(BASE_URL) ? url.slice(BASE_URL.length) : url;
    requests.push({
      method,
      path,
      headers: init?.headers ?? {},
      body: init?.body,
    });

    const route = routes.find(
      (candidate) => candidate.method === method && candidate.path === path,
    );
    if (route === undefined) {
      throw new Error(`unexpected request ${method} ${path}`);
    }
    return makeScriptedResponse(route);
  };
}

function readScriptedFile(
  files: Readonly<Record<string, string | Uint8Array>>,
  path: string,
): string | Uint8Array {
  const content = files[path];
  if (content === undefined) {
    throw new Error(`unexpected read: ${path}`);
  }
  return content;
}

/** Run the CLI as a logged-in profile would see it, with every request scripted. */
export async function runCliOffline(
  argv: readonly string[],
  options: OfflineRunOptions = {},
): Promise<OfflineRun> {
  const configDir = mkdtempSync(join(tmpdir(), "mb-offline-config-"));
  const cacheDir =
    options.cacheDir ?? mkdtempSync(join(tmpdir(), "mb-offline-cache-"));
  saveConfig(
    configDir,
    options.config ?? {
      defaultProfile: "default",
      profiles: { default: { baseUrl: BASE_URL, token: OFFLINE_TOKEN } },
    },
  );
  for (const [profile, body] of Object.entries(options.repoCaches ?? {})) {
    mkdirSync(join(cacheDir, profile), { recursive: true });
    writeFileSync(join(cacheDir, profile, "repos.json"), body);
  }
  for (const profile of options.undeletableRepoCaches ?? []) {
    mkdirSync(join(cacheDir, profile, "repos.json"), { recursive: true });
  }
  const out: string[] = [];
  const err: string[] = [];
  const requests: SentRequest[] = [];
  const files = options.files ?? {};

  const deps: Mutable<CliDeps> = {
    fetch: makeScriptedFetch(options.routes ?? [], requests),
    env: options.env ?? {},
    configDir,
    cacheDir,
    stdout: (text) => out.push(text),
    stderr: (line) => err.push(line),
    readStdin: async () => {
      if (options.stdin === undefined) {
        throw new Error("stdin not expected");
      }
      if (options.stdin instanceof Error) {
        throw options.stdin;
      }
      return options.stdin;
    },
    readFile: (path) => String(readScriptedFile(files, path)),
    readBinaryFile: (path) => {
      const content = readScriptedFile(files, path);
      return typeof content === "string"
        ? new TextEncoder().encode(content)
        : content;
    },
    gitOriginUrl: () => OFFLINE_ORIGIN_URL,
    stdoutIsTerminal: options.stdoutIsTerminal,
    pager: options.pager,
  };
  if (options.successNotice !== undefined) {
    deps.successNotice = options.successNotice;
  }

  const code = await runCli(argv, deps);
  return { code, out: out.join(""), err, requests, configDir, cacheDir };
}

/** A usage refusal: exit 2, empty stdout, one stderr line, nothing requested. */
export function expectRefusedBeforeRequest(
  run: OfflineRun,
  fragment?: string,
): void {
  expect(run.code).toBe(ExitCodes.USAGE);
  expect(run.out).toBe("");
  expect(run.err).toHaveLength(1);
  if (fragment !== undefined) {
    expect(run.err[0]).toContain(fragment);
  }
  expect(run.requests).toEqual([]);
}

/** The one operation request after the repos hop: its method and path are the route's, its body the caller's. */
export function expectRelayedRequest(
  run: OfflineRun,
  route: ScriptedRoute,
  body: string | undefined,
): void {
  expect(run.requests).toHaveLength(2);
  expect(run.requests[1]).toMatchObject({
    method: route.method,
    path: route.path,
    body,
  });
}
