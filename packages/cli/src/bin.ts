#!/usr/bin/env node
// The thin bin over the client module (ADR 0028 #1): real-world deps wired
// here and ONLY here — the whole CLI stays testable behind `runCli`.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runCli } from "./program";

function xdgDir(envVar: string, fallback: string): string {
  const base = process.env[envVar];
  return join(base ?? join(homedir(), fallback), "mergebrief");
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
      rl.question("Paste your token (input hidden is not supported — clear your scrollback): ", (answer) => {
        rl.close();
        resolve(answer);
      });
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

const code = await runCli(process.argv.slice(2), {
  fetch: (input, init) => fetch(input, init),
  env: process.env,
  configDir: xdgDir("XDG_CONFIG_HOME", ".config"),
  cacheDir: xdgDir("XDG_CACHE_HOME", ".cache"),
  stdout: (text) => process.stdout.write(text),
  stderr: (line) => process.stderr.write(`${line}\n`),
  readStdin,
  gitOriginUrl,
});
process.exit(code);
