import { z } from "zod/v4";
import type { DraftPolicy, Result } from "types";
import { configError, type ConfigError } from "../contract/errors";
import { validateAllowedBlock, type AllowedAccess } from "./allowed";
import {
  NO_OPERATORS,
  validateOperatorsBlock,
  type OperatorIds,
} from "./operators";
import { readConfigRoot, renderKey, resolveEnvConfigPath } from "./readRoot";
import {
  DEFAULT_SPEND_POLICY,
  validateSpendBlock,
  type SpendPolicy,
} from "./spendPolicy";

/**
 * Runtime marker: the compose worker image bakes
 * `MERGEBRIEF_RUNTIME=compose-worker`, and `createGenerator` refuses harness
 * providers under it; the image ships no CLI binaries, so the generic
 * missing-binary probe error would misdiagnose a deliberate boundary.
 */
export const RUNTIME_MARKER_VAR = "MERGEBRIEF_RUNTIME";

/**
 * The narrow instance-policy loader: the api startup wiring reads ONLY the
 * `drafts`, `spend`, `operators` and `allowed` blocks out of
 * `mergebrief.config.yaml`.
 * Deliberately tolerant of everything else in the file. An invalid generator
 * block or an unknown root key is the FULL loader's (worker's) problem; the
 * api process must boot without adapter validation and without provider
 * keys. Its own keys are strict: bad values refuse boot here exactly as they
 * do in the full loader.
 */

/** The zero-config draft policy: drafts generate, no damping. Lives here
 * (not `types`). That package holds vocab maps, not defaults. */
export const DEFAULT_DRAFT_POLICY: DraftPolicy = {
  generate: true,
  debounceSeconds: null,
};

export interface LoadedInstancePolicy {
  readonly draftPolicy: DraftPolicy;
  readonly spendPolicy: SpendPolicy;
  readonly operatorIds: OperatorIds;
  /** Who besides Operators may use the instance; absent = nobody. */
  readonly allowedAccess: AllowedAccess | undefined;
  /** The file the policy came from; null for zero-config defaults. */
  readonly source: string | null;
}

/** Zero-config: no drafts damping, the default daily cap, no Operators. */
export const DEFAULT_INSTANCE_POLICY: Omit<LoadedInstancePolicy, "source"> = {
  draftPolicy: DEFAULT_DRAFT_POLICY,
  spendPolicy: DEFAULT_SPEND_POLICY,
  operatorIds: NO_OPERATORS,
  allowedAccess: undefined,
};

/**
 * `generate: on|off`. YAML 1.2 parses `on`/`off` as STRINGS (the 1.1
 * boolean idiom is gone), so both the string forms and real booleans are
 * accepted and normalized. SHOUT/kebab vocab does not apply: these are
 * operator-facing YAML values, mirroring the compose on/off idiom.
 */
const generateSchema = z
  .union([z.literal("on"), z.literal("off"), z.boolean()])
  .transform((value) => value === "on" || value === true);

const draftsBlockSchema = z
  .strictObject({
    generate: generateSchema.optional(),
    debounceSeconds: z.number().positive().finite().optional(),
  })
  .transform(
    (block): DraftPolicy => ({
      generate: block.generate ?? true,
      debounceSeconds: block.debounceSeconds ?? null,
    }),
  );

/** Parse a raw `drafts` root value; shared with the full loader's gate. */
export function validateDraftsBlock(
  block: unknown,
): Result<DraftPolicy, ConfigError> {
  const parsed = draftsBlockSchema.safeParse(block);
  if (!parsed.success) {
    return configError(
      parsed.error.issues.map((issue) => {
        // Zod's unrecognized_keys message interpolates the raw key text.
        // A pasted credential used as a stray key must not echo (same
        // token-gated posture as the root-key strictness in the loader).
        if (issue.code === "unrecognized_keys") {
          return `drafts: unrecognized key${issue.keys.length > 1 ? "s" : ""} ${issue.keys
            .map(renderKey)
            .join(", ")}`;
        }
        return `drafts: ${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`;
      }),
    );
  }
  return { ok: true, value: parsed.data };
}

/** Env-driven load for the api startup wiring. Unset env var = defaults. */
export function loadInstancePolicy(
  env: Record<string, string | undefined>,
): Result<LoadedInstancePolicy, ConfigError> {
  const path = env["MERGEBRIEF_CONFIG"];
  if (path === undefined) {
    return { ok: true, value: { ...DEFAULT_INSTANCE_POLICY, source: null } };
  }
  // Same workspace-root anchoring as the generator loader. The api and
  // worker processes must read the SAME file for one env value.
  const resolved = resolveEnvConfigPath(path, process.cwd());
  if (!resolved.ok) {
    return resolved;
  }
  const root = readConfigRoot(resolved.value);
  if (!root.ok) {
    return root;
  }

  const blocks = root.value ?? {};
  const draftPolicy = readBlock(
    blocks["drafts"],
    validateDraftsBlock,
    DEFAULT_DRAFT_POLICY,
  );
  if (!draftPolicy.ok) {
    return draftPolicy;
  }
  const spendPolicy = readBlock(
    blocks["spend"],
    validateSpendBlock,
    DEFAULT_SPEND_POLICY,
  );
  if (!spendPolicy.ok) {
    return spendPolicy;
  }
  const operatorIds = readBlock(
    blocks["operators"],
    validateOperatorsBlock,
    NO_OPERATORS,
  );
  if (!operatorIds.ok) {
    return operatorIds;
  }
  const allowedAccess = readBlock<AllowedAccess | undefined>(
    blocks["allowed"],
    validateAllowedBlock,
    undefined,
  );
  if (!allowedAccess.ok) {
    return allowedAccess;
  }

  return {
    ok: true,
    value: {
      draftPolicy: draftPolicy.value,
      spendPolicy: spendPolicy.value,
      operatorIds: operatorIds.value,
      allowedAccess: allowedAccess.value,
      source: resolved.value,
    },
  };
}

function readBlock<Policy>(
  block: unknown,
  validate: (block: unknown) => Result<Policy, ConfigError>,
  fallback: Policy,
): Result<Policy, ConfigError> {
  if (block === undefined) {
    return { ok: true, value: fallback };
  }
  return validate(block);
}
