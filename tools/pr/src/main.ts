// The PR tool's composition root: argv, the environment and child processes
// enter here, and the exit code is the verdict. Everything below takes its
// inputs as parameters.
import { spawnSync } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import type { Result } from "types/utils";

import { runAssets } from "./logic/assets";
import { readOriginUrl } from "./logic/git";
import { parseRepoSlug } from "./logic/github";
import { runReply } from "./logic/reply";
import { runStackStatus, type StackStatusDeps } from "./logic/stack-status";
import type { CommandOutcome, CommandRunner } from "./types";

/** 0: clean, 1: the tool failed, 2: the stack needs action (open thread, new activity, stale base, checkout off top). */
const NEEDS_ATTENTION_EXIT = 2;
let needsAttention = false;

const USAGE = `usage:
  stack-status <pr> [<pr> ...]        PRs bottom first
  reply <pr> <comment-id> <body-file>  reply on a review thread and remember it
  assets <ticket> <file> [<file> ...]  push images to assets/<ticket>, print markdown links`;

// pnpm -C moves the working directory; INIT_CWD is where the caller stood.
const CALLER_CWD = process.env["INIT_CWD"] ?? process.cwd();

function makeRunner(command: string): CommandRunner {
  return (args, input) => {
    const run = spawnSync(command, args, {
      cwd: CALLER_CWD,
      encoding: "utf8",
      input,
    });
    const outcome: CommandOutcome = {
      status: run.status ?? 1,
      stdout: run.stdout ?? "",
      stderr: run.stderr ?? String(run.error ?? ""),
    };
    return outcome;
  };
}

function parsePositiveInts(values: readonly string[]): number[] | undefined {
  const numbers = values.map((value) => Number(value.replace(/^#/, "")));
  const valid =
    numbers.length > 0 && numbers.every((n) => Number.isInteger(n) && n > 0);
  return valid ? numbers : undefined;
}

function buildDeps(): Result<StackStatusDeps, Error> {
  const git = makeRunner("git");
  const commonDir = git([
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (commonDir.status !== 0) {
    return { ok: false, error: new Error("not inside a git checkout") };
  }
  // The common dir is shared by every worktree, so replies recorded anywhere count.
  const replyStorePath = join(
    commonDir.stdout.trim(),
    "pr-tool",
    "replies.json",
  );
  return { ok: true, value: { git, gh: makeRunner("gh"), replyStorePath } };
}

function runCommand(argv: readonly string[]): Result<string, Error> {
  const [command, ...rest] = argv;
  const deps = buildDeps();
  if (!deps.ok) {
    return deps;
  }
  if (command === "stack-status") {
    const numbers = parsePositiveInts(rest);
    if (numbers === undefined) {
      return { ok: false, error: new Error(USAGE) };
    }
    const report = runStackStatus(deps.value, numbers);
    if (!report.ok) {
      return report;
    }
    needsAttention = report.value.needsAttention;
    return { ok: true, value: report.value.text };
  }
  if (command === "reply" && rest.length === 3) {
    const ids = parsePositiveInts(rest.slice(0, 2));
    const [pullNumber, commentId] = ids ?? [];
    const bodyFile = rest[2] ?? "";
    if (pullNumber === undefined || commentId === undefined) {
      return { ok: false, error: new Error(USAGE) };
    }
    const bodyPath = isAbsolute(bodyFile)
      ? bodyFile
      : resolve(CALLER_CWD, bodyFile);
    return runReply(deps.value, pullNumber, commentId, bodyPath);
  }
  if (command === "assets" && rest.length >= 2) {
    const [ticket = "", ...files] = rest;
    const origin = readOriginUrl(deps.value.git);
    const slug = origin.ok ? parseRepoSlug(origin.value) : origin;
    if (!slug.ok) {
      return slug;
    }
    const paths = files.map((file) => resolve(CALLER_CWD, file));
    return runAssets({ ...deps.value, slug: slug.value }, ticket, paths);
  }
  return { ok: false, error: new Error(USAGE) };
}

const result = runCommand(process.argv.slice(2));
if (result.ok) {
  process.stdout.write(`${result.value}\n`);
  if (needsAttention) {
    process.exitCode = NEEDS_ATTENTION_EXIT;
  }
} else {
  process.stderr.write(`pr: ${result.error.message}\n`);
  process.exitCode = 1;
}
