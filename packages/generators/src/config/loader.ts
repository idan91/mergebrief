import { readFileSync } from "node:fs";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { Result } from "types";
import { configError, type ConfigError } from "../contract/errors";
import {
  defaultGeneratorConfig,
  validateGeneratorConfig,
  type GeneratorConfig,
} from "./registry";

/**
 * The instance-config loader (BRIEF-11 decision 6): ONE optional YAML file,
 * conventionally `mergebrief.config.yaml` next to the compose file, pointed
 * at by `MERGEBRIEF_CONFIG`. The env var unset means zero-config defaults —
 * today's behavior exactly. Every boot-knowable problem returns a
 * ConfigError with per-field issues, values omitted:
 *
 * - path set but unreadable
 * - not valid YAML (position only — never file content, which can carry
 *   keys pasted by mistake)
 * - unknown root keys (strict; single `x-*` carve-out, the compose-file
 *   convention for vendored extensions)
 * - a `generator:` block failing the registry-derived union (strict per
 *   adapter; token-gated key echoes)
 *
 * The `yaml` dependency lives HERE only.
 */

export interface LoadedGeneratorConfig {
  generator: GeneratorConfig;
  /** The file the config came from; null for zero-config defaults. */
  source: string | null;
}

/** Env-driven load for long-lived processes (worker, web). */
export function loadGeneratorConfig(
  env: Record<string, string | undefined>,
): Result<LoadedGeneratorConfig, ConfigError> {
  const path = env["MERGEBRIEF_CONFIG"];
  if (path === undefined) {
    return {
      ok: true,
      value: { generator: defaultGeneratorConfig, source: null },
    };
  }
  // Set-but-empty is NOT unset (repo convention: loaders distinguish the
  // two — an operator who set it believes it points somewhere). The empty
  // path falls through to the file loader's sanitized read failure.
  return loadGeneratorConfigFile(path);
}

/** Explicit-path load (categorizer `--config`; no ambient env honoring). */
export function loadGeneratorConfigFile(
  path: string,
): Result<LoadedGeneratorConfig, ConfigError> {
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
    // Position only — YAML error messages embed source snippets, and a
    // config file is exactly where a pasted credential could sit.
    const position =
      error instanceof YAMLParseError && error.linePos?.[0]
        ? ` at line ${error.linePos[0].line}`
        : "";
    return configError([`config file: not valid YAML${position}`]);
  }

  if (root === null || root === undefined) {
    // An empty file is a valid zero-config choice.
    return {
      ok: true,
      value: { generator: defaultGeneratorConfig, source: path },
    };
  }
  if (typeof root !== "object" || Array.isArray(root)) {
    return configError(["config file: root must be a YAML mapping"]);
  }

  const issues: string[] = [];
  for (const key of Object.keys(root)) {
    if (key === "generator" || key.startsWith("x-")) continue;
    issues.push(`config file: unrecognized root key ${renderKey(key)}`);
  }
  if (issues.length > 0) return configError(issues);

  const block = Reflect.get(root, "generator");
  if (block === undefined) {
    return {
      ok: true,
      value: { generator: defaultGeneratorConfig, source: path },
    };
  }

  const validated = validateGeneratorConfig(block);
  if (!validated.ok) {
    return configError(
      validated.error.issues.map((issue) => `generator: ${issue}`),
    );
  }
  return { ok: true, value: { generator: validated.value, source: path } };
}

/** Keys echo only when token-shaped: short, letters and dashes ONLY — key
 * material is digit-bearing (sk-or-abc123…), so digits disqualify. Same
 * grammar as the registry's CONFIG_KEY_TOKEN. */
const ROOT_KEY_TOKEN = /^[A-Za-z][A-Za-z-]{0,19}$/;

function renderKey(key: string): string {
  return ROOT_KEY_TOKEN.test(key) ? `"${key}"` : "(redacted)";
}
