// Boundary schemas for the read surface. A PR number is a positive int; a
// SHA is a non-empty token.
import { z } from "zod";
export { prNumberSchema } from "../wire-bounds";

export const shaSchema = z.string().min(1);

export const briefQuerySchema = z.object({ base: shaSchema, head: shaSchema });
export const marksQuerySchema = z.object({
  baseline: shaSchema,
  head: shaSchema,
});
export const narrativeQuerySchema = z.object({
  prevHead: shaSchema,
  head: shaSchema,
});
/**
 * Diff span refs must NOT contain a `:` — GitHub's compare endpoint reads
 * `owner:ref` as a CROSS-REPO selector, which would let a caller redirect the
 * diff proxy at a fork outside the `repoId` the authz gate approved.
 */
export const diffRefSchema = shaSchema.refine((value) => !value.includes(":"), {
  message: "diff ref must not select a cross-repo owner:ref span",
});
export const diffQuerySchema = z.object({
  base: diffRefSchema,
  head: diffRefSchema,
});
/** Same no-`:` rule as the diff route, though this read never reaches GitHub. */
export const deltaQuerySchema = z.object({
  baseline: diffRefSchema,
  head: diffRefSchema,
});
