// The remaining reviewer reads awaiting conversion (PR meta, brief-context,
// and the LIVE diff proxy), behind the authz gate. The stored-artifact reads
// (brief / marks / delta / narrative) live in `./reads/`.
//
// DIFF PROXY: the diff is NEVER persisted — it is proxied live and held only
// in an ephemeral, per-session in-memory cache (~60s TTL) keyed by
// `(sessionHash, repoId, prNumber, base, head)`.
//
// VALIDATION: params/queries are Zod-validated → 400 on a bad shape; a
// missing PR / artifact is a 404; GitHub fetch failures are sanitized to
// 404/502. No upstream error text, token, or header ever reaches a response
// body.
import type { Context } from "hono";
import {
  createUserOctokit,
  fetchCompareDiff,
  GitHubApiErrorCode,
} from "github";
import {
  createArtifactStore,
  decryptToken,
  createTenantRepository,
  createGenerationProjection,
  type PullRequestRow,
  type RepoId,
  type TenantContext,
} from "persistence";
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
import {
  briefQuerySchema,
  diffQuerySchema,
  prNumberSchema,
} from "./reads/schemas";
import {
  comparisonSpanSet,
  deriveLastReviewComparison,
  derivePreviousBriefComparison,
  makeLatestPendingProbe,
  narrativeSpanSet,
  type RevisionComparisons,
  type RevisionView,
} from "./reads/logic/revision-comparisons";
export {
  LastReviewUnavailableReason,
  type LastReviewComparisonView,
} from "./reads/logic/revision-comparisons";

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
    const pr = await createTenantRepository(
      deps.handle,
      ctx,
    ).pullRequests.getByNumber(repoId, parsed.data);
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
      const store = createArtifactStore(deps.handle, ctx);
      const ids = [resolved.pr.id];
      const [latestBriefs, latestGenerations] = await Promise.all([
        store.briefs.latestForPullRequests(ids),
        createGenerationProjection(deps.handle, ctx).latestBriefForPullRequests(
          ids,
        ),
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
          createTenantRepository(deps.handle, ctx).checkpoints.get(
            pullRequestId,
            c.get("session").reviewerId,
          ),
          createGenerationProjection(deps.handle, ctx).listBriefsForPullRequest(
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
      const repoConfig = await createArtifactStore(
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
