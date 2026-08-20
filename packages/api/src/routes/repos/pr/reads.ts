// The reviewer read API. Four GETs, ALL behind the authz gate, that return the
// tenant-scoped artifacts a reviewer's client renders:
//   brief / marks / narrative  → the stored artifact `body` verbatim (already
//                                 JSON — returned as-is, never re-parsed);
//   diff                        → a LIVE proxy of GitHub's unified diff, fetched
//                                 with the VIEWER's token and cached per session.
//
// TENANCY: the gate resolves `ctx` from the session; every read filters through
// persistence's ctx-bound interfaces. This module never sees a raw handle and
// never trusts a caller-supplied installation id.
//
// DIFF PROXY: the diff is NEVER persisted — it is proxied live and held only in
// an ephemeral, per-session in-memory cache (~60s TTL) keyed by
// `(sessionHash, repoId, prNumber, base, head)`.
//
// VALIDATION: params/queries are Zod-validated → 400 on a bad shape; a missing
// PR / artifact is a 404; GitHub fetch failures are sanitized to 404/502. No
// upstream error text, token, or header ever reaches a response body.
import type { Context } from "hono";
import {
  createUserOctokit,
  fetchCompareDiff,
  GitHubApiErrorCode,
} from "github";
import {
  artifactStore,
  decryptToken,
  forTenant,
  generationProjection,
  GenerationKind,
  GenerationStatus,
  type BriefSpanRow,
  type ComparisonSpanRow,
  type GenerationRow,
  type NarrativeSpanRow,
  type PullRequestRow,
  type RepoId,
  type TenantContext,
  type ValueOf,
} from "persistence";
import { z } from "zod";
import { ApiErrorCode, errorJson } from "../../../error-response";
import { DEFAULT_DRAFT_POLICY } from "../../../draft-policy";
import { PRODUCT_QUERY_ID } from "../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../product-operations/types";
import type { AuthzEnv } from "../../authz";
import { refreshSessionToken, type AuthRouteDeps } from "../../auth/session";
import { buildPrView } from "../../pr-view";
import { createTtlCache } from "../../ttl-cache";

// ---------------------------------------------------------------------------
// Boundary schemas. A PR number is a positive int; a SHA is a non-empty token.
// ---------------------------------------------------------------------------

const prNumberSchema = z.coerce.number().int().positive();
const shaSchema = z.string().min(1);

const briefQuerySchema = z.object({ base: shaSchema, head: shaSchema });
const marksQuerySchema = z.object({ baseline: shaSchema, head: shaSchema });
const narrativeQuerySchema = z.object({ prevHead: shaSchema, head: shaSchema });
/**
 * Diff span refs must NOT contain a `:` — GitHub's compare endpoint reads
 * `owner:ref` as a CROSS-REPO selector, which would let a caller redirect the
 * diff proxy at a fork outside the `repoId` the authz gate approved.
 */
const diffRefSchema = shaSchema.refine((value) => !value.includes(":"), {
  message: "diff ref must not select a cross-repo owner:ref span",
});
const diffQuerySchema = z.object({ base: diffRefSchema, head: diffRefSchema });
/** Same no-`:` rule as the diff route, though this read never reaches GitHub. */
const deltaQuerySchema = z.object({
  baseline: diffRefSchema,
  head: diffRefSchema,
});

/** Per-session diff cache TTL — short; the diff is live, this only debounces. */
const DIFF_CACHE_TTL_MS = 60 * 1000;
/**
 * Hard cap on cached diffs. Keys are never reused (fresh session hash + new SHA
 * pair per push), so an uncapped Map would grow for the process lifetime; the
 * oldest entry is evicted past the cap.
 */
const DIFF_CACHE_MAX_ENTRIES = 2_000;
/**
 * Per-entry byte cap: the entry-count cap alone doesn't bound bytes, so an
 * oversized diff (cheap to re-proxy) is served but NOT cached.
 */
const DIFF_CACHE_MAX_ENTRY_BYTES = 1_000_000;

/**
 * Split a GitHub-verified `owner/repo` full name. Defensive only — a malformed
 * shape must never reach a GitHub call.
 */
function splitRepoSlug(
  slug: string,
): { owner: string; repo: string } | undefined {
  const parts = slug.split("/");
  const [owner, repo] = parts;
  if (
    parts.length !== 2 ||
    owner === undefined ||
    repo === undefined ||
    owner === "" ||
    repo === ""
  ) {
    return undefined;
  }
  return { owner, repo };
}

/**
 * Mount the read API behind the pr subtree's shared gate. The diff cache is
 * created here — once per `createApp` — so it is scoped to the app instance.
 */
export function readsRoute(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  // key `${sessionHash}:${repoId}:${prNumber}:${base}:${head}` → cached diff.
  const diffCache = createTtlCache<string>(DIFF_CACHE_MAX_ENTRIES);

  /**
   * Resolve `:prNumber` and the tenant PR row, or return the mapped error
   * status. `undefined` return means "response already sent".
   */
  async function resolvePr(
    ctx: TenantContext,
    repoId: RepoId,
    rawPrNumber: string | undefined,
  ): Promise<
    { ok: true; pr: PullRequestRow } | { ok: false; status: 400 | 404 }
  > {
    const parsed = prNumberSchema.safeParse(rawPrNumber);
    if (!parsed.success) {
      return { ok: false, status: 400 };
    }
    const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(
      repoId,
      parsed.data,
    );
    if (pr === undefined) {
      return { ok: false, status: 404 };
    }
    return { ok: true, pr };
  }

  // GET PR meta — the PR row + current-span derivation + latest brief-kind
  // generation summary, plus previous-brief comparison availability. The FE's
  // single poll target: render when `briefAvailable`, drive the wait UX from
  // `generation`, offer Compare only when `comparisons` carries a baseline
  // (fail closed — absent means not offered).
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_PULL,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/",
    async (c) => {
      const ctx = c.get("ctx");
      const resolved = await resolvePr(
        ctx,
        c.get("repoId"),
        c.req.param("prNumber"),
      );
      if (!resolved.ok) {
        return errorJson(
          c,
          resolved.status === 400
            ? ApiErrorCode.INVALID_REQUEST
            : ApiErrorCode.NOT_FOUND,
        );
      }
      const store = artifactStore(deps.handle, ctx);
      const ids = [resolved.pr.id];
      const [latestBriefs, latestGenerations] = await Promise.all([
        store.briefs.latestForPullRequests(ids),
        generationProjection(deps.handle, ctx).latestBriefForPullRequests(ids),
      ]);
      const view = buildPrView(
        resolved.pr,
        latestBriefs.get(resolved.pr.id),
        latestGenerations.get(resolved.pr.id),
        c.get("repoFullName"),
        // The viewer's verified login from the session; `viewerIsAuthor` is
        // derived per request, never cached.
        c.get("session").reviewerLogin,
        // Push capability from the gate's access check — ≤60s stale via the
        // positive cache, same budget as `repoFullName`.
        c.get("viewerCanPush"),
      );
      // Compare availability + the browsable revision timeline, both derived
      // from ONE lean listing per artifact kind joined in memory — never one
      // existence probe per revision.
      //
      // INVARIANT: `briefAvailable` implies `headSha !== null` (`brief.head_sha`
      // is NOT NULL), so the null check below is TypeScript narrowing only and
      // can never skip stored revisions.
      let comparisons: RevisionComparisons = {};
      let revisions: RevisionView[] | undefined;
      if (view.briefAvailable && view.headSha !== null) {
        const headSha = view.headSha;
        const pullRequestId = resolved.pr.id;
        const [
          briefs,
          markRows,
          deltaRows,
          narrativeRows,
          checkpoint,
          briefGenerations,
        ] = await Promise.all([
          store.briefs.listForPullRequest(pullRequestId),
          store.comparisonMarks.listForPullRequest(pullRequestId),
          store.deltas.listForPullRequest(pullRequestId),
          store.revisionNarratives.listForPullRequest(pullRequestId),
          forTenant(deps.handle, ctx).checkpoints.get(
            pullRequestId,
            c.get("session").reviewerId,
          ),
          generationProjection(deps.handle, ctx).listBriefsForPullRequest(
            pullRequestId,
          ),
        ]);
        // `created_at` is the first enqueue for that head — the earliest bound of
        // what the brief's acquisition could have seen. One row per head, shared
        // by duplicate-head (retarget) revisions.
        const generatedAtByHead = new Map(
          briefGenerations.map((row) => [row.headSha, row.createdAt]),
        );
        const markSpans = comparisonSpanSet(markRows);
        const deltaSpans = comparisonSpanSet(deltaRows);
        const narrativeSpans = narrativeSpanSet(narrativeRows);
        // The generation-pending refinement (a DB probe) is wired for the
        // CURRENT head SHA only: history is never actively warming. Gated by
        // headSha — not row identity — because lastReview is a pure function of
        // (checkpoint, headSha), so duplicate rows sharing the current head must
        // report identical state. The probe memoizes per baseline.
        const latestPendingProbe = makeLatestPendingProbe(
          deps,
          ctx,
          pullRequestId,
          headSha,
          latestGenerations.get(pullRequestId),
        );
        revisions = await Promise.all(
          briefs.map(async (entry): Promise<RevisionView> => {
            const previousBrief = derivePreviousBriefComparison(
              entry,
              briefs,
              markSpans,
              narrativeSpans,
            );
            const lastReview = await deriveLastReviewComparison(
              entry.headSha,
              checkpoint,
              briefs,
              markSpans,
              deltaSpans,
              entry.headSha === headSha ? latestPendingProbe : undefined,
            );
            return {
              headSha: entry.headSha,
              baseSha: entry.baseSha,
              headIndex: entry.headIndex,
              createdAt: entry.createdAt.toISOString(),
              // Missing projection row: the artifact's own write time is the
              // honest late fallback — never earlier than the real generation
              // start, so it can only under-mark.
              generatedAt: (
                generatedAtByHead.get(entry.headSha) ?? entry.createdAt
              ).toISOString(),
              comparisons: {
                ...(previousBrief === undefined ? {} : { previousBrief }),
                ...(lastReview === undefined ? {} : { lastReview }),
              },
            };
          }),
        );
        comparisons = revisions.at(-1)?.comparisons ?? {};
      }
      return c.json(
        {
          ...view,
          comparisons,
          ...(revisions === undefined ? {} : { revisions }),
          // Meta-only (instance-wide, so the list would repeat it per row for
          // nothing). The FE must show the CONFIGURED window, never a hardcoded
          // duration.
          draftPolicy: deps.draftPolicy ?? DEFAULT_DRAFT_POLICY,
        },
        200,
        { "cache-control": "no-store" },
      );
    },
  );

  // GET brief — the whole-PR span artifact for (base, head).
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_BRIEF,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/brief",
    async (c) => {
      const query = briefQuerySchema.safeParse({
        base: c.req.query("base"),
        head: c.req.query("head"),
      });
      if (!query.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const resolved = await resolvePr(
        c.get("ctx"),
        c.get("repoId"),
        c.req.param("prNumber"),
      );
      if (!resolved.ok) {
        return errorJson(
          c,
          resolved.status === 400
            ? ApiErrorCode.INVALID_REQUEST
            : ApiErrorCode.NOT_FOUND,
        );
      }
      const row = await artifactStore(deps.handle, c.get("ctx")).briefs.get(
        resolved.pr.id,
        query.data.base,
        query.data.head,
      );
      if (row === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      return artifactJson(c, row.body);
    },
  );

  // GET brief-context — the brief's repo-config snapshot: per-file outcome
  // table + collisions + policy snapshot, for the FE's source markers,
  // de-emphasis weights, and origin chip. A separate lean endpoint (never the
  // multi-hundred-KB body) so the `/brief` wire shape — which the CLI also
  // parses — stays untouched. `repoConfig` is null for older rows.
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_BRIEF_CONTEXT,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/brief-context",
    async (c) => {
      const query = briefQuerySchema.safeParse({
        base: c.req.query("base"),
        head: c.req.query("head"),
      });
      if (!query.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const resolved = await resolvePr(
        c.get("ctx"),
        c.get("repoId"),
        c.req.param("prNumber"),
      );
      if (!resolved.ok) {
        return errorJson(
          c,
          resolved.status === 400
            ? ApiErrorCode.INVALID_REQUEST
            : ApiErrorCode.NOT_FOUND,
        );
      }
      const repoConfig = await artifactStore(
        deps.handle,
        c.get("ctx"),
      ).briefs.getRepoConfig(resolved.pr.id, query.data.base, query.data.head);
      if (repoConfig === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      // The column already holds validated JSON — compose the envelope as a
      // string so the snapshot is never re-parsed per request.
      return artifactJson(c, `{"repoConfig":${repoConfig ?? "null"}}`);
    },
  );

  // GET marks — comparison marks (coordinates only) for (baseline, head).
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_MARKS,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/marks",
    async (c) => {
      const query = marksQuerySchema.safeParse({
        baseline: c.req.query("baseline"),
        head: c.req.query("head"),
      });
      if (!query.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const resolved = await resolvePr(
        c.get("ctx"),
        c.get("repoId"),
        c.req.param("prNumber"),
      );
      if (!resolved.ok) {
        return errorJson(
          c,
          resolved.status === 400
            ? ApiErrorCode.INVALID_REQUEST
            : ApiErrorCode.NOT_FOUND,
        );
      }
      const row = await artifactStore(
        deps.handle,
        c.get("ctx"),
      ).comparisonMarks.get(
        resolved.pr.id,
        query.data.baseline,
        query.data.head,
      );
      if (row === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      return artifactJson(c, row.body);
    },
  );

  // GET delta — the pre-warmed reviewer-personal delta core for
  // (baseline = checkpoint SHA, head). Reviewer-agnostic artifact;
  // per-reviewer relevance is derived in PR-meta, not here.
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_DELTA,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/delta",
    async (c) => {
      const query = deltaQuerySchema.safeParse({
        baseline: c.req.query("baseline"),
        head: c.req.query("head"),
      });
      if (!query.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const resolved = await resolvePr(
        c.get("ctx"),
        c.get("repoId"),
        c.req.param("prNumber"),
      );
      if (!resolved.ok) {
        return errorJson(
          c,
          resolved.status === 400
            ? ApiErrorCode.INVALID_REQUEST
            : ApiErrorCode.NOT_FOUND,
        );
      }
      const row = await artifactStore(deps.handle, c.get("ctx")).deltas.get(
        resolved.pr.id,
        query.data.baseline,
        query.data.head,
      );
      if (row === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      return artifactJson(c, row.body);
    },
  );

  // GET narrative — the revision narrative for (prevHead, head).
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_NARRATIVE,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/narrative",
    async (c) => {
      const query = narrativeQuerySchema.safeParse({
        prevHead: c.req.query("prevHead"),
        head: c.req.query("head"),
      });
      if (!query.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const resolved = await resolvePr(
        c.get("ctx"),
        c.get("repoId"),
        c.req.param("prNumber"),
      );
      if (!resolved.ok) {
        return errorJson(
          c,
          resolved.status === 400
            ? ApiErrorCode.INVALID_REQUEST
            : ApiErrorCode.NOT_FOUND,
        );
      }
      const row = await artifactStore(
        deps.handle,
        c.get("ctx"),
      ).revisionNarratives.get(
        resolved.pr.id,
        query.data.prevHead,
        query.data.head,
      );
      if (row === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      return artifactJson(c, row.body);
    },
  );

  // GET diff — LIVE proxy of the requested `base...head` span diff (GitHub's
  // compare endpoint) with the viewer's token, cached per session (~60s).
  // Never persisted.
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_DIFF,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/diff",
    async (c) => {
      const query = diffQuerySchema.safeParse({
        base: c.req.query("base"),
        head: c.req.query("head"),
      });
      if (!query.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const ctx = c.get("ctx");
      const repoId = c.get("repoId");
      const resolved = await resolvePr(ctx, repoId, c.req.param("prNumber"));
      if (!resolved.ok) {
        return errorJson(
          c,
          resolved.status === 400
            ? ApiErrorCode.INVALID_REQUEST
            : ApiErrorCode.NOT_FOUND,
        );
      }
      // Fetch by the AUTHZ-VERIFIED full name (set by the gate from its GitHub
      // access check / positive cache), never the row's stored repo_slug — a
      // rename + name-reuse could point the stored slug at a different repo than
      // the numeric id the gate authorized.
      const target = splitRepoSlug(c.get("repoFullName"));
      if (target === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }

      const session = c.get("session");
      const cacheKey = `${session.sessionTokenHash}:${String(repoId)}:${resolved.pr.prNumber}:${query.data.base}:${query.data.head}`;
      const now = Date.now();
      const cached = diffCache.get(cacheKey, now);
      if (cached !== undefined) {
        return c.body(cached, 200, diffHeaders());
      }

      // The token is set by the gate on the GitHub-verified path; on a
      // positive-cache hit it is absent, so decrypt the session's token lazily.
      let currentSession = session;
      let accessToken =
        c.get("accessToken") ??
        (await resolveSessionToken(deps, currentSession));
      if (accessToken === undefined) {
        return errorJson(c, ApiErrorCode.UNAUTHORIZED);
      }

      // Fetch the diff for the REQUESTED span (base...head), not the whole PR.
      const span = {
        owner: target.owner,
        repo: target.repo,
        base: query.data.base,
        head: query.data.head,
      };
      let diff = await fetchCompareDiff(createUserOctokit(accessToken), span);

      // A positive-cache hit skips the gate's GitHub check, so the lazily-decrypted
      // token may be an expired ~8h access token → GitHub 401. Refresh once and
      // retry (mirrors the gate's verified path) before surfacing a failure.
      if (!diff.ok && diff.error.code === GitHubApiErrorCode.UNAUTHORIZED) {
        const refreshed = await refreshSessionToken(
          deps,
          currentSession,
          c.get("logger"),
        );
        if (!refreshed.ok) {
          return errorJson(c, ApiErrorCode.UNAUTHORIZED);
        }
        currentSession = refreshed.value.session;
        accessToken = refreshed.value.accessToken;
        diff = await fetchCompareDiff(createUserOctokit(accessToken), span);
      }
      if (!diff.ok) {
        // 406 = GitHub refuses to render the diff (too large: >300 files/20k
        // lines) — a PERMANENT condition for this span, so surface it as 413
        // rather than a retryable-looking 502.
        if (diff.error.status === 406) {
          return errorJson(c, ApiErrorCode.DIFF_TOO_LARGE);
        }
        return errorJson(
          c,
          diff.error.code === GitHubApiErrorCode.NOT_FOUND
            ? ApiErrorCode.NOT_FOUND
            : ApiErrorCode.GITHUB_UNAVAILABLE,
        );
      }
      // Serve always; cache only when small enough (oversized diffs are rare and
      // cheap to re-proxy) so the map can't grow past its byte budget.
      if (diff.value.length <= DIFF_CACHE_MAX_ENTRY_BYTES) {
        diffCache.set(cacheKey, diff.value, now + DIFF_CACHE_TTL_MS, now);
      }
      return c.body(diff.value, 200, diffHeaders());
    },
  );

  return app;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

interface PreviousBriefComparisonView {
  readonly baselineSha: string;
  readonly baselineIndex: number;
  readonly narrativeAvailable: boolean;
}

/** One revision's Compare availability envelope; mirrors the top-level shape. */
interface RevisionComparisons {
  readonly previousBrief?: PreviousBriefComparisonView;
  readonly lastReview?: LastReviewComparisonView;
}

/**
 * A browsable Brief revision. `baseSha` is PER-ENTRY and critical: the base
 * drifts across revisions (base-branch advance / retarget) and the brief GET is
 * an exact `(pr, base, head)` lookup, so a consumer must never derive base from
 * the top-level view. Ordered by `headIndex`.
 */
interface RevisionView {
  readonly headSha: string;
  readonly baseSha: string;
  readonly headIndex: number;
  readonly createdAt: string;
  /**
   * When this revision's brief generation STARTED — the conversation cutoff:
   * comments newer than this postdate the brief. Falls back to `createdAt` (the
   * artifact write, strictly later) when the projection row is gone.
   */
  readonly generatedAt: string;
  readonly comparisons: RevisionComparisons;
}

// Span-existence joins: a `Set` of packed keys turns per-revision availability
// into an in-memory lookup (space separator — SHAs are hex, never contain it).
const SPAN_KEY_SEP = " ";
function spanKey(baseline: string, head: string): string {
  return `${baseline}${SPAN_KEY_SEP}${head}`;
}
function comparisonSpanSet(
  rows: readonly ComparisonSpanRow[],
): ReadonlySet<string> {
  return new Set(rows.map((row) => spanKey(row.baselineSha, row.headSha)));
}
function narrativeSpanSet(
  rows: readonly NarrativeSpanRow[],
): ReadonlySet<string> {
  return new Set(rows.map((row) => spanKey(row.prevHeadSha, row.headSha)));
}

/**
 * Previous-brief comparison availability for a GIVEN briefed head: the
 * highest-index brief BELOW this one whose head differs (the worker's own
 * baseline rule) — restricting to a lower index is what makes this correct for
 * a HISTORICAL head, not only the latest. Offered only when the mechanical
 * marks row exists (marks are the sole highlight truth); a missing narrative
 * only downgrades `narrativeAvailable`.
 */
function derivePreviousBriefComparison(
  target: BriefSpanRow,
  briefs: readonly BriefSpanRow[],
  markSpans: ReadonlySet<string>,
  narrativeSpans: ReadonlySet<string>,
): PreviousBriefComparisonView | undefined {
  // `briefs` is ordered by headIndex ascending → the last lower-index match is
  // the highest-index previous briefed head.
  let previous: BriefSpanRow | undefined;
  for (const row of briefs) {
    if (row.headIndex < target.headIndex && row.headSha !== target.headSha) {
      previous = row;
    }
  }
  if (previous === undefined) {
    return undefined;
  }
  if (!markSpans.has(spanKey(previous.headSha, target.headSha))) {
    return undefined;
  }
  return {
    baselineSha: previous.headSha,
    baselineIndex: previous.headIndex,
    narrativeAvailable: narrativeSpans.has(
      spanKey(previous.headSha, target.headSha),
    ),
  };
}

function isNonTerminal(status: GenerationStatus): boolean {
  return (
    status === GenerationStatus.QUEUED || status === GenerationStatus.RUNNING
  );
}

/**
 * Why `lastReview` is unavailable despite a recorded checkpoint. API-response
 * vocabulary only — never stored, so no DB CHECK/migration.
 */
export const LastReviewUnavailableReason = {
  /** No marks and no live generation — GC'd baseline / rewritten history. */
  BASELINE_UNAVAILABLE: "baseline-unavailable",
  /** No marks yet, but a delta generation for the span is still non-terminal. */
  PENDING: "pending",
} as const;
export type LastReviewUnavailableReason = ValueOf<
  typeof LastReviewUnavailableReason
>;

/**
 * The PR-meta `comparisons.lastReview` union: the reviewer-personal "since MY
 * last review" comparison. Marks existence IS the offer; the delta core is
 * optional richness (`deltaAvailable` — the worker skips it on huge spans).
 * Structurally compatible with the local path's shape.
 */
export type LastReviewComparisonView =
  | {
      readonly deltaAvailable: boolean;
      readonly baselineSha: string;
      /** The baseline's brief index when the checkpoint SHA was a briefed head. */
      readonly baselineIndex?: number;
    }
  | { readonly unavailable: LastReviewUnavailableReason };

/** The requesting reviewer's checkpoint slice `deriveLastReviewComparison` needs. */
interface CheckpointBaseline {
  readonly lastSubmittedSha: string;
}

/**
 * Probe whether a still-absent `(baseline → head)` marks span is PENDING vs
 * permanently BASELINE_UNAVAILABLE — the one DB read the `lastReview`
 * derivation may need. Wired for the LATEST head only (history is never
 * actively warming) and MEMOIZED per baseline, so at most one generation query
 * per request. Two pending signals, because production writes NO delta-kind
 * projection rows today (delta warming runs inside the brief job): (a) the
 * current head's BRIEF generation is still non-terminal — marks land before it
 * succeeds, so its warming window IS the delta's; (b) a non-terminal
 * delta-kind row for the exact span, kept for when delta generation gets its
 * own projection.
 */
function makeLatestPendingProbe(
  deps: AuthRouteDeps,
  ctx: TenantContext,
  pullRequestId: PullRequestRow["id"],
  headSha: string,
  latestBriefGeneration: GenerationRow | undefined,
): (baselineSha: string) => Promise<boolean> {
  const memo = new Map<string, Promise<boolean>>();
  return (baselineSha) => {
    const hit = memo.get(baselineSha);
    if (hit !== undefined) {
      return hit;
    }
    const result = (async (): Promise<boolean> => {
      const briefGenPending =
        latestBriefGeneration !== undefined &&
        latestBriefGeneration.headSha === headSha &&
        isNonTerminal(latestBriefGeneration.status);
      if (briefGenPending) {
        return true;
      }
      const deltaGeneration = await generationProjection(deps.handle, ctx).get({
        pullRequestId,
        kind: GenerationKind.DELTA,
        headSha,
        baselineSha,
      });
      return (
        deltaGeneration !== undefined && isNonTerminal(deltaGeneration.status)
      );
    })();
    memo.set(baselineSha, result);
    return result;
  };
}

/**
 * Derive `lastReview` at a GIVEN head from the REQUESTING reviewer's checkpoint.
 * Absent when there is nothing to explain: no checkpoint, or the checkpoint IS
 * this head (empty span). Marks existence IS the offer; row existence also
 * encodes DIRECTION — the worker only warms forward spans, so a checkpoint
 * newer than this head simply has no marks and offers nothing.
 *
 * `pendingProbe` is supplied for the latest head only; for a historical head a
 * missing marks span is BASELINE_UNAVAILABLE outright.
 */
async function deriveLastReviewComparison(
  headSha: string,
  checkpoint: CheckpointBaseline | undefined,
  briefs: readonly BriefSpanRow[],
  markSpans: ReadonlySet<string>,
  deltaSpans: ReadonlySet<string>,
  pendingProbe: ((baselineSha: string) => Promise<boolean>) | undefined,
): Promise<LastReviewComparisonView | undefined> {
  if (checkpoint === undefined || checkpoint.lastSubmittedSha === headSha) {
    return undefined;
  }
  const baselineSha = checkpoint.lastSubmittedSha;
  if (markSpans.has(spanKey(baselineSha, headSha))) {
    // Deterministic: `briefs` is headIndex-ascending, so `find` resolves the
    // LOWEST index when duplicate rows share the checkpoint SHA (a retarget
    // re-brief) — either duplicate labels the same commit.
    const baselineIndex = briefs.find(
      (row) => row.headSha === baselineSha,
    )?.headIndex;
    return {
      deltaAvailable: deltaSpans.has(spanKey(baselineSha, headSha)),
      baselineSha,
      ...(baselineIndex === undefined ? {} : { baselineIndex }),
    };
  }
  const pending =
    pendingProbe !== undefined && (await pendingProbe(baselineSha));
  return {
    unavailable: pending
      ? LastReviewUnavailableReason.PENDING
      : LastReviewUnavailableReason.BASELINE_UNAVAILABLE,
  };
}

/**
 * Return a stored artifact `body` verbatim as JSON. The body is ALREADY a JSON
 * string (persistence passthrough) — do NOT re-parse/re-serialize it.
 * `no-store`: these are per-viewer, authz-gated responses.
 */
function artifactJson(c: Context<AuthzEnv>, body: string): Response {
  return c.body(body, 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

function diffHeaders(): Record<string, string> {
  return {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  };
}

/** Decrypt a session's stored access token; `undefined` if it is unreadable. */
async function resolveSessionToken(
  deps: AuthRouteDeps,
  session: { keyRef: string; ghTokenCiphertext: string },
): Promise<string | undefined> {
  const decrypted = await decryptToken(
    deps.auth.keyProvider,
    session.keyRef,
    session.ghTokenCiphertext,
  );
  return decrypted.ok ? decrypted.value : undefined;
}
