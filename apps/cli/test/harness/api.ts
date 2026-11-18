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
import { BASE_URL } from "./consts";
import { serveTestDatabase, type ServedDatabase } from "./database";
import { startGitHubStub, type GitHubStub } from "./github-stub";

/** The env var name the reviewer session tokens seal under. */
export const KEY_REF = "SESSION_KEY_V1";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface CliApiHarnessOptions {
  readonly serverVersion?: string;
  /** An absolute instance config path, for operators and the spend cap. */
  readonly configPath?: string;
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

type PortlessApiOptions = Omit<ApiProcessOptions, "port">;

/** How many ports one api start may try. */
const API_START_ATTEMPTS = 3;
/** What node reports when the port was bound by someone else first. */
const PORT_TAKEN_CODE = "EADDRINUSE";

/**
 * The api on a free port. Another process can take the probed port before the
 * api binds it, so that one failure gets a fresh port instead of the test.
 */
async function startApiOnFreePort(
  options: PortlessApiOptions,
): Promise<ApiProcess> {
  let failure: unknown;
  for (let attempt = 0; attempt < API_START_ATTEMPTS; attempt += 1) {
    const port = await findFreePort();
    try {
      return await startApiProcess({ ...options, port });
    } catch (error) {
      const portTaken =
        error instanceof Error && error.message.includes(PORT_TAKEN_CODE);
      if (!portTaken) {
        throw error;
      }
      failure = error;
    }
  }
  throw failure;
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
    const processOptions: Mutable<PortlessApiOptions> = {
      databaseUrl: served.databaseUrl,
      sessionKey,
      publicBaseUrl: BASE_URL,
      githubStubOrigin: github.origin,
      githubPrivateKey: throwawayPrivateKey(),
    };
    if (options.serverVersion !== undefined) {
      processOptions.serverVersion = options.serverVersion;
    }
    if (options.configPath !== undefined) {
      processOptions.configPath = options.configPath;
    }
    api = await startApiOnFreePort(processOptions);
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
