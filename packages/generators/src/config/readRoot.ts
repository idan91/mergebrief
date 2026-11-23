import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import { DEFAULT_CONFIG_FILE } from "./consts";

/**
 * Shared file→root-mapping step for the instance-config loaders (the full
 * generator loader and the narrow policy loader): read the file, parse the
 * YAML, and require a mapping (or empty) root. Sanitization
 * posture lives HERE once: io errors echo only the code, YAML errors echo
 * only the position; file content can carry pasted credentials.
 */

const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** `null` root = empty file, a valid zero-config choice. */
export type ConfigRoot = Record<string, unknown> | null;

// Relative paths anchor at the workspace root because processes have different
// working directories. Outside a checkout, use an absolute path.
// Interactive CLI --config paths deliberately use their own cwd resolver.
export function resolveEnvConfigPath(
  path: string,
  cwd: string,
): Result<string, ConfigError> {
  // Set-but-empty is its own arm (unset ≠ empty, repo convention): calling
  // it out beats the walk-up landing on the workspace root DIRECTORY and
  // surfacing as a baffling EISDIR.
  if (path === "") {
    return configError([
      `MERGEBRIEF_CONFIG: set but empty. Unset it to read ${DEFAULT_CONFIG_FILE} at the workspace root, or point it at a config file`,
    ]);
  }
  if (isAbsolute(path)) {
    return { ok: true, value: path };
  }
  const root = findWorkspaceRoot(cwd);
  if (root === undefined) {
    return configError([
      "MERGEBRIEF_CONFIG: relative path, but no workspace root (pnpm-workspace.yaml) above the working directory. Use an absolute path",
    ]);
  }
  return { ok: true, value: join(root, path) };
}

/** The nearest directory at or above `cwd` that holds `pnpm-workspace.yaml`. */
function findWorkspaceRoot(cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** The default config file of the workspace `cwd` sits in, when that file exists. */
export function findDefaultConfigFile(cwd: string): string | undefined {
  const root = findWorkspaceRoot(cwd);
  if (root === undefined) {
    return undefined;
  }
  const file = join(root, DEFAULT_CONFIG_FILE);
  return existsSync(file) ? file : undefined;
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
    // excerpts to stderr (e.g. unresolved tags echo the whole line); a
    // config file is where a pasted credential could sit. Errors still
    // throw and are position-sanitized below.
    root = parseYaml(text, { logLevel: "error" });
  } catch (error) {
    // Position only; YAML error messages embed source snippets.
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

/** The mapping check above IS the validation; this narrows the type for it. */
function rootRecord(root: object): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(root)) {
    record[key] = value;
  }
  return record;
}
