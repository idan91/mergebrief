// Boundary schemas for the read surface. A SHA is a non-empty token.
import { z } from "zod/v4";
import { MAX_FILE_RANGE_LINES } from "contract";
import {
  commitShaSchema,
  MAX_INT4,
  MAX_PATH_LENGTH,
} from "../../../wire-bounds";

export const shaSchema = z.string().min(1);

export const briefQuerySchema = z.object({ base: shaSchema, head: shaSchema });
export type BriefQuery = z.infer<typeof briefQuerySchema>;
export const marksQuerySchema = z.object({
  baseline: shaSchema,
  head: shaSchema,
});
export type MarksQuery = z.infer<typeof marksQuerySchema>;
export const narrativeQuerySchema = z.object({
  prevHead: shaSchema,
  head: shaSchema,
});
export type NarrativeQuery = z.infer<typeof narrativeQuerySchema>;
/**
 * Diff span refs must NOT contain a `:`: GitHub's compare endpoint reads
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
export type DiffQuery = z.infer<typeof diffQuerySchema>;
/** Same no-`:` rule as the diff route, though this read never reaches GitHub. */
export const deltaQuerySchema = z.object({
  baseline: diffRefSchema,
  head: diffRefSchema,
});
export type DeltaQuery = z.infer<typeof deltaQuerySchema>;

/**
 * A repo-relative file path. `@octokit/endpoint` expands `{path}` through
 * `encodeUnreserved`, so `/`, `%`, `#` and `?` are percent-encoded and nothing
 * can be smuggled into the contents-API URL. Left to refuse: an absolute path,
 * an empty, `.` or `..` segment, and control characters (`\p{Cc}` keeps the
 * control byte out of the source). A charset allowlist beyond that refuses
 * legal filenames, and a deterministic 400 the client cannot mirror is an
 * unrecoverable loop.
 */
const CONTROL_CHARACTER = /\p{Cc}/u;

export const filePathSchema = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((value) => !value.startsWith("/"), {
    message: "path must be repo-relative",
  })
  .refine((value) => !CONTROL_CHARACTER.test(value), {
    message: "path must carry no control character",
  })
  .refine(
    (value) =>
      value
        .split("/")
        .every(
          (segment) => segment !== "" && segment !== "." && segment !== "..",
        ),
    { message: "path segment is empty or traversing" },
  );

const lineNumberSchema = z.coerce.number().int().positive().max(MAX_INT4);

/**
 * One file's line window at a commit. `ref` is a 40-hex SHA, never a branch
 * name: a push between the diff read and the expand would serve lines from a
 * newer commit at the old line numbers, and cache them under a key the new
 * commit shares. The expander always holds the head SHA.
 */
export const fileRangeQuerySchema = z
  .object({
    ref: commitShaSchema,
    path: filePathSchema,
    from: lineNumberSchema,
    to: lineNumberSchema,
  })
  .refine((value) => value.from <= value.to, {
    message: "from must not be past to",
  })
  .refine((value) => value.to - value.from + 1 <= MAX_FILE_RANGE_LINES, {
    message: "range spans more lines than one read may serve",
  });
export type FileRangeQuery = z.infer<typeof fileRangeQuerySchema>;
