// Read the three fixed default-branch paths fresh and validate for injection and snapshots.
// Failures must never reject acquisition: degrade to no config with explicit per-file outcomes.
import type { CustomRiskAttributeInput, RepoContext } from "brief-core";
import type { Mutable } from "types/utils";
import { RepoFileKinds } from "github";
import {
  INSTRUCTIONS_BUDGET_BYTES,
  repoConfigArtifactSchema,
  repoConfigOriginSchema,
  POLICY_MAX_BYTES,
  RepoConfigOutcomes,
  RepoConfigPaths,
  SETTINGS_MAX_BYTES,
  validateRepoConfig,
  type CustomAttribute,
  type FiredCustomAttribute,
  type RepoConfigArtifact,
  type RepoConfigFileInput,
  type RepoConfigFileOutcome,
  type RepoSettingsV1,
  type ValidatedRepoPolicy,
} from "repo-config";
import type { Logger } from "./generate";
import type { PullRequestSource } from "./github-port";

/** The one slice of a brief chunk the fired-attribute scan needs. */
interface FiredScanChunk {
  readonly riskSurface: readonly string[];
}

/** One fetch slot: the fixed path, its byte cap, and the validate-input key. */
const SLOTS = [
  {
    key: "instructions",
    path: RepoConfigPaths.INSTRUCTIONS,
    cap: INSTRUCTIONS_BUDGET_BYTES,
  },
  { key: "settings", path: RepoConfigPaths.SETTINGS, cap: SETTINGS_MAX_BYTES },
  { key: "policy", path: RepoConfigPaths.POLICY, cap: POLICY_MAX_BYTES },
] as const;

export interface AcquiredRepoConfig {
  /** Injection input for `categorize`; undefined when nothing applies. */
  readonly repoContext: RepoContext | undefined;
  /** Validated workflow settings; the entry gate reads `entryCommentOnDrafts`. */
  readonly settings: RepoSettingsV1 | undefined;
  /** Validated policy (de-emphasis rules feed the snapshot). */
  readonly policy: ValidatedRepoPolicy | undefined;
  /** Per-file outcome table, fetch-level outcomes already merged in. */
  readonly files: readonly RepoConfigFileOutcome[];
  readonly collisions: readonly string[];
}

/** The no-config acquisition, also the fail-open fallback shape. */
function nothingAcquired(
  files: readonly RepoConfigFileOutcome[],
): AcquiredRepoConfig {
  return {
    repoContext: undefined,
    settings: undefined,
    policy: undefined,
    files,
    collisions: [],
  };
}

/**
 * Per-file fetch failures preserve successful siblings. A validation/shaping crash retains
 * absent/fetch-failed truth and marks fetched files invalid with static detail.
 * Log only static reasons and error names, never unvetted messages that may echo config.
 */
export async function acquireRepoConfig(
  source: PullRequestSource,
  log: Logger,
): Promise<AcquiredRepoConfig> {
  const fetched = await fetchSlots(source, log);
  try {
    return validateAndShape(fetched, log);
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    log.warn(
      `repo config: validation crashed (${name}) — generating without repo config`,
    );
    const files = SLOTS.map(
      (slot): RepoConfigFileOutcome =>
        fetched.overrides.get(slot.path) ??
        (fetched.inputs[slot.key] === undefined
          ? {
              path: slot.path,
              blobSha: null,
              outcome: RepoConfigOutcomes.ABSENT,
            }
          : {
              path: slot.path,
              blobSha: fetched.inputs[slot.key]?.blobSha ?? null,
              outcome: RepoConfigOutcomes.INVALID,
              detail: "repo-config validation failed unexpectedly",
            }),
    );
    return nothingAcquired(files);
  }
}

interface FetchedSlots {
  readonly inputs: {
    instructions?: RepoConfigFileInput;
    settings?: RepoConfigFileInput;
    policy?: RepoConfigFileInput;
  };
  /** Fetch-level outcomes that pre-empt validation's view of a slot. */
  readonly overrides: ReadonlyMap<string, RepoConfigFileOutcome>;
}

async function fetchSlots(
  source: PullRequestSource,
  log: Logger,
): Promise<FetchedSlots> {
  const inputs: FetchedSlots["inputs"] = {};
  const overrides = new Map<string, RepoConfigFileOutcome>();

  const results = await Promise.all(
    SLOTS.map((slot) => source.fetchRepoFile(slot.path, slot.cap)),
  );
  for (const [index, slot] of SLOTS.entries()) {
    const result = results[index];
    if (result === undefined || !result.ok) {
      // GitHub 5xx / transport failure: fail-open, loud. The detail is a
      // `mapRequestError` product, sanitized by construction.
      const detail =
        result === undefined ? "no fetch result" : result.error.message;
      overrides.set(slot.path, {
        path: slot.path,
        blobSha: null,
        outcome: RepoConfigOutcomes.FETCH_FAILED,
        detail,
      });
      log.warn(
        `repo config: ${slot.path} fetch failed (${detail}) — continuing without it`,
      );
      continue;
    }
    const file = result.value;
    if (file.kind === RepoFileKinds.ABSENT) {
      continue; // validate reports the canonical `absent` outcome.
    }
    if (file.kind === RepoFileKinds.TOO_LARGE) {
      // Rejected before decode, the validator never sees content, so the
      // over-budget outcome is stamped here with the fetch-level facts.
      overrides.set(slot.path, {
        path: slot.path,
        blobSha: file.blobSha,
        outcome: RepoConfigOutcomes.OVER_BUDGET,
        bytesUsed: file.size,
        bytesBudget: slot.cap,
        detail: "file exceeds its byte cap",
      });
      log.warn(
        `repo config: ${slot.path} over its ${slot.cap}-byte cap (${file.size} bytes) — rejected whole`,
      );
      continue;
    }
    inputs[slot.key] = {
      path: slot.path,
      content: file.content,
      blobSha: file.blobSha,
    };
  }
  return { inputs, overrides };
}

function validateAndShape(
  fetched: FetchedSlots,
  log: Logger,
): AcquiredRepoConfig {
  const validated = validateRepoConfig(fetched.inputs);
  const files = validated.outcomes.map(
    (outcome) => fetched.overrides.get(outcome.path) ?? outcome,
  );
  for (const outcome of files) {
    if (outcome.outcome === RepoConfigOutcomes.INVALID) {
      log.warn(
        `repo config: ${outcome.path} invalid — ${outcome.detail ?? "rejected whole"}`,
      );
    }
  }

  const customAttributes: CustomRiskAttributeInput[] =
    validated.policy === undefined
      ? []
      : Object.entries(validated.policy.attributes).map(([name, def]) =>
          shapeCustomAttribute(name, def),
        );
  const instructions =
    validated.instructions === undefined
      ? undefined
      : {
          path: RepoConfigPaths.INSTRUCTIONS,
          blobSha: validated.instructions.blobSha,
          content: validated.instructions.content,
        };
  const context: Mutable<RepoContext> = { customAttributes };

  if (instructions !== undefined) context.instructions = instructions;

  const inPlay = instructions !== undefined || customAttributes.length > 0;
  const repoContext = inPlay ? context : undefined;

  return {
    repoContext,
    settings: validated.settings,
    policy: validated.policy,
    files,
    collisions: validated.collisions,
  };
}

/**
 * Serialize the `generation.repo_config` origin data: the merged per-file
 * outcome table + collision disclosures, recorded right after acquisition so
 * failed/superseded runs keep their outcomes.
 */
export function buildRepoConfigOrigin(acquired: AcquiredRepoConfig): string {
  return JSON.stringify(
    repoConfigOriginSchema.parse({
      files: acquired.files.map((file) => ({ ...file })),
      collisions: [...acquired.collisions],
    }),
  );
}

/** A policy attribute as brief-core takes it; scope and implication ride only when set. */
function shapeCustomAttribute(
  name: string,
  def: CustomAttribute,
): CustomRiskAttributeInput {
  const attribute: Mutable<CustomRiskAttributeInput> = {
    name,
    criteria: def.criteria,
  };

  if (def.implication !== undefined) attribute.implication = def.implication;
  if (def.paths !== undefined) attribute.paths = def.paths;

  return attribute;
}

/** The same attribute as the stored artifact carries it (own copy of `paths`). */
function shapeFiredCustomAttribute(
  name: string,
  def: CustomAttribute,
): FiredCustomAttribute {
  const attribute: FiredCustomAttribute = { name, criteria: def.criteria };

  if (def.implication !== undefined) attribute.implication = def.implication;
  if (def.paths !== undefined) attribute.paths = [...def.paths];

  return attribute;
}

/**
 * Serialize the `brief.repo_config` snapshot: the merged per-file outcome
 * table, collision disclosures, and, when a policy applied, the definitions
 * of the custom attributes that actually FIRED on this brief plus the
 * de-emphasis rules in effect.
 */
export function buildRepoConfigArtifact(
  acquired: AcquiredRepoConfig,
  chunks: readonly FiredScanChunk[],
): string {
  let policy: RepoConfigArtifact["policy"] = null;
  if (acquired.policy !== undefined) {
    const firedNames = new Set(chunks.flatMap((chunk) => chunk.riskSurface));
    const firedCustomAttributes = Object.entries(acquired.policy.attributes)
      .filter(([name]) => firedNames.has(name))
      .map(([name, def]) => shapeFiredCustomAttribute(name, def));
    policy = {
      firedCustomAttributes,
      deEmphasize: [...acquired.policy.deEmphasize],
    };
  }
  // Parse through the shared artifact schema before storing: the writer
  // self-checks against the exact contract readers enforce (slot tuple,
  // constrained fired definitions, no floor de-emphasis). A parse failure
  // here is a programmer error, throw, never store a malformed snapshot.
  const artifact: RepoConfigArtifact = repoConfigArtifactSchema.parse({
    files: acquired.files.map((file) => ({ ...file })),
    collisions: [...acquired.collisions],
    policy,
  });
  return JSON.stringify(artifact);
}
