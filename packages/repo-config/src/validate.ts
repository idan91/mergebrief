// Validate already-fetched config without I/O; expected failures return outcomes.
// Details may contain paths and sanitized reasons, never file content, YAML values
// or raw parser messages. Zod received values are untrusted too.

import { parse as parseYaml } from "yaml";
import { RiskSurfaceAttributes } from "brief-core/types";
import type { Mutable, Result } from "types/utils";
import type { z } from "zod/v4";
import {
  BUDGET_WARN_FRACTION,
  FLOOR_ATTRIBUTES,
  INSTRUCTIONS_BUDGET_BYTES,
  PARKED_ATTRIBUTE_CANDIDATES,
  POLICY_MAX_BYTES,
  RESERVED_ATTRIBUTE_WORDS,
  RepoConfigOutcomes,
  RepoConfigPaths,
  SETTINGS_MAX_BYTES,
  type RepoConfigOutcome,
} from "./constants";
import {
  policyV1Schema,
  settingsV1Schema,
  type CustomAttribute,
  type DeEmphasisRule,
  type RepoSettingsV1,
} from "./schemas";

// --- Public contract --------------------------------------------------------

/**
 * One repo-local file as handed to validation. `undefined` at the input = absent
 * (404). `path` is advisory (caller bookkeeping), origin outcomes always
 * report the canonical fixed slot path, never this field.
 */
export interface RepoConfigFileInput {
  readonly path: string;
  readonly content: string;
  readonly blobSha: string;
}

/** The three fixed files; any omitted field is treated as absent. */
export interface RepoConfigInput {
  readonly instructions?: RepoConfigFileInput;
  readonly settings?: RepoConfigFileInput;
  readonly policy?: RepoConfigFileInput;
}

/** Per-file result, one entry per fixed path, always present in the outcome table. */
export interface RepoConfigFileOutcome {
  readonly path: string;
  readonly blobSha: string | null;
  readonly outcome: RepoConfigOutcome;
  readonly detail?: string;
  readonly bytesUsed?: number;
  readonly bytesBudget?: number;
  readonly warning?: string;
}

/** Instructions text carried whole once within budget. */
export interface ValidatedInstructions {
  readonly content: string;
  readonly blobSha: string;
  readonly bytes: number;
}

/** Policy after collision resolution + de-emphasis warn-and-drop. */
export interface ValidatedRepoPolicy {
  readonly attributes: Record<string, CustomAttribute>;
  readonly deEmphasize: readonly DeEmphasisRule[];
}

/** The validated config the generator consumes, plus the full outcome table. */
export interface ValidatedRepoConfig {
  readonly settings?: RepoSettingsV1;
  readonly policy?: ValidatedRepoPolicy;
  readonly instructions?: ValidatedInstructions;
  /** Custom attribute names dropped because they collide with a built-in / parked / reserved token. */
  readonly collisions: readonly string[];
  /** One entry per fixed path, ALWAYS all three, stable order: instructions, settings, policy. */
  readonly outcomes: readonly RepoConfigFileOutcome[];
}

// --- Vocabulary sets (built-in list imported, never duplicated) -------------

const FLOOR_SET: ReadonlySet<string> = new Set(FLOOR_ATTRIBUTES);

/** Custom names that collide (built-in wins + chip): real built-ins ∪ parked ∪ reserved. */
const COLLISION_VOCABULARY: ReadonlySet<string> = new Set<string>([
  ...Object.values(RiskSurfaceAttributes),
  ...PARKED_ATTRIBUTE_CANDIDATES,
  ...RESERVED_ATTRIBUTE_WORDS,
]);

/** Valid de-emphasis targets among built-ins: every real built-in except the floor. */
const BUILT_IN_NON_FLOOR: ReadonlySet<string> = new Set(
  Object.values(RiskSurfaceAttributes).filter((name) => !FLOOR_SET.has(name)),
);

// --- Byte + Zod helpers -----------------------------------------------------

function utf8Bytes(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

/** Warning string when a within-budget file is ≥ 80% of its cap; null otherwise. */
function nearingCapWarning(bytes: number, budget: number): string | null {
  if (bytes >= budget * BUDGET_WARN_FRACTION) {
    return `${bytes} of ${budget} bytes used — nearing the cap`;
  }
  return null;
}

/**
 * Only allowlisted static field names may appear in details. Other Zod path keys are
 * author-supplied YAML content and must become <key>, including invalid_key paths.
 */
const SAFE_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "version",
  "attributes",
  "deEmphasize",
  "criteria",
  "implication",
  "paths",
  "attribute",
  "entryCommentOnDrafts",
  "trustedBots",
  "triggerConditions",
]);

/**
 * Render only issue codes and allowlisted path keys. Zod messages, received values,
 * keys and invalid_key paths can echo source content and must not pass through verbatim.
 */
function sanitizeZodError(error: z.ZodError): string {
  const parts = error.issues.slice(0, 8).map((issue) => {
    const path = issue.path
      .map((segment, index) => {
        if (typeof segment === "number") {
          return String(segment);
        }
        if (typeof segment !== "string") {
          return "<key>";
        }
        // The child of `attributes` is an author-supplied record key (a custom
        // attribute name), untrusted YAML, never echoed, even if it happens to
        // spell a structural word like `criteria`.
        if (index > 0 && issue.path[index - 1] === "attributes") {
          return "<key>";
        }
        return SAFE_PATH_SEGMENTS.has(segment) ? segment : "<key>";
      })
      .join(".");
    return `${path.length > 0 ? path : "<root>"}: ${issue.code}`;
  });
  return `schema validation failed (${parts.join("; ")})`;
}

interface OutcomeFields {
  readonly detail?: string;
  readonly bytesUsed?: number;
  readonly bytesBudget?: number;
  readonly warning?: string;
}

/** The applied outcome's budget fields; the cap warning rides only when one fired. */
function shapeAppliedFields(
  bytesUsed: number,
  bytesBudget: number,
  warning: string | null,
): OutcomeFields {
  const fields: Mutable<OutcomeFields> = { bytesUsed, bytesBudget };

  if (warning !== null) {
    fields.warning = warning;
  }

  return fields;
}

/** Build an outcome, omitting optional keys entirely (exactOptionalPropertyTypes). */
function makeOutcome(
  path: string,
  blobSha: string | null,
  outcome: RepoConfigOutcome,
  fields: OutcomeFields = {},
): RepoConfigFileOutcome {
  const result: {
    path: string;
    blobSha: string | null;
    outcome: RepoConfigOutcome;
    detail?: string;
    bytesUsed?: number;
    bytesBudget?: number;
    warning?: string;
  } = { path, blobSha, outcome };
  if (fields.detail !== undefined) {
    result.detail = fields.detail;
  }
  if (fields.bytesUsed !== undefined) {
    result.bytesUsed = fields.bytesUsed;
  }
  if (fields.bytesBudget !== undefined) {
    result.bytesBudget = fields.bytesBudget;
  }
  if (fields.warning !== undefined) {
    result.warning = fields.warning;
  }
  return result;
}

/** Sanitized error token for an unparseable YAML file, carries no source. */
const YAML_PARSE_ERROR = "invalid-yaml" as const;

/**
 * YAML logLevel error prevents warning-channel source echoes while retaining syntax throws.
 * Silent would recover from real errors and violate reject-whole. Discard thrown parser
 * messages too because they may quote file content.
 */
function tryParseYaml(
  content: string,
): Result<unknown, typeof YAML_PARSE_ERROR> {
  try {
    const value: unknown = parseYaml(content, { logLevel: "error" });
    return { ok: true, value };
  } catch {
    return { ok: false, error: YAML_PARSE_ERROR };
  }
}

// --- Per-file validators ----------------------------------------------------

interface InstructionsResult {
  readonly outcome: RepoConfigFileOutcome;
  readonly value?: ValidatedInstructions;
}

function validateInstructions(
  file: RepoConfigFileInput | undefined,
): InstructionsResult {
  // Origin path is the canonical fixed slot, never the caller-supplied
  // `file.path`, the three paths are structural, not data.
  const path = RepoConfigPaths.INSTRUCTIONS;
  if (file === undefined) {
    return { outcome: makeOutcome(path, null, RepoConfigOutcomes.ABSENT) };
  }
  const bytes = utf8Bytes(file.content);
  const budget = INSTRUCTIONS_BUDGET_BYTES;
  if (bytes > budget) {
    return {
      outcome: makeOutcome(path, file.blobSha, RepoConfigOutcomes.OVER_BUDGET, {
        detail: `over budget: ${bytes} of ${budget} bytes`,
        bytesUsed: bytes,
        bytesBudget: budget,
      }),
    };
  }
  const warning = nearingCapWarning(bytes, budget);
  return {
    value: { content: file.content, blobSha: file.blobSha, bytes },
    outcome: makeOutcome(
      path,
      file.blobSha,
      RepoConfigOutcomes.APPLIED,
      shapeAppliedFields(bytes, budget, warning),
    ),
  };
}

interface SettingsResult {
  readonly outcome: RepoConfigFileOutcome;
  readonly value?: RepoSettingsV1;
}

function validateSettings(
  file: RepoConfigFileInput | undefined,
): SettingsResult {
  const path = RepoConfigPaths.SETTINGS;
  if (file === undefined) {
    return { outcome: makeOutcome(path, null, RepoConfigOutcomes.ABSENT) };
  }
  const bytes = utf8Bytes(file.content);
  const budget = SETTINGS_MAX_BYTES;
  if (bytes > budget) {
    return {
      outcome: makeOutcome(path, file.blobSha, RepoConfigOutcomes.OVER_BUDGET, {
        detail: `over budget: ${bytes} of ${budget} bytes`,
        bytesUsed: bytes,
        bytesBudget: budget,
      }),
    };
  }
  const parsed = tryParseYaml(file.content);
  if (!parsed.ok) {
    return {
      outcome: makeOutcome(path, file.blobSha, RepoConfigOutcomes.INVALID, {
        detail: "not valid YAML",
      }),
    };
  }
  const result = settingsV1Schema.safeParse(parsed.value);
  if (!result.success) {
    return {
      outcome: makeOutcome(path, file.blobSha, RepoConfigOutcomes.INVALID, {
        detail: sanitizeZodError(result.error),
      }),
    };
  }
  const warning = nearingCapWarning(bytes, budget);
  return {
    value: result.data,
    outcome: makeOutcome(
      path,
      file.blobSha,
      RepoConfigOutcomes.APPLIED,
      shapeAppliedFields(bytes, budget, warning),
    ),
  };
}

interface PolicyResult {
  readonly outcome: RepoConfigFileOutcome;
  readonly value?: ValidatedRepoPolicy;
  readonly collisions: readonly string[];
}

function validatePolicy(file: RepoConfigFileInput | undefined): PolicyResult {
  const path = RepoConfigPaths.POLICY;
  if (file === undefined) {
    return {
      outcome: makeOutcome(path, null, RepoConfigOutcomes.ABSENT),
      collisions: [],
    };
  }
  const bytes = utf8Bytes(file.content);
  const budget = POLICY_MAX_BYTES;
  if (bytes > budget) {
    return {
      outcome: makeOutcome(path, file.blobSha, RepoConfigOutcomes.OVER_BUDGET, {
        detail: `over budget: ${bytes} of ${budget} bytes`,
        bytesUsed: bytes,
        bytesBudget: budget,
      }),
      collisions: [],
    };
  }
  const parsed = tryParseYaml(file.content);
  if (!parsed.ok) {
    return {
      outcome: makeOutcome(path, file.blobSha, RepoConfigOutcomes.INVALID, {
        detail: "not valid YAML",
      }),
      collisions: [],
    };
  }
  const result = policyV1Schema.safeParse(parsed.value);
  if (!result.success) {
    return {
      outcome: makeOutcome(path, file.blobSha, RepoConfigOutcomes.INVALID, {
        detail: sanitizeZodError(result.error),
      }),
      collisions: [],
    };
  }

  // Collision resolution: a custom name matching a built-in / parked / reserved
  // token is dropped (built-in wins + chip). Fails only TOWARD built-in
  // semantics, the file stays applied. Insertion order is deterministic.
  const survivingAttributes: Record<string, CustomAttribute> = {};
  const collisions: string[] = [];
  for (const [name, definition] of Object.entries(result.data.attributes)) {
    if (COLLISION_VOCABULARY.has(name)) {
      collisions.push(name);
    } else {
      survivingAttributes[name] = definition;
    }
  }

  // De-emphasis resolution: keep entries targeting a built-in non-floor or a
  // surviving custom name; drop entries whose target is unknown (likely typo)
  // and warn (never invalid, floor targets were already rejected by the schema).
  const survivingNames: ReadonlySet<string> = new Set(
    Object.keys(survivingAttributes),
  );
  const deEmphasize: DeEmphasisRule[] = [];
  let droppedDeEmphasis = 0;
  for (const rule of result.data.deEmphasize ?? []) {
    if (
      BUILT_IN_NON_FLOOR.has(rule.attribute) ||
      survivingNames.has(rule.attribute)
    ) {
      deEmphasize.push(rule);
    } else {
      droppedDeEmphasis += 1;
    }
  }

  const bytesWarning = nearingCapWarning(bytes, budget);
  const warningParts: string[] = [];
  if (bytesWarning !== null) {
    warningParts.push(bytesWarning);
  }
  if (droppedDeEmphasis > 0) {
    warningParts.push(
      `${droppedDeEmphasis} de-emphasis rule(s) dropped — attribute not recognized`,
    );
  }
  const warning = warningParts.length > 0 ? warningParts.join("; ") : null;

  return {
    value: { attributes: survivingAttributes, deEmphasize },
    collisions,
    outcome: makeOutcome(
      path,
      file.blobSha,
      RepoConfigOutcomes.APPLIED,
      shapeAppliedFields(bytes, budget, warning),
    ),
  };
}

// --- Orchestrator -----------------------------------------------------------

/**
 * Validate a fetched `.mergebrief/` config set. Reject-whole per file: a file
 * that fails parse / schema / caps contributes nothing to the validated config
 * but always contributes an outcome. The outcomes array is always length 3, in
 * stable order instructions / settings / policy.
 */
export function validateRepoConfig(
  input: RepoConfigInput,
): ValidatedRepoConfig {
  const instructions = validateInstructions(input.instructions);
  const settings = validateSettings(input.settings);
  const policy = validatePolicy(input.policy);

  const result: {
    settings?: RepoSettingsV1;
    policy?: ValidatedRepoPolicy;
    instructions?: ValidatedInstructions;
    collisions: readonly string[];
    outcomes: readonly RepoConfigFileOutcome[];
  } = {
    collisions: policy.collisions,
    outcomes: [instructions.outcome, settings.outcome, policy.outcome],
  };
  if (instructions.value !== undefined) {
    result.instructions = instructions.value;
  }
  if (settings.value !== undefined) {
    result.settings = settings.value;
  }
  if (policy.value !== undefined) {
    result.policy = policy.value;
  }
  return result;
}
