// The Review Session read — the reviewer's private work on one Brief, plus
// the Attention List projected off the same rows.
//
// PURE: this route NEVER creates a session. A session row exists only once the
// reviewer writes, so before that the payload carries the carry-over verdicts
// evaluated in memory (`preview`), still writing nothing. `materialized` is
// what tells the two apart, and `carriedFromSessionId` tells a first-ever
// session (null) from one that carried and has nothing pending.
//
// The Brief's artifact body is loaded ONLY when the evaluation needs it — a
// multi-hundred-KB parse for group ids and flags, skipped entirely once the
// session materialized (the common case, and this route reloads on window
// focus).
import {
  artifactStore,
  forTenant,
  ReviewOutcome,
  type AnchorStatus,
  type BriefRowId,
  type CarriedWork,
  type ChangeGroupCategory,
  type DispositionCarryStatus,
  type DispositionDecision,
  type DispositionEvidenceStatus,
  type DraftCommentSide,
  type DraftCommentStatus,
  type FlagKey,
  type PullRequestRowId,
  type TenantContext,
  type ReviewSessionSnapshot,
  type ReviewSessionView,
} from "persistence";
import { z } from "zod";
import { ApiErrorCode, errorJson } from "../../../error-response";
import { PRODUCT_QUERY_ID } from "../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../product-operations/types";
import type { AuthzEnv } from "../../authz";
import type { AuthRouteDeps } from "../../auth/session";
import { deriveAttentionItems, type AttentionItem } from "./attention";

const prNumberSchema = z.coerce.number().int().positive();
const shaSchema = z.string().min(1);
const spanQuerySchema = z.object({ base: shaSchema, head: shaSchema });

/**
 * The slice of the Brief body the carry-over evaluation reads: the change
 * groups a reclassification may descend into, and the flags a disposition may
 * still hang off. Unknown keys are dropped — this is a lean read of a large
 * document, never the artifact contract.
 *
 * The two top-level keys are REQUIRED, unlike everything under them. A body
 * missing them would parse to zero groups and zero flags, which is the same
 * silent mass-`DROPPED` an unparseable body would cause; a chunk missing its
 * ranges is only a chunk with no span.
 */
const lineRangeSchema = z.object({ start: z.number(), end: z.number() });
const briefCarryFactsSchema = z.object({
  changeGroups: z.array(z.object({ id: z.string() })),
  chunks: z.array(
    z.object({
      file: z.string(),
      addedRanges: z.array(lineRangeSchema).default([]),
      removedRanges: z.array(lineRangeSchema).default([]),
      riskSurface: z.array(z.string()).default([]),
    }),
  ),
});

/**
 * A stored Brief artifact that will not parse. Thrown rather than answered
 * with empty facts: no flags firing is indistinguishable from every flag
 * having stopped firing, which turns every carried decision into a silent
 * `DROPPED`. The route boundary catches it and answers a typed 500 — a failed
 * read the reviewer can retry, never work quietly discarded.
 */
export class UnreadableBriefError extends Error {}

/** The chunk's whole diff span — the region its flags' dispositions anchor on. */
function chunkRegion(chunk: {
  addedRanges: readonly { start: number; end: number }[];
  removedRanges: readonly { start: number; end: number }[];
}): { start: number; end: number } {
  const bounds = [...chunk.addedRanges, ...chunk.removedRanges];
  if (bounds.length === 0) return { start: 1, end: 1 };
  return {
    start: Math.min(...bounds.map((range) => range.start)),
    end: Math.max(...bounds.map((range) => range.end)),
  };
}

function carryFacts(body: string): {
  groupIds: string[];
  flags: FlagKey[];
} {
  const parsed = briefCarryFactsSchema.safeParse(readJson(body));
  if (!parsed.success) {
    throw new UnreadableBriefError("brief body will not parse");
  }
  const flags = parsed.data.chunks.flatMap((chunk) => {
    const region = chunkRegion(chunk);
    return chunk.riskSurface.map((attribute) => ({
      filePath: chunk.file,
      attribute,
      regionStart: region.start,
      regionEnd: region.end,
    }));
  });
  return { groupIds: parsed.data.changeGroups.map((group) => group.id), flags };
}

function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * The span the carry-over row states: the Brief the work came from, and how
 * many pushes since. Null is a first-ever session and nothing else.
 */
interface CarriedFromPayload {
  readonly sessionId: string;
  readonly headSha: string;
  /** Pushes between that Brief and this one; at least 1. */
  readonly revisions: number;
}

interface SessionPayload {
  /** False = no row exists; every list below is an in-memory verdict. */
  readonly materialized: boolean;
  readonly carriedFrom: CarriedFromPayload | null;
  readonly reviewOutcome: ReviewOutcome;
  readonly draftComments: readonly DraftCommentPayload[];
  readonly readMarks: readonly string[];
  readonly reclassifications: readonly ReclassificationPayload[];
  readonly dispositions: readonly DispositionPayload[];
  readonly submittedReviewIds: readonly string[];
  readonly attention: readonly AttentionItem[];
}

interface DraftCommentPayload {
  readonly id: string | null;
  readonly filePath: string;
  readonly side: DraftCommentSide;
  readonly startLine: number;
  readonly endLine: number;
  readonly body: string;
  readonly status: DraftCommentStatus;
  readonly anchorStatus: AnchorStatus | null;
}

interface ReclassificationPayload {
  readonly changeGroupId: string;
  readonly category: ChangeGroupCategory;
}

interface DispositionPayload {
  readonly id: string | null;
  readonly filePath: string;
  readonly attribute: string;
  readonly regionStart: number;
  readonly regionEnd: number;
  readonly decision: DispositionDecision;
  readonly reason: string | null;
  readonly carryStatus: DispositionCarryStatus | null;
  readonly evidenceStatus: DispositionEvidenceStatus | null;
  readonly decidedAt: string;
}

function payloadFromSession(
  snapshot: ReviewSessionSnapshot,
): Omit<SessionPayload, "materialized" | "carriedFrom" | "attention"> {
  return {
    reviewOutcome: snapshot.session.reviewOutcome,
    draftComments: snapshot.draftComments.map((row) => ({
      id: String(row.id),
      filePath: row.filePath,
      side: row.side,
      startLine: row.startLine,
      endLine: row.endLine,
      body: row.body,
      status: row.status,
      anchorStatus: row.anchorStatus,
    })),
    readMarks: snapshot.readMarks.map((row) => row.chunkId),
    reclassifications: snapshot.reclassifications.map((row) => ({
      changeGroupId: row.changeGroupId,
      category: row.category,
    })),
    dispositions: snapshot.dispositions.map((row) => ({
      id: String(row.id),
      filePath: row.filePath,
      attribute: row.attribute,
      regionStart: row.regionStart,
      regionEnd: row.regionEnd,
      decision: row.decision,
      reason: row.reason,
      carryStatus: row.carryStatus,
      evidenceStatus: row.evidenceStatus,
      decidedAt: row.decidedAt.toISOString(),
    })),
    submittedReviewIds: snapshot.submittedReviews.map((row) =>
      String(row.githubReviewId),
    ),
  };
}

/** The same payload from verdicts that are not rows yet — hence the null ids. */
function payloadFromCarried(
  carried: CarriedWork,
): Omit<SessionPayload, "materialized" | "carriedFrom" | "attention"> {
  return {
    // No row means no stored verdict; the column's default is what a first
    // write would land on.
    reviewOutcome: ReviewOutcome.COMMENT,
    draftComments: carried.draftComments.map((row) => ({
      id: null,
      filePath: row.filePath,
      side: row.side,
      startLine: row.startLine,
      endLine: row.endLine,
      body: row.body,
      status: row.status,
      anchorStatus: row.anchorStatus,
    })),
    readMarks: [...carried.readMarks],
    reclassifications: carried.reclassifications.map((row) => ({
      changeGroupId: row.changeGroupId,
      category: row.category,
    })),
    dispositions: carried.dispositions.map((row) => ({
      id: null,
      filePath: row.filePath,
      attribute: row.attribute,
      regionStart: row.regionStart,
      regionEnd: row.regionEnd,
      decision: row.decision,
      reason: row.reason,
      carryStatus: row.carryStatus,
      evidenceStatus: row.evidenceStatus,
      decidedAt: row.decidedAt.toISOString(),
    })),
    submittedReviewIds: [],
  };
}

/**
 * `headIndex` is the CURRENT Brief's — the revision count is the distance to
 * the Brief the work carried from, which is what the carry-over row states.
 */
export function buildSessionPayload(
  view: ReviewSessionView,
  headIndex: number,
): SessionPayload {
  const source = view.session ?? view.carried;
  const from = view.carriedFrom;
  return {
    materialized: view.session !== undefined,
    carriedFrom:
      from === undefined
        ? null
        : {
            sessionId: String(from.sessionId),
            headSha: from.headSha,
            revisions: headIndex - from.headIndex,
          },
    ...(view.session === undefined
      ? payloadFromCarried(view.carried)
      : payloadFromSession(view.session)),
    attention: deriveAttentionItems(source),
  };
}

export function sessionRoute(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();

  // GET session — the reviewer's work on the Brief at (base, head). A query:
  // it reads, it projects, and it creates nothing on any path.
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_REVIEW_SESSION,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/session",
    async (c) => {
      const span = spanQuerySchema.safeParse({
        base: c.req.query("base"),
        head: c.req.query("head"),
      });
      const prNumber = prNumberSchema.safeParse(c.req.param("prNumber"));
      if (!span.success || !prNumber.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const ctx = c.get("ctx");
      const store = artifactStore(deps.handle, ctx);
      const pr = await forTenant(deps.handle, ctx).pullRequests.getByNumber(
        c.get("repoId"),
        prNumber.data,
      );
      if (pr === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      // Lean span listing, never `briefs.get`: the row id is all the session
      // needs, and the body is the one column worth not loading.
      const briefs = await store.briefs.listForPullRequest(pr.id);
      const current = briefs.find(
        (row) =>
          row.baseSha === span.data.base && row.headSha === span.data.head,
      );
      if (current === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      const briefId = current.id;
      const logger = c.get("logger");
      let view;
      try {
        view = await forTenant(deps.handle, ctx).reviewSessions.preview({
          briefId,
          reviewerId: c.get("session").reviewerId,
          brief: () => loadCarryFacts(deps, ctx, pr.id, span.data, briefId),
        });
      } catch (error) {
        if (!(error instanceof UnreadableBriefError)) throw error;
        logger.error("brief artifact unreadable — carry-over not evaluated", {
          briefId: String(briefId),
          head: span.data.head,
        });
        return errorJson(c, ApiErrorCode.INTERNAL_ERROR);
      }
      return c.json(buildSessionPayload(view, current.headIndex), 200, {
        "cache-control": "no-store",
      });
    },
  );

  return app;
}

/**
 * Called only when a previous session exists — the parse this route defers.
 * Every arm that cannot state the Brief's facts throws: a missing row is the
 * same hazard as an unparseable one, because empty facts read as "nothing
 * fires any more".
 */
export async function loadCarryFacts(
  deps: AuthRouteDeps,
  ctx: TenantContext,
  pullRequestId: PullRequestRowId,
  span: { base: string; head: string },
  briefId: BriefRowId,
): Promise<{ groupIds: string[]; flags: FlagKey[] }> {
  const row = await artifactStore(deps.handle, ctx).briefs.get(
    pullRequestId,
    span.base,
    span.head,
  );
  // The row was listed a moment ago; a gap here means it was deleted between
  // the two reads.
  if (row === undefined || row.id !== briefId) {
    throw new UnreadableBriefError("brief row vanished between reads");
  }
  return carryFacts(row.body);
}
