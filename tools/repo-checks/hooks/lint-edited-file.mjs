// PostToolUse hook for Edit and Write: oxlint on the one edited file, warn
// only. It always exits 0, so a finding never blocks a session, and it never
// lints any file but the one the tool just wrote.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = realpathSync(
  fileURLToPath(new URL("../../..", import.meta.url)),
);
const OXLINT = join(REPO_ROOT, "node_modules/.bin/oxlint");
const LINTED_EXTENSIONS = new Set([".ts", ".tsx", ".mjs"]);
const LINT_TIMEOUT_MS = 20_000;

/** @returns {string | undefined} */
function readEditedPath() {
  try {
    /** @type {unknown} */
    const input = JSON.parse(readFileSync(0, "utf8"));
    if (
      typeof input !== "object" ||
      input === null ||
      !("tool_input" in input)
    ) {
      return undefined;
    }
    const toolInput = input.tool_input;
    if (
      typeof toolInput !== "object" ||
      toolInput === null ||
      !("file_path" in toolInput)
    ) {
      return undefined;
    }
    const filePath = toolInput.file_path;
    return typeof filePath === "string" ? filePath : undefined;
  } catch {
    return undefined;
  }
}

/** @param {string} filePath The repo-relative path of an edited lintable file. */
function resolveRepoFile(filePath) {
  if (!isAbsolute(filePath) || !LINTED_EXTENSIONS.has(extname(filePath))) {
    return undefined;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return undefined;
  }
  const real = realpathSync(filePath);
  const inside = relative(REPO_ROOT, real);
  const outside =
    inside === ".." || inside.startsWith("../") || isAbsolute(inside);
  return outside ? undefined : inside;
}

function lintEditedFile() {
  const filePath = readEditedPath();
  const file = filePath === undefined ? undefined : resolveRepoFile(filePath);
  if (file === undefined || !existsSync(OXLINT)) {
    return;
  }

  const run = spawnSync(
    OXLINT,
    ["--quiet", "--no-error-on-unmatched-pattern", "--", file],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: LINT_TIMEOUT_MS },
  );
  if (run.status !== 0) {
    // PostToolUse passes `additionalContext` to the agent on exit 0; stderr
    // alone would reach only the transcript.
    const findings = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `oxlint on the file just edited:\n${findings}`,
      },
    };
    process.stdout.write(JSON.stringify(output));
  }
}

try {
  lintEditedFile();
} catch {
  // Warn-only: a hook failure must never surface as a blocked edit.
}
process.exit(0);
