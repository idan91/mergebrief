#!/usr/bin/env node
// Real-world deps are wired here and ONLY here, so the whole CLI stays testable
// behind `runCli`.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { CLI_VERSION } from "./client";
import { resolveFinalExitCode, watchStream } from "./flush-output";
import { runCli } from "./program";
import { startUpdateCheck } from "./version/update-nag";

function xdgDir(envVar: string, fallback: string): string {
  const base = process.env[envVar];
  return join(base ?? join(homedir(), fallback), "mergebrief");
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    return new Promise((resolve) => {
      rl.question(
        "Paste your token (input hidden is not supported; clear your scrollback): ",
        (answer) => {
          rl.close();
          resolve(answer);
        },
      );
    });
  }
  let data = "";
  for await (const chunk of process.stdin) {
    data += String(chunk);
  }
  return data;
}

function gitOriginUrl(): string | undefined {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/** `$PAGER` for `diff` on a TTY; cosmetics only. */
function makePager(): ((text: string) => Promise<void>) | undefined {
  const pager = process.env["PAGER"];
  if (!process.stdout.isTTY || pager === undefined || pager.length === 0) {
    return undefined;
  }
  return (text) =>
    new Promise((resolve) => {
      const child = spawn(pager, {
        shell: true,
        stdio: ["pipe", "inherit", "inherit"],
      });
      child.on("close", () => resolve());
      child.on("error", () => {
        process.stdout.write(text);
        resolve();
      });
      child.stdin.end(text);
    });
}

const watchedStdout = watchStream(process.stdout);
const watchedStderr = watchStream(process.stderr);
const successNotices: string[] = [];
const cacheDir = xdgDir("XDG_CACHE_HOME", ".cache");
// Beside the command, never after it: the answer is taken only if it settled
// by exit, so a slow registry costs nothing.
const updateCheck = startUpdateCheck({
  fetch: (input, init) => fetch(input, init),
  cacheDir,
  env: process.env,
  cliVersion: CLI_VERSION,
});
const code = await runCli(process.argv.slice(2), {
  fetch: (input, init) => fetch(input, init),
  pager: makePager(),
  readFile: (path) => readFileSync(path, "utf8"),
  readBinaryFile: (path) => new Uint8Array(readFileSync(path)),
  env: process.env,
  configDir: xdgDir("XDG_CONFIG_HOME", ".config"),
  cacheDir,
  stdout: (text) => process.stdout.write(text),
  stderr: (line) => process.stderr.write(`${line}\n`),
  successNotice: (line) => successNotices.push(line),
  readStdin,
  gitOriginUrl,
});
// process.exit drops whatever a pipe has not taken yet: flush first.
const exitCode = await resolveFinalExitCode({
  code,
  stdout: watchedStdout,
  stderr: watchedStderr,
  writeStderr: (line) => process.stderr.write(`${line}\n`),
  successNotices,
  settleUpdateNag: (succeeded) => updateCheck.settle(succeeded),
});
process.exit(exitCode);
