// The built bundle over a real pipe: the flush before exit lives in bin.ts,
// which runCli-level tests never reach.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type Options } from "tsup";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import cliBuild from "../tsup.config";
import { ExitCodes } from "../src/exit";
import { saveConfig } from "../src/profile/config";
import { OFFLINE_REPO_ID, OFFLINE_REPOS_ROUTE } from "./harness/offline";

const cliOptions = cliBuild as Options;
const SCRATCH_PREFIX = join(tmpdir(), "mb-bin-");

const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const PR_NUMBER = 7;
const PULL_PATH = `/api/repos/${OFFLINE_REPO_ID}/pulls/${PR_NUMBER}`;
const DIFF_PATH = `${PULL_PATH}/diff?base=${BASE_SHA}&head=${HEAD_SHA}`;
/** Far past any pipe buffer on macOS (64 KB) or Linux. */
const DIFF_BYTES = 2 * 1024 * 1024;
const DIFF_LINE = "+// a line of the large diff\n";
const LARGE_DIFF = DIFF_LINE.repeat(Math.ceil(DIFF_BYTES / DIFF_LINE.length));

interface BinRun {
  readonly code: number | null;
  readonly stdout: Buffer;
  readonly stderr: string;
}

interface StubState {
  diffStatus: number;
}

let bundlePath = "";
let server: Server;
let configHome = "";
let cacheHome = "";
const stub: StubState = { diffStatus: 200 };

function makeStubServer(): Server {
  return createServer((request, response) => {
    const path = request.url ?? "";
    if (path === OFFLINE_REPOS_ROUTE.path) {
      response.setHeader("content-type", "application/json");
      response.end(OFFLINE_REPOS_ROUTE.body);
      return;
    }
    if (path === PULL_PATH) {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          baseSha: BASE_SHA,
          headSha: HEAD_SHA,
          briefAvailable: true,
          comparisons: {},
        }),
      );
      return;
    }
    if (path === DIFF_PATH && stub.diffStatus === 200) {
      response.end(LARGE_DIFF);
      return;
    }
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "not found", code: "not-found" }));
  });
}

async function startStubServer(): Promise<string> {
  server = makeStubServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("stub server has no port");
  }
  return `http://127.0.0.1:${address.port}`;
}

/** Spawn the bundle with every stream piped; `closeAfterFirstChunk` hangs up like `| head`. */
function runBin(closeAfterFirstChunk = false): Promise<BinRun> {
  const child = spawn(
    process.execPath,
    [bundlePath, "-R", "octo/hello", "diff", String(PR_NUMBER)],
    {
      cwd: mkdtempSync(`${SCRATCH_PREFIX}cwd-`),
      env: {
        PATH: process.env["PATH"],
        XDG_CONFIG_HOME: configHome,
        XDG_CACHE_HOME: cacheHome,
        MERGEBRIEF_NO_VERSION_WARNING: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    stdout.push(chunk);
    if (closeAfterFirstChunk) {
      child.stdout.destroy();
    }
  });
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  return new Promise((resolve) => {
    child.on("close", (code) => {
      const stderrBytes = Buffer.concat(stderr);
      resolve({
        code,
        stdout: Buffer.concat(stdout),
        stderr: stderrBytes.toString("utf8"),
      });
    });
  });
}

beforeAll(async () => {
  const outDir = mkdtempSync(`${SCRATCH_PREFIX}build-`);
  await build({ ...cliOptions, outDir, config: false, silent: true });
  bundlePath = join(outDir, "mergebrief.js");

  const baseUrl = await startStubServer();
  configHome = mkdtempSync(`${SCRATCH_PREFIX}config-`);
  cacheHome = mkdtempSync(`${SCRATCH_PREFIX}cache-`);
  saveConfig(join(configHome, "mergebrief"), {
    defaultProfile: "default",
    profiles: { default: { baseUrl, token: "mergebrief_bin" } },
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("the built CLI writing into a pipe", () => {
  it("prints every byte of a diff over 1 MB through a pipe", async () => {
    stub.diffStatus = 200;

    const run = await runBin();

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.stderr).toBe("");
    expect(run.stdout.length).toBe(Buffer.byteLength(LARGE_DIFF));
    expect(run.stdout.toString("utf8")).toBe(LARGE_DIFF);
  });

  it("keeps the command's exit code when output goes through a pipe", async () => {
    stub.diffStatus = 404;

    const run = await runBin();
    const stderrLines = run.stderr.trimEnd().split("\n");

    expect(run.code).toBe(ExitCodes.NOT_FOUND);
    expect(run.stdout.length).toBe(0);
    expect(stderrLines).toHaveLength(1);
  });

  it("exits quietly with its code when the reader closes early", async () => {
    stub.diffStatus = 200;

    const run = await runBin(true);

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.stderr).toBe("");
  });
});
