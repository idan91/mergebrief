import { z } from "zod/v4";
import { execFileAsync, MAX_BUFFER, repoSlug } from "./fetch";
import type { PrLocator, ReviewComment } from "./types";

/** Cap on comments fed to generation (prompt-cost bound) — every PrSource
 * implementation must apply it (the octokit source slices with it too). */
export const MAX_COMMENTS = 100;
const MAX_COMMENT_CHARS = 2_000;

const GhCommentSchema = z.object({
  id: z.number(),
  path: z.string().nullish(),
  start_line: z.number().nullish(),
  line: z.number().nullish(),
  original_start_line: z.number().nullish(),
  original_line: z.number().nullish(),
  // "line" for a line/range comment, "file" for a file-level comment.
  subject_type: z.string().nullish(),
  body: z.string().nullish(),
  user: z.object({ login: z.string() }).nullish(),
  in_reply_to_id: z.number().nullish(),
});

/**
 * GitHub marks a *line* comment outdated by nulling its `line` — the line it
 * anchored to is no longer part of the diff at the PR's current head (the
 * `original_line` is retained). This is read, not recomputed (ADR 0007); the
 * legacy `position` field is unreliable for this. *File*-level comments carry a
 * null `line` by design and are never "outdated".
 */
export function isCommentOutdated(
  line: number | null,
  subjectType: string | null,
): boolean {
  if ((subjectType ?? "line") !== "line") return false;
  return line == null;
}

export function normalizeReviewComment(value: unknown): ReviewComment {
  const c = GhCommentSchema.parse(value);
  return {
    id: String(c.id),
    file: c.path ?? "",
    startLine: c.start_line ?? null,
    line: c.line ?? null,
    originalStartLine: c.original_start_line ?? null,
    originalLine: c.original_line ?? null,
    author: c.user?.login ?? "unknown",
    body: (c.body ?? "").slice(0, MAX_COMMENT_CHARS),
    inReplyToId: c.in_reply_to_id != null ? String(c.in_reply_to_id) : null,
    outdated: isCommentOutdated(c.line ?? null, c.subject_type ?? null),
  };
}

/**
 * Fetch a PR's review comments (line comments + thread replies) via the GitHub
 * API. Stateless, public — display data for the brief + delta comment sidecars
 * (ADR 0012) and input to the delta's "comments addressed" analysis (ADR 0011).
 * Capped in count and per-comment length to bound prompt cost.
 *
 * `outdated` is read straight from GitHub (a nulled `line`, see isCommentOutdated),
 * never recomputed (ADR 0007). NOTE: GitHub computes outdated relative to the PR's
 * *current* head. That is exact for the full brief (always at current head), but
 * for a delta run at an arbitrary (base, head) it is outdated-relative-to-current-
 * PR-head, not the delta's head — a documented limitation, like the three-dot
 * compare-diff caveat in `fetch.ts`.
 */
export async function fetchReviewComments(
  loc: PrLocator,
): Promise<ReviewComment[]> {
  const { stdout } = await execFileAsync(
    "gh",
    [
      "api",
      "--paginate",
      `repos/${repoSlug(loc)}/pulls/${loc.number}/comments`,
    ],
    { maxBuffer: MAX_BUFFER },
  );
  const raw = z.array(GhCommentSchema).parse(JSON.parse(stdout));
  return raw.slice(0, MAX_COMMENTS).map(normalizeReviewComment);
}
