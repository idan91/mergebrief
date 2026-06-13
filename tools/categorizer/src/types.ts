import { z } from "zod";

/**
 * Brief schema — the heart of the categorizer.
 *
 * Mirrors the controlled vocabulary in `docs/mvp/labeling-schema.md` (the
 * authoritative closed token list) and `docs/mvp/risk-surface.md` (the 16
 * factual attributes). If a token is not registered there, it is not valid
 * here — keep these enums in lockstep with those files.
 *
 * Structured-output constraints (from the claude-api skill): no recursive
 * schemas, no min/max constraints. Optionality is avoided in favour of
 * always-present arrays (empty when N/A) so the strict schema stays simple.
 */

// --- Closed vocabularies (one source of truth per axis) -------------------

/** Category — intent. Attaches to a change-group. */
export const Categories = [
  "bugfix", // correct a defect in existing behavior
  "logic-refactor", // behavior-preserving restructure of logic
  "move-with-edits", // relocation of code with edits inside the move
  "lib-bump", // dependency version change *with* API/behavior impact
  "pure-move", // relocation only, bytes identical, no edits
  "new-feature", // adds a new capability
  "dependency-update", // dep version bump with no API/behavior impact
  "schema-change", // data-model / migration change
] as const;

/** Concern — artifact. Attaches to a chunk. Mostly derivable from file path. */
export const Concerns = [
  "implementation", // the functional change itself (default carrier)
  "test", // tests, fixtures (incl. .test.* / .spec.* files)
  "doc", // docs, READMEs, changesets, doc-only files
  "spec", // specification document (NOT .spec.ts — that's test)
  "config", // configuration files
  "generated", // generated / vendored output (lockfiles, bundles)
] as const;

/** Role — carrier vs supporting. Attaches to a chunk. */
export const Roles = [
  "carrier", // holds the change-group's intent
  "supporting", // serves the carrier (its tests, docs, specs, config)
] as const;

/**
 * Risk surface — 16 factual attributes (never verdicts). Attaches to a chunk.
 * Three buckets: about the code / about the change / about the blast radius.
 */
export const RiskSurfaceAttributes = [
  // about the CODE
  "no-tests",
  "no-types",
  "legacy-area",
  "dense-logic",
  // about the CHANGE
  "touches-auth",
  "mutates-state",
  "removes-validation",
  "relaxes-permissions",
  "widens-error-handling",
  "adds-feature-flag",
  // about the BLAST RADIUS
  "external-io",
  "cross-service",
  "schema-adjacent",
  "hot-path",
  "widely-imported",
  "release-imminent",
] as const;

export type Category = (typeof Categories)[number];
export type Concern = (typeof Concerns)[number];
export type Role = (typeof Roles)[number];
export type RiskSurfaceAttribute = (typeof RiskSurfaceAttributes)[number];

const categoryEnum = z.enum(Categories);
const concernEnum = z.enum(Concerns);
const roleEnum = z.enum(Roles);
const riskSurfaceEnum = z.enum(RiskSurfaceAttributes);

// --- Brief shape ----------------------------------------------------------

export const PrRefSchema = z.object({
  repo: z.string().describe("owner/name, e.g. medusajs/medusa"),
  number: z.number().int().describe("PR number"),
  title: z.string(),
  url: z.string().describe("PR URL"),
  sha: z.string().describe("head commit SHA of the PR"),
});

export const ChunkSchema = z.object({
  id: z
    .string()
    .describe("stable id referenced by change-groups, e.g. c1, c2, …"),
  file: z.string().describe("file path the chunk lives in"),
  concern: concernEnum.describe(
    "artifact kind; mostly derivable from the file path",
  ),
  role: roleEnum.describe(
    "carrier holds intent; supporting serves it. Default from concern (implementation→carrier, else supporting); flip when a supporting artifact is itself the purpose (e.g. flaky-test fix).",
  ),
  loc: z
    .object({
      added: z.number().int().describe("git lines added in this chunk"),
      deleted: z.number().int().describe("git lines deleted in this chunk"),
    })
    .describe(
      "approximation: git LoC ≈ adjusted LoC. Note likely moves in the group summary; we do not claim move-accurate LoC.",
    ),
  riskSurface: z
    .array(riskSurfaceEnum)
    .describe(
      "factual attributes that apply to this chunk (empty if none). Never verdicts — severity emerges from combinations.",
    ),
});

export const ChangeGroupSchema = z.object({
  summary: z
    .string()
    .describe("what the group does (what, not why), one group = one summary"),
  dominantCategory: categoryEnum.describe("the group's primary intent"),
  secondaryCategories: z
    .array(categoryEnum)
    .describe("additional intents present in the group (empty if none)"),
  uncertain: z
    .boolean()
    .describe(
      "true when confidence on the dominant category is below threshold. AI never hides uncertainty — flag it rather than forcing a token.",
    ),
  uncertainBetween: z
    .array(categoryEnum)
    .describe(
      "the categories in tension when uncertain=true (e.g. new-feature vs bugfix); empty when uncertain=false",
    ),
  carrierChunkIds: z
    .array(z.string())
    .describe("ids of the chunks that carry this group's intent"),
  supportingChunkIds: z
    .array(z.string())
    .describe("ids of the chunks that support the carriers"),
});

export const ConcernRollupSchema = z.object({
  concern: concernEnum,
  added: z.number().int().describe("total git lines added for this concern"),
  deleted: z
    .number()
    .int()
    .describe("total git lines deleted for this concern"),
});

export const BriefSchema = z.object({
  pr: PrRefSchema,
  summary: z.string().describe("plain-English what-it-does for the whole PR"),
  changeGroups: z.array(ChangeGroupSchema),
  chunks: z.array(ChunkSchema),
  concernView: z
    .array(ConcernRollupSchema)
    .describe("LoC rollup per concern (one entry per concern present)"),
});

export type PrRef = z.infer<typeof PrRefSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
export type ChangeGroup = z.infer<typeof ChangeGroupSchema>;
export type ConcernRollup = z.infer<typeof ConcernRollupSchema>;
export type Brief = z.infer<typeof BriefSchema>;
