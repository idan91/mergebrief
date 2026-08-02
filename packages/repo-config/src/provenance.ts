// The artifact-facing shape of repo-config provenance (ADR 0032 #8/#11): the
// JSON the worker serializes into `brief.repo_config` and the read surfaces
// (api/web) parse back. One Zod schema owns the contract so writer and
// readers cannot drift — the FE renders source markers, de-emphasis weight,
// and the provenance chip's per-file table from THIS snapshot, never from
// live policy (self-contained historical rendering).
import { z } from "zod/v4";
import {
  ATTRIBUTE_NAME_MAX_CHARS,
  ATTRIBUTE_NAME_PATTERN,
  CRITERIA_MAX_CHARS,
  FLOOR_ATTRIBUTES,
  IMPLICATION_MAX_CHARS,
  RepoConfigOutcome,
  RepoConfigPaths,
} from "./constants";
import { deEmphasisRuleSchema } from "./schemas";

const outcomeEnum = z.enum([
  RepoConfigOutcome.APPLIED,
  RepoConfigOutcome.ABSENT,
  RepoConfigOutcome.INVALID,
  RepoConfigOutcome.OVER_BUDGET,
  RepoConfigOutcome.FETCH_FAILED,
]);

/**
 * Per-file provenance row — mirrors `RepoConfigFileOutcome` (validate.ts),
 * pinned to ONE canonical slot path per tuple position (codex PR 4 r1: the
 * read boundary must reject reordered/duplicated/foreign paths, not just
 * trust the writer).
 */
function slotOutcomeSchema<P extends string>(path: P) {
  return z
    .object({
      path: z.literal(path),
      blobSha: z.string().nullable(),
      outcome: outcomeEnum,
      detail: z.string().optional(),
      bytesUsed: z.number().int().nonnegative().optional(),
      bytesBudget: z.number().int().positive().optional(),
      warning: z.string().optional(),
    })
    .strict();
}

/**
 * A custom-attribute definition as snapshotted on the artifact: the
 * validated definition plus its name (the record key at validation time).
 * Only attributes that actually FIRED on the brief are snapshotted — the
 * chip expansion needs criteria/implication for rendered attributes only.
 * Field constraints mirror the policy schema (codex PR 4 r1): a snapshot
 * that could not have come from a validated policy must not parse.
 */
const firedCustomAttributeSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(ATTRIBUTE_NAME_MAX_CHARS)
      .regex(ATTRIBUTE_NAME_PATTERN),
    criteria: z.string().min(1).max(CRITERIA_MAX_CHARS),
    implication: z.string().min(1).max(IMPLICATION_MAX_CHARS).optional(),
    paths: z.array(z.string().min(1)).optional(),
  })
  .strict();

const FLOOR_SET: ReadonlySet<string> = new Set(FLOOR_ATTRIBUTES);

/**
 * `generation.repo_config` — the per-file outcome table (EXACTLY the three
 * fixed paths, stable order instructions/settings/policy) + collision
 * disclosures (ADR 0032 #5 chip), written right after acquisition so failed
 * and superseded generations keep their outcomes. The brief artifact's
 * schema below EXTENDS this with the policy snapshot.
 */
export const repoConfigProvenanceSchema = z
  .object({
    files: z.tuple([
      slotOutcomeSchema(RepoConfigPaths.INSTRUCTIONS),
      slotOutcomeSchema(RepoConfigPaths.SETTINGS),
      slotOutcomeSchema(RepoConfigPaths.POLICY),
    ]),
    collisions: z.array(z.string()),
  })
  .strict();

/**
 * `brief.repo_config` — the provenance table plus the policy snapshot in
 * effect at generation time (`null` when no valid policy applied). Floor
 * attributes can never appear de-emphasized in a stored snapshot — same
 * invariant as the live schema.
 */
export const repoConfigArtifactSchema = repoConfigProvenanceSchema
  .extend({
    policy: z
      .object({
        firedCustomAttributes: z.array(firedCustomAttributeSchema),
        deEmphasize: z.array(deEmphasisRuleSchema),
      })
      .strict()
      .refine(
        (policy) =>
          !policy.deEmphasize.some((rule) => FLOOR_SET.has(rule.attribute)),
        {
          error: "a floor attribute cannot be de-emphasized",
          path: ["deEmphasize"],
        },
      )
      .nullable(),
  })
  .strict();

export type RepoConfigProvenance = z.infer<typeof repoConfigProvenanceSchema>;
export type RepoConfigArtifact = z.infer<typeof repoConfigArtifactSchema>;
export type RepoConfigArtifactFile = RepoConfigArtifact["files"][number];
export type FiredCustomAttribute = z.infer<typeof firedCustomAttributeSchema>;
