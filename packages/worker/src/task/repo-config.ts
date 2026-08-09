// The worker's repo-config phase (ADR 0032 #4/#5, plan PR 4): fetch the three
// fixed `.mergebrief/` paths from the DEFAULT BRANCH (fresh per generation,
// no cache), validate via `repo-config`'s pure core, and shape the results
// for the two consumers — the categorizer's `RepoContext` injection and the
// `brief.repo_config` origin snapshot.
//
// FAIL-OPEN is the whole contract here: nothing in this module ever throws
// for an expected failure, and `acquireRepoConfig` never rejects — a GitHub
// 5xx, an unreadable blob, or a validation surprise degrades to "generate
// without repo config" with a LOUD `fetch-failed` outcome on the record. A
// PR author cannot induce a GitHub 5xx, so fail-open is not a scrutiny-
// evasion channel (ADR 0032 #4).
import type { CustomRiskAttributeInput, RepoContext } from "brief-core";
import { RepoFileKind } from "github";
import {
  INSTRUCTIONS_BUDGET_BYTES,
  repoConfigArtifactSchema,
  repoConfigOriginSchema,
  POLICY_MAX_BYTES,
  RepoConfigOutcome,
  RepoConfigPaths,
  SETTINGS_MAX_BYTES,
  validateRepoConfig,
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
  /** Validated workflow settings (PR 7 consumes `entryCommentOnDrafts`). */
  readonly settings: RepoSettingsV1 | undefined;
  /** Validated policy (de-emphasis rules feed the snapshot). */
  readonly policy: ValidatedRepoPolicy | undefined;
  /** Per-file outcome table — fetch-level outcomes already merged in. */
  readonly files: readonly RepoConfigFileOutcome[];
  readonly collisions: readonly string[];
}

/** The no-config acquisition — also the fail-open fallback shape. */
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
 * Fetch + validate the repo-config surface for one generation. Never throws.
 * Failure granularity (codex PR 4 r1):
 *   - a per-file FETCH failure marks that file `fetch-failed` and validation
 *     still runs on whatever fetched cleanly;
 *   - an unexpected crash in validation/shaping (should be impossible — the
 *     core is pure and never-throws by contract) degrades to no config while
 *     KEEPING each slot's fetch truth: absent stays `absent`, fetch problems
 *     keep their outcome, and a cleanly-fetched file is marked `invalid` with
 *     a static detail (its content is what the validator crashed on).
 * Log lines carry static reasons + the error NAME only — never the message
 * (an unexpected error's text is unvetted for content echo).
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
              outcome: RepoConfigOutcome.ABSENT,
            }
          : {
              path: slot.path,
              blobSha: fetched.inputs[slot.key]?.blobSha ?? null,
              outcome: RepoConfigOutcome.INVALID,
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
      // GitHub 5xx / transport failure: fail-open, loud (ADR 0032 #4). The
      // detail is a `mapRequestError` product — sanitized by construction.
      const detail =
        result === undefined ? "no fetch result" : result.error.message;
      overrides.set(slot.path, {
        path: slot.path,
        blobSha: null,
        outcome: RepoConfigOutcome.FETCH_FAILED,
        detail,
      });
      log.warn(
        `repo config: ${slot.path} fetch failed (${detail}) — continuing without it`,
      );
      continue;
    }
    const file = result.value;
    if (file.kind === RepoFileKind.ABSENT) {
      continue; // validate reports the canonical `absent` outcome.
    }
    if (file.kind === RepoFileKind.TOO_LARGE) {
      // Rejected before decode — the validator never sees content, so the
      // over-budget outcome is stamped here with the fetch-level facts.
      overrides.set(slot.path, {
        path: slot.path,
        blobSha: file.blobSha,
        outcome: RepoConfigOutcome.OVER_BUDGET,
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
    if (outcome.outcome === RepoConfigOutcome.INVALID) {
      log.warn(
        `repo config: ${outcome.path} invalid — ${outcome.detail ?? "rejected whole"}`,
      );
    }
  }

  const customAttributes: CustomRiskAttributeInput[] =
    validated.policy === undefined
      ? []
      : Object.entries(validated.policy.attributes).map(([name, def]) => ({
          name,
          criteria: def.criteria,
          ...(def.implication === undefined
            ? {}
            : { implication: def.implication }),
          ...(def.paths === undefined ? {} : { paths: def.paths }),
        }));
  const instructions =
    validated.instructions === undefined
      ? undefined
      : {
          path: RepoConfigPaths.INSTRUCTIONS,
          blobSha: validated.instructions.blobSha,
          content: validated.instructions.content,
        };
  const repoContext: RepoContext | undefined =
    instructions === undefined && customAttributes.length === 0
      ? undefined
      : {
          ...(instructions === undefined ? {} : { instructions }),
          customAttributes,
        };

  return {
    repoContext,
    settings: validated.settings,
    policy: validated.policy,
    files,
    collisions: validated.collisions,
  };
}

/**
 * Serialize the `generation.repo_config` origin data (ADR 0032 #8): the
 * merged per-file outcome table + collision disclosures, recorded right
 * after acquisition so failed/superseded runs keep their outcomes.
 */
export function buildRepoConfigOrigin(acquired: AcquiredRepoConfig): string {
  return JSON.stringify(
    repoConfigOriginSchema.parse({
      files: acquired.files.map((file) => ({ ...file })),
      collisions: [...acquired.collisions],
    }),
  );
}

/**
 * Serialize the `brief.repo_config` snapshot (ADR 0032 #8/#11): the merged
 * per-file outcome table, collision disclosures, and — when a policy applied
 * — the definitions of the custom attributes that actually FIRED on this
 * brief plus the de-emphasis rules in effect.
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
      .map(([name, def]) => ({
        name,
        criteria: def.criteria,
        ...(def.implication === undefined
          ? {}
          : { implication: def.implication }),
        ...(def.paths === undefined ? {} : { paths: [...def.paths] }),
      }));
    policy = {
      firedCustomAttributes,
      deEmphasize: [...acquired.policy.deEmphasize],
    };
  }
  // Parse through the shared artifact schema before storing: the writer
  // self-checks against the exact contract readers enforce (slot tuple,
  // constrained fired definitions, no floor de-emphasis). A parse failure
  // here is a programmer error — throw, never store a malformed snapshot.
  const artifact: RepoConfigArtifact = repoConfigArtifactSchema.parse({
    files: acquired.files.map((file) => ({ ...file })),
    collisions: [...acquired.collisions],
    policy,
  });
  return JSON.stringify(artifact);
}
