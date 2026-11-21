import type { Result } from "types/utils";
import { configError, type ConfigError } from "../contract/errors";
import {
  DEFAULT_CONTEXT_SOURCES,
  validateContextSourcesBlock,
  type ContextSourcesConfig,
} from "./context-sources";
import { validateDraftsBlock } from "./instancePolicy";
import { DEFAULT_LINK_FETCH, validateLinkFetchBlock } from "./link-fetch";
import type { LinkFetchPolicy } from "./link-fetch/types";
import { validateAllowedBlock } from "./allowed";
import { validateAttachmentsBlock } from "./attachments";
import { validateAuditBlock } from "./audit";
import {
  listMovedVariables,
  MOVED_GENERATOR_VARIABLES,
  MOVED_RETENTION_VARIABLES,
} from "./moved-variables";
import {
  DEFAULT_RETENTION_POLICY,
  validateRetentionBlock,
  type RetentionPolicy,
} from "./retention";
import { validateOperatorsBlock } from "./operators";
import { readConfigRoot, resolveEnvConfigPath } from "./readRoot";
import { renderKey } from "./render-key";
import {
  DEFAULT_SPEND_POLICY,
  validateSpendBlock,
  type SpendPolicy,
} from "./spendPolicy";
import { validateUpdateCheckBlock } from "./update-check";
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
import {
  parseInstanceTriggerConditions,
  type TriggerConditionsBlock,
} from "./trigger-conditions";

export interface LoadedGeneratorConfig {
  generator: GeneratorConfig;
  /**
   * The instance spend policy; enforced by the worker's generation gate.
   * 300 a day when the block is absent.
   */
  spend: SpendPolicy;
  /**
   * The credentialed context providers; built-ins need no entry, so the
   * empty default still reads URLs and GitHub issues.
   */
  contextSources: ContextSourcesConfig;
  /** The boards every repo on this instance reads by default; a repo's own settings replace the list. */
  trackers: readonly TrackerConfig[];
  /** Whether issue references resolve beyond the PR's repo and its `issuesRepo`; the instance's, whatever a repo's list says. */
  siblingRepos: boolean;
  /** What the generic link fetcher may read; public when the block is absent. */
  linkFetch: LinkFetchPolicy;
  /** Conditions a push meets before it triggers a brief; a repo's block merges over these per kind. */
  triggerConditions: TriggerConditionsBlock | undefined;
  /** How long the daily sweeps keep audit rows and closed pull requests; forever when the block is absent. */
  retention: RetentionPolicy;
  /** The file the config came from; null for zero-config defaults. */
  source: string | null;
}

/** Env-driven load for long-lived processes (worker, web). */
export function loadGeneratorConfig(
  env: Record<string, string | undefined>,
): Result<LoadedGeneratorConfig, ConfigError> {
  const movedVariables = listMovedVariables(env, {
    ...MOVED_GENERATOR_VARIABLES,
    ...MOVED_RETENTION_VARIABLES,
  });
  if (movedVariables.length > 0) {
    return configError(movedVariables);
  }

  const path = env["MERGEBRIEF_CONFIG"];
  if (path === undefined) {
    return {
      ok: true,
      value: {
        generator: defaultGeneratorConfig,
        spend: DEFAULT_SPEND_POLICY,
        contextSources: DEFAULT_CONTEXT_SOURCES,
        trackers: DEFAULT_TRACKERS,
        siblingRepos: false,
        linkFetch: DEFAULT_LINK_FETCH,
        triggerConditions: undefined,
        retention: DEFAULT_RETENTION_POLICY,
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
  if (!resolved.ok) {
    return resolved;
  }
  return loadGeneratorConfigFile(resolved.value);
}

/** Explicit-path load (categorizer `--config`; no ambient env honoring). */
export function loadGeneratorConfigFile(
  path: string,
): Result<LoadedGeneratorConfig, ConfigError> {
  const read = readConfigRoot(path);
  if (!read.ok) {
    return read;
  }
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
        siblingRepos: false,
        linkFetch: DEFAULT_LINK_FETCH,
        triggerConditions: undefined,
        retention: DEFAULT_RETENTION_POLICY,
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
      key === "operators" ||
      key === "allowed" ||
      key === "contextSources" ||
      key === "trackers" ||
      key === "triggerConditions" ||
      key === "linkFetch" ||
      key === "attachments" ||
      key === "retention" ||
      key === "audit" ||
      key === "updateCheck" ||
      key.startsWith("x-")
    ) {
      continue;
    }
    issues.push(`config file: unrecognized root key ${renderKey(key)}`);
  }
  if (issues.length > 0) {
    return configError(issues);
  }

  // The drafts block is ENFORCED by the api process, but bad values refuse
  // boot here too; a worker-only deployment must not carry a
  // silently-broken policy the operator believes is active.
  const drafts = root["drafts"];
  if (drafts !== undefined) {
    const validated = validateDraftsBlock(drafts);
    if (!validated.ok) {
      return validated;
    }
  }

  // The operators block is enforced by the api; a bad list refuses boot here
  // too, so the worker never runs beside an api that refuses the file.
  const operators = root["operators"];
  if (operators !== undefined) {
    const validated = validateOperatorsBlock(operators);
    if (!validated.ok) {
      return validated;
    }
  }

  const allowed = root["allowed"];
  if (allowed !== undefined) {
    const validated = validateAllowedBlock(allowed);
    if (!validated.ok) {
      return validated;
    }
  }

  // The api enforces the attachment limits; a bad block refuses boot here
  // too, so the worker never runs beside an api that refuses the file.
  const attachments = root["attachments"];
  if (attachments !== undefined) {
    const validated = validateAttachmentsBlock(attachments);
    if (!validated.ok) {
      return validated;
    }
  }

  // The spend block is enforced by the WORKER's generation gate; it is
  // parsed here so a bad cap refuses boot everywhere the file is read,
  // never silently leaving an instance the operator believes is capped.
  const spendBlock = root["spend"];
  let spend = DEFAULT_SPEND_POLICY;
  if (spendBlock !== undefined) {
    const validated = validateSpendBlock(spendBlock);
    if (!validated.ok) {
      return validated;
    }
    spend = validated.value;
  }

  // Credentialed providers are constructed by the composition roots; the
  // shape is refused here so every reader of the file agrees on it.
  const sourcesBlock = root["contextSources"];
  let contextSources = DEFAULT_CONTEXT_SOURCES;
  if (sourcesBlock !== undefined) {
    const validated = validateContextSourcesBlock(sourcesBlock);
    if (!validated.ok) {
      return validated;
    }
    contextSources = validated.value;
  }

  // Boards are read per job by the trackers' reads; the shape is refused
  // here so a bad entry stops boot rather than every generation.
  const trackersBlock = root["trackers"];
  let trackers = DEFAULT_TRACKERS;
  let siblingRepos = false;
  if (trackersBlock !== undefined) {
    const validated = validateTrackersBlock(trackersBlock);
    if (!validated.ok) {
      return configError(
        validated.error.issues.map((issue) => `trackers.${issue}`),
      );
    }
    ({ trackers, siblingRepos } = validated.value);
  }

  // Read by the worker per job; a bad block refuses boot rather than
  // holding or releasing pushes on conditions the operator never wrote.
  const triggerConditionsBlock = root["triggerConditions"];
  let triggerConditions: TriggerConditionsBlock | undefined;
  if (triggerConditionsBlock !== undefined) {
    const validated = parseInstanceTriggerConditions(triggerConditionsBlock);
    if (!validated.ok) {
      return configError(validated.error.map((issue) => issue.message));
    }
    triggerConditions = validated.value;
  }

  // The link fetcher runs per job; a bad policy refuses boot rather than
  // leaving the fetcher open where the operator believes it is narrowed.
  const linkFetchBlock = root["linkFetch"];
  let linkFetch = DEFAULT_LINK_FETCH;
  if (linkFetchBlock !== undefined) {
    const validated = validateLinkFetchBlock(linkFetchBlock);
    if (!validated.ok) {
      return validated;
    }
    linkFetch = validated.value;
  }

  // The api reads the audit and updateCheck blocks; a bad one refuses boot
  // here too, so the worker never runs beside an api that refuses the file.
  const auditBlock = root["audit"];
  if (auditBlock !== undefined) {
    const validated = validateAuditBlock(auditBlock);
    if (!validated.ok) {
      return validated;
    }
  }

  const updateCheckBlock = root["updateCheck"];
  if (updateCheckBlock !== undefined) {
    const validated = validateUpdateCheckBlock(updateCheckBlock);
    if (!validated.ok) {
      return validated;
    }
  }

  const retentionBlock = root["retention"];
  let retention = DEFAULT_RETENTION_POLICY;
  if (retentionBlock !== undefined) {
    const validated = validateRetentionBlock(retentionBlock);
    if (!validated.ok) {
      return validated;
    }
    retention = validated.value;
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
        siblingRepos,
        linkFetch,
        triggerConditions,
        retention,
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
      siblingRepos,
      linkFetch,
      triggerConditions,
      retention,
      source: path,
    },
  };
}
