// The one entry the command suites use: a migrated database they seed
// through, the real API serving it from its own process, and the GitHub stub
// that process's calls land on. What the suites assert is unchanged, the
// contract surface: captured stdout and stderr, exit codes, passthrough
// byte-fidelity, and the rows the API actually wrote.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createEnvKeyProvider, type KeyProvider } from "persistence";
import type { PgliteHarness } from "persistence/testing";
import type { Mutable } from "types/utils";
import {
  findFreePort,
  startApiProcess,
  type ApiProcess,
  type ApiProcessOptions,
} from "./api-process";
import { serveTestDatabase, type ServedDatabase } from "./database";
import { startGitHubStub, type GitHubStub } from "./github-stub";

/** The env var name the reviewer session tokens seal under. */
export const KEY_REF = "SESSION_KEY_V1";

/** The base URL the CLI is configured with; the harness maps it to the API. */
export const BASE_URL = "https://mb.example";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface CliApiHarnessOptions {
  readonly serverVersion?: string;
}

export interface CliApiHarness {
  readonly harness: PgliteHarness;
  /** Seals the same way the API unseals: one key, two processes. */
  readonly keyProvider: KeyProvider;
  readonly github: GitHubStub;
  /** What `CliDeps.fetch` is wired to; rewrites `BASE_URL` to the API. */
  readonly fetch: FetchLike;
  /** The API's own output, for a failure message worth reading. */
  apiOutput(): string;
  close(): Promise<void>;
}

/** The request URL, whatever shape `fetch` was handed. */
function readRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/** Built once for the whole file: a 2048-bit keygen blocks the worker thread. */
let cachedPrivateKey: string | undefined;

function throwawayPrivateKey(): string {
  if (cachedPrivateKey === undefined) {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    cachedPrivateKey = privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString();
  }
  return cachedPrivateKey;
}

/**
 * A whole world for one test: fresh database, fresh API process, fresh stub.
 * Per test rather than per file on purpose, because the API's own caches (the
 * allowed-repo set, the per-PR gate) would otherwise carry a previous test's
 * verdict into the next one and quietly weaken exactly the gate assertions
 * these suites exist for.
 */
export async function startCliApiHarness(
  options: CliApiHarnessOptions = {},
): Promise<CliApiHarness> {
  const sessionKey = randomBytes(32).toString("base64");
  const github = await startGitHubStub();
  let served: ServedDatabase | undefined;
  let api: ApiProcess | undefined;
  try {
    served = await serveTestDatabase(await findFreePort());
    const processOptions: Mutable<ApiProcessOptions> = {
      port: await findFreePort(),
      databaseUrl: served.databaseUrl,
      sessionKey,
      publicBaseUrl: BASE_URL,
      githubStubOrigin: github.origin,
      githubPrivateKey: throwawayPrivateKey(),
    };
    if (options.serverVersion !== undefined) {
      processOptions.serverVersion = options.serverVersion;
    }
    api = await startApiProcess(processOptions);
  } catch (error) {
    await api?.close();
    await served?.close();
    await github.close();
    throw error;
  }

  const origin = api.origin;
  const started: ApiProcess = api;
  const database: ServedDatabase = served;
  return {
    harness: database.harness,
    keyProvider: createEnvKeyProvider({ [KEY_REF]: sessionKey }),
    github,
    fetch: async (input, init) => {
      const url = readRequestUrl(input);
      const target = url.startsWith(BASE_URL)
        ? `${origin}${url.slice(BASE_URL.length)}`
        : url;
      return fetch(target, init);
    },
    apiOutput: () => started.output(),
    // Ordered, but every step runs: one rejecting close must not strand the
    // two listeners after it for the rest of the file.
    close: async () => {
      try {
        await started.close();
      } finally {
        try {
          await database.close();
        } finally {
          await github.close();
        }
      }
    },
  };
}
