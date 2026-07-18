import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { Result } from "types";
import { configError, type ConfigError } from "../contract/errors";

/**
 * Shared file→root-mapping step for the instance-config loaders (the full
 * generator loader and BRIEF-64's narrow policy loader): read the file,
 * parse the YAML, and require a mapping (or empty) root. Sanitization
 * posture lives HERE once: io errors echo only the code, YAML errors echo
 * only the position — file content can carry pasted credentials.
 */

/** `null` root = empty file, a valid zero-config choice. */
export type ConfigRoot = Record<string, unknown> | null;

/**
 * Resolves a `MERGEBRIEF_CONFIG` value to the file to read (BRIEF-70).
 * Absolute paths pass through. A relative path is anchored at the
 * WORKSPACE ROOT — the nearest ancestor of `cwd` containing
 * `pnpm-workspace.yaml` — never at bare cwd: worker and web run with
 * different working directories (`pnpm --dir`), so cwd-relative would make
 * one env value silently mean a different file per process. Every runtime
 * surface today (local pnpm, the docker images' `COPY . .`) is a full
 * workspace checkout, so the anchor is well-defined; a packaged
 * distribution outside a checkout has no anchor and must use an absolute
 * path (docs/self-host/generators.md).
 *
 * CLI `--config` deliberately does NOT come through here — an interactive
 * shell's cwd is unambiguous.
 */
export function resolveEnvConfigPath(
  path: string,
  cwd: string,
): Result<string, ConfigError> {
  // Set-but-empty is its own arm (unset ≠ empty, repo convention): calling
  // it out beats the walk-up landing on the workspace root DIRECTORY and
  // surfacing as a baffling EISDIR.
  if (path === "") {
    return configError([
      "MERGEBRIEF_CONFIG: set but empty — unset it for zero-config defaults, or point it at a config file",
    ]);
  }
  if (isAbsolute(path)) return { ok: true, value: path };
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return { ok: true, value: join(dir, path) };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return configError([
        "MERGEBRIEF_CONFIG: relative path, but no workspace root (pnpm-workspace.yaml) above the working directory — use an absolute path",
      ]);
    }
    dir = parent;
  }
}

export function readConfigRoot(path: string): Result<ConfigRoot, ConfigError> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null
        ? Reflect.get(error, "code")
        : undefined;
    return configError([
      `config file: not readable (${typeof code === "string" ? code : "io error"})`,
    ]);
  }

  let root: unknown;
  try {
    // logLevel "error": the parser's default WARNING channel prints source
    // excerpts to stderr (e.g. unresolved tags echo the whole line) — a
    // config file is where a pasted credential could sit. Errors still
    // throw and are position-sanitized below.
    root = parseYaml(text, { logLevel: "error" });
  } catch (error) {
    // Position only — YAML error messages embed source snippets.
    const position =
      error instanceof YAMLParseError && error.linePos?.[0]
        ? ` at line ${error.linePos[0].line}`
        : "";
    return configError([`config file: not valid YAML${position}`]);
  }

  if (root === null || root === undefined) {
    return { ok: true, value: null };
  }
  if (typeof root !== "object" || Array.isArray(root)) {
    return configError(["config file: root must be a YAML mapping"]);
  }
  return { ok: true, value: rootRecord(root) };
}

/** Keys echo only when token-shaped: short, letters and dashes ONLY — key
 * material is digit-bearing (sk-or-abc123…), so digits disqualify. Same
 * grammar as the registry's CONFIG_KEY_TOKEN. */
const CONFIG_KEY_ECHO_TOKEN = /^[A-Za-z][A-Za-z-]{0,19}$/;

export function renderKey(key: string): string {
  return CONFIG_KEY_ECHO_TOKEN.test(key) ? `"${key}"` : "(redacted)";
}

/** The mapping check above IS the validation; this narrows the type for it. */
function rootRecord(root: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(root)) {
    record[key] = value;
  }
  return record;
}
