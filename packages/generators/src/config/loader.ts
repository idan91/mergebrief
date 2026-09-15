import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import {
  DEFAULT_CONTEXT_SOURCES,
  validateContextSourcesBlock,
  type ContextSourcesConfig,
} from "./context-sources";
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
import {
  DEFAULT_TRACKERS,
  validateTrackersBlock,
  type TrackerConfig,
} from "./trackers";

export interface LoadedGeneratorConfig {
  generator: GeneratorConfig;
  /**
   * The instance spend policy; enforced by the worker's generation gate.
   * Uncapped when the block is absent.
   */
  spend: SpendPolicy;
  /**
   * The credentialed context providers; built-ins need no entry, so the
   * empty default still reads URLs and GitHub issues.
   */
  contextSources: ContextSourcesConfig;
  /** The boards every repo on this instance reads by default; a repo's own settings replace the list. */
  trackers: readonly TrackerConfig[];
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
        contextSources: DEFAULT_CONTEXT_SOURCES,
        trackers: DEFAULT_TRACKERS,
        source: null,
      },
    };
  }
  // Set-but-empty is NOT unset (repo convention: loaders distinguish the
  // two; an operator who set it believes it points somewhere); the
  // resolver rejects it with its own arm. Relative values are
  // workspace-root-anchored so the same env value names the same file in
  // every process.
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
        contextSources: DEFAULT_CONTEXT_SOURCES,
        trackers: DEFAULT_TRACKERS,
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
      key === "contextSources" ||
      key === "trackers" ||
      key.startsWith("x-")
    )
      continue;
    issues.push(`config file: unrecognized root key ${renderKey(key)}`);
  }
  if (issues.length > 0) return configError(issues);

  // The drafts block is ENFORCED by the api process, but bad values refuse
  // boot here too; a worker-only deployment must not carry a
  // silently-broken policy the operator believes is active.
  const drafts = root["drafts"];
  if (drafts !== undefined) {
    const validated = validateDraftsBlock(drafts);
    if (!validated.ok) return validated;
  }

  // The spend block is enforced by the WORKER's generation gate; it is
  // parsed here so a bad cap refuses boot everywhere the file is read,
  // never silently leaving an instance the operator believes is capped.
  const spendBlock = root["spend"];
  let spend = DEFAULT_SPEND_POLICY;
  if (spendBlock !== undefined) {
    const validated = validateSpendBlock(spendBlock);
    if (!validated.ok) return validated;
    spend = validated.value;
  }

  // Credentialed providers are constructed by the composition roots; the
  // shape is refused here so every reader of the file agrees on it.
  const sourcesBlock = root["contextSources"];
  let contextSources = DEFAULT_CONTEXT_SOURCES;
  if (sourcesBlock !== undefined) {
    const validated = validateContextSourcesBlock(sourcesBlock);
    if (!validated.ok) return validated;
    contextSources = validated.value;
  }

  // Boards are read per job by the trackers' reads; the shape is refused
  // here so a bad entry stops boot rather than every generation.
  const trackersBlock = root["trackers"];
  let trackers = DEFAULT_TRACKERS;
  if (trackersBlock !== undefined) {
    const validated = validateTrackersBlock(trackersBlock);
    if (!validated.ok) {
      return configError(
        validated.error.issues.map((issue) => `trackers.${issue}`),
      );
    }
    trackers = validated.value;
  }

  const block = root["generator"];
  if (block === undefined) {
    return {
      ok: true,
      value: {
        generator: defaultGeneratorConfig,
        spend,
        contextSources,
        trackers,
        source: path,
      },
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
    value: {
      generator: validated.value,
      spend,
      contextSources,
      trackers,
      source: path,
    },
  };
}
