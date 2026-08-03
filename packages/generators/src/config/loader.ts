import type { Result } from "types";
import { configError, type ConfigError } from "../contract/errors";
import { validateDraftsBlock } from "./instancePolicy";
import { readConfigRoot, renderKey, resolveEnvConfigPath } from "./readRoot";
import {
  DEFAULT_SPEND_POLICY,
  validateSpendBlock,
  type SpendPolicy,
} from "./spendPolicy";
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
  /**
   * The instance spend policy (BRIEF-20) — enforced by the worker's
   * generation gate. Uncapped when the block is absent.
   */
  spend: SpendPolicy;
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
      value: {
        generator: defaultGeneratorConfig,
        spend: DEFAULT_SPEND_POLICY,
        source: null,
      },
    };
  }
  // Set-but-empty is NOT unset (repo convention: loaders distinguish the
  // two — an operator who set it believes it points somewhere); the
  // resolver rejects it with its own arm. Relative values are
  // workspace-root-anchored (BRIEF-70) so the same env value names the
  // same file in every process.
  const resolved = resolveEnvConfigPath(path, process.cwd());
  if (!resolved.ok) return resolved;
  return loadGeneratorConfigFile(resolved.value);
}

/** Explicit-path load (categorizer `--config`; no ambient env honoring). */
export function loadGeneratorConfigFile(
  path: string,
): Result<LoadedGeneratorConfig, ConfigError> {
  const read = readConfigRoot(path);
  if (!read.ok) return read;
  const root = read.value;

  if (root === null) {
    // An empty file is a valid zero-config choice.
    return {
      ok: true,
      value: {
        generator: defaultGeneratorConfig,
        spend: DEFAULT_SPEND_POLICY,
        source: path,
      },
    };
  }

  const issues: string[] = [];
  for (const key of Object.keys(root)) {
    if (
      key === "generator" ||
      key === "drafts" ||
      key === "spend" ||
      key.startsWith("x-")
    )
      continue;
    issues.push(`config file: unrecognized root key ${renderKey(key)}`);
  }
  if (issues.length > 0) return configError(issues);

  // The drafts block is ENFORCED by the api process (BRIEF-64), but bad
  // values refuse boot here too — a worker-only deployment must not carry a
  // silently-broken policy the operator believes is active.
  const drafts = root["drafts"];
  if (drafts !== undefined) {
    const validated = validateDraftsBlock(drafts);
    if (!validated.ok) return validated;
  }

  // The spend block (BRIEF-20) is enforced by the WORKER's generation gate;
  // it is parsed here so a bad cap refuses boot everywhere the file is read,
  // never silently leaving an instance the operator believes is capped.
  const spendBlock = root["spend"];
  let spend = DEFAULT_SPEND_POLICY;
  if (spendBlock !== undefined) {
    const validated = validateSpendBlock(spendBlock);
    if (!validated.ok) return validated;
    spend = validated.value;
  }

  const block = root["generator"];
  if (block === undefined) {
    return {
      ok: true,
      value: { generator: defaultGeneratorConfig, spend, source: path },
    };
  }

  const validated = validateGeneratorConfig(block);
  if (!validated.ok) {
    return configError(
      validated.error.issues.map((issue) => `generator: ${issue}`),
    );
  }
  return {
    ok: true,
    value: { generator: validated.value, spend, source: path },
  };
}
