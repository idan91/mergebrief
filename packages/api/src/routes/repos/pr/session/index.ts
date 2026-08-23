// The Review Session routes (`/session`) — the reviewer's private work on one
// Brief. One file, one prefix: the read and the writes share the target
// resolution, the span contract and the freeze rule, so splitting them only
// hid that they are one surface. Every path below is relative to the prefix.
//
// The read is PURE: it NEVER creates a session. A session row exists only once
// the reviewer writes, so before that the payload carries the carry-over
// verdicts evaluated in memory (`preview`), still writing nothing.
// `materialized` is what tells the two apart, and `carriedFromSessionId` tells
// a first-ever session (null) from one that carried and has nothing pending.
// The Brief's artifact body is loaded ONLY when the evaluation needs it — a
// multi-hundred-KB parse, skipped once the session materialized.
//
// Three rules shape every write:
//   - Each write NAMES its Brief (`?base=&head=`, the same span the read
//     takes). Resolving "the newest Brief" instead would redirect a stale tab
//     into a session it has never seen.
//   - Each write goes through `resolveWrite`, so whichever one lands first
//     creates the session and copies the carried work in the same
//     transaction. Materialization belongs to no single operation.
//   - A frozen session — the reviewer has already written against a newer
//     Brief — refuses every write with `pr-changed-since-read` (409).
import type { Context } from "hono";
import {
  DispositionDecision,
  DraftCommentStatus,
  createTenantRepository,
  type DispositionAnchor,
  type ReviewDraftCommentRow,
  type SessionWriter,
} from "persistence";
import { ApiErrorCode, errorJson } from "../../../../error-response";
import {
  PRODUCT_ACTION_ID,
  PRODUCT_QUERY_ID,
} from "../../../../product-operations/ids";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { WRITE_CLASSIFICATION } from "../../../../product-operations/types";
import type { AuthzEnv } from "../../../authz";
import { AuthChannel, type AuthRouteDeps } from "../../../auth/session";
import {
  loadCarryFacts,
  prNumberSchema,
  resolveSessionTarget,
  spanQuerySchema,
} from "./brief-target";
import { UnreadableBriefError } from "./carry-facts";
import { buildSessionPayload } from "./payload";
import {
  addressSchema,
  anchorSchema,
  briefLocalIdSchema,
  categorySchema,
  createDraftSchema,
  dismissSchema,
  draftBodySchema,
  outcomeSchema,
  readSchema,
  reopenSchema,
} from "./write-input";
import { rowIdSchema } from "../wire-bounds";
import { mapWriteFailure, resolveWrite } from "./write-resolve";

const NO_STORE = { "cache-control": "no-store" };

/**
 * How many unposted drafts one session may hold. It bounds what a single
 * submit posts to GitHub, so it belongs to the session rather than to any
 * one request — the 101st is refused when it is written, not at submit,
 * where the reviewer would have nowhere to put it.
 */
const MAX_SESSION_DRAFTS = 100;

/**
 * The draft this session holds under `id` — its own row, or the copy of the
 * carried row `id` named, exactly as the store addresses one.
 */
function heldDraft(
  drafts: readonly ReviewDraftCommentRow[],
  id: bigint,
): ReviewDraftCommentRow | undefined {
  return drafts.find((row) => row.id === id || row.carriedFromCommentId === id);
}

/**
 * The two answers a write against a named draft owes before it edits: a draft
 * this session does not hold is the subtree's hint-free 404, and one already
 * on GitHub is a 409 — its body is what the audit trail points at, so it can
 * no longer move.
 */
function resolveWritableDraft(
  c: Context<AuthzEnv>,
  draft: ReviewDraftCommentRow | undefined,
):
  | { readonly ok: true; readonly draft: ReviewDraftCommentRow }
  | { readonly ok: false; readonly response: Response } {
  if (draft === undefined) {
    return { ok: false, response: errorJson(c, ApiErrorCode.NOT_FOUND) };
  }
  if (draft.status === DraftCommentStatus.SUBMITTED) {
    return {
      ok: false,
      response: errorJson(c, ApiErrorCode.DRAFT_ALREADY_PUBLISHED),
    };
  }
  return { ok: true, draft };
}

/**
 * THE human-only predicate — one site, covering every clearing operation:
 * the three risk decisions AND re-anchoring or deleting a draft, which are
 * exactly what an orphaned anchor's `clearedBy` names.
 *
 * Clearing an attention item is a judgment the Receipt attributes to the
 * reviewer by name, so an agent clearing one rubber-stamps under the human's
 * signature — whatever scope was granted. Rows carry no per-author ownership,
 * so without this a bearer token clears the human reviewer's carried work.
 * The channel is the only thing asked for: authorship is inseparable in v1
 * (a token's `actor_id` IS its owner's), and a later per-row rule flips this
 * check rather than several call sites. Authoring is untouched — a token
 * writes and edits its own drafts freely.
 */
function isHuman(c: Context<AuthzEnv>): boolean {
  return c.get("session").channel === AuthChannel.COOKIE;
}

/**
 * Run one risk operation's whole array as ONE session write — the array is
 * the operation, so a half-applied bulk is not a state the reviewer asked
 * for. The writes go out together; the transaction is what makes them atomic.
 * The reply counts the rows that changed, which an undo can undershoot.
 */
async function decide(
  c: Context<AuthzEnv>,
  deps: AuthRouteDeps,
  writes: (writer: SessionWriter) => Promise<unknown>[],
): Promise<Response> {
  const resolved = await resolveWrite(deps, c);
  if (!resolved.ok) {
    return resolved.response;
  }
  const written = await resolved.run(async (writer) => {
    const applied = await Promise.all(writes(writer));
    // Rows the call actually changed: an upsert always returns one, an undo
    // returns nothing when this session held no such decision.
    return applied.filter(Boolean).length;
  });
  if (!written.ok) {
    return mapWriteFailure(c, written.error);
  }
  return c.json({ flags: written.value }, 200, NO_STORE);
}

/** The request body, or `undefined` when it is not JSON at all. */
async function readJsonBody(c: Context<AuthzEnv>): Promise<unknown> {
  return c.req.json().catch(() => undefined);
}

export function sessionRoutes(deps: AuthRouteDeps): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();

  // GET the session — the reviewer's work on the Brief at (base, head). A
  // query: it reads, it projects, and it creates nothing on any path. Mounted
  // at the prefix, so this is the prefix's own path.
  app.query(
    {
      id: PRODUCT_QUERY_ID.READ_REVIEW_SESSION,
      classification: WRITE_CLASSIFICATION.READ,
    },
    "/",
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
      const target = await resolveSessionTarget(
        deps,
        ctx,
        c.get("repoId"),
        prNumber.data,
        span.data,
      );
      if (target === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      let view;
      try {
        view = await createTenantRepository(
          deps.handle,
          ctx,
        ).reviewSessions.preview({
          briefId: target.briefId,
          reviewerId: c.get("session").reviewerId,
          brief: () => loadCarryFacts(deps, ctx, target, span.data),
        });
      } catch (error) {
        if (!(error instanceof UnreadableBriefError)) throw error;
        c.get("logger").error(
          "brief artifact unreadable — carry-over not evaluated",
          { briefId: String(target.briefId), head: span.data.head },
        );
        return errorJson(c, ApiErrorCode.INTERNAL_ERROR);
      }
      return c.json(buildSessionPayload(view, target.headIndex), 200, {
        "cache-control": "no-store",
      });
    },
  );

  app.action(
    {
      id: PRODUCT_ACTION_ID.CREATE_DRAFT_COMMENT,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "post",
    "/comments",
    async (c) => {
      const parsed = createDraftSchema.safeParse(await readJsonBody(c));
      if (!parsed.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const resolved = await resolveWrite(deps, c);
      if (!resolved.ok) {
        return resolved.response;
      }
      const written = await resolved.run(async (writer) => {
        const held = await writer.draftComments();
        const unposted = held.filter(
          (row) => row.status === DraftCommentStatus.DRAFT,
        );
        if (unposted.length >= MAX_SESSION_DRAFTS) {
          return undefined;
        }
        return await writer.addDraftComment(parsed.data);
      });
      if (!written.ok) {
        return mapWriteFailure(c, written.error);
      }
      if (written.value === undefined) {
        return errorJson(c, ApiErrorCode.DRAFT_LIMIT_REACHED);
      }
      return c.json({ draftId: String(written.value.id) }, 201, NO_STORE);
    },
  );

  app.action(
    {
      id: PRODUCT_ACTION_ID.UPDATE_DRAFT_COMMENT,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "patch",
    "/comments/:draftId",
    async (c) => {
      const draftId = rowIdSchema.safeParse(c.req.param("draftId"));
      const parsed = draftBodySchema.safeParse(await readJsonBody(c));
      if (!draftId.success || !parsed.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const resolved = await resolveWrite(deps, c);
      if (!resolved.ok) {
        return resolved.response;
      }
      const written = await resolved.run(async (writer) => {
        const held = heldDraft(await writer.draftComments(), draftId.data);
        if (
          held === undefined ||
          held.status === DraftCommentStatus.SUBMITTED
        ) {
          return held;
        }
        return await writer.updateDraftComment(draftId.data, {
          body: parsed.data.body,
        });
      });
      if (!written.ok) {
        return mapWriteFailure(c, written.error);
      }
      const outcome = resolveWritableDraft(c, written.value);
      if (!outcome.ok) {
        return outcome.response;
      }
      return c.json({ draftId: String(outcome.draft.id) }, 200, NO_STORE);
    },
  );

  app.action(
    {
      id: PRODUCT_ACTION_ID.REANCHOR_DRAFT_COMMENT,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "put",
    "/comments/:draftId/anchor",
    async (c) => {
      const draftId = rowIdSchema.safeParse(c.req.param("draftId"));
      const parsed = anchorSchema.safeParse(await readJsonBody(c));
      if (!draftId.success || !parsed.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      if (!isHuman(c)) {
        return errorJson(c, ApiErrorCode.HUMAN_ONLY);
      }
      const resolved = await resolveWrite(deps, c);
      if (!resolved.ok) {
        return resolved.response;
      }
      const written = await resolved.run(async (writer) => {
        const held = heldDraft(await writer.draftComments(), draftId.data);
        if (
          held === undefined ||
          held.status === DraftCommentStatus.SUBMITTED
        ) {
          return held;
        }
        // The human placed it, so the carry-over's verdict is settled.
        return await writer.updateDraftComment(draftId.data, {
          ...parsed.data,
          anchorStatus: null,
        });
      });
      if (!written.ok) {
        return mapWriteFailure(c, written.error);
      }
      const outcome = resolveWritableDraft(c, written.value);
      if (!outcome.ok) {
        return outcome.response;
      }
      return c.json({ draftId: String(outcome.draft.id) }, 200, NO_STORE);
    },
  );

  app.action(
    {
      id: PRODUCT_ACTION_ID.DELETE_DRAFT_COMMENT,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "delete",
    "/comments/:draftId",
    async (c) => {
      const draftId = rowIdSchema.safeParse(c.req.param("draftId"));
      if (!draftId.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      if (!isHuman(c)) {
        return errorJson(c, ApiErrorCode.HUMAN_ONLY);
      }
      const resolved = await resolveWrite(deps, c);
      if (!resolved.ok) {
        return resolved.response;
      }
      const written = await resolved.run(async (writer) => {
        const held = heldDraft(await writer.draftComments(), draftId.data);
        if (
          held === undefined ||
          held.status === DraftCommentStatus.SUBMITTED
        ) {
          return held;
        }
        await writer.deleteDraftComment(draftId.data);
        return held;
      });
      if (!written.ok) {
        return mapWriteFailure(c, written.error);
      }
      const outcome = resolveWritableDraft(c, written.value);
      if (!outcome.ok) {
        return outcome.response;
      }
      // The row that went, not the id that named it: a carried id names the
      // previous session's row, which the copy's deletion leaves alive.
      return c.json({ draftId: String(outcome.draft.id) }, 200, NO_STORE);
    },
  );

  app.action(
    {
      id: PRODUCT_ACTION_ID.SET_CHUNK_READ,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "put",
    "/chunks/:chunkId/read",
    async (c) => {
      const chunkId = briefLocalIdSchema.safeParse(c.req.param("chunkId"));
      const parsed = readSchema.safeParse(await readJsonBody(c));
      if (!chunkId.success || !parsed.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const resolved = await resolveWrite(deps, c);
      if (!resolved.ok) {
        return resolved.response;
      }
      // ONE operation carrying a boolean, not a mark/unmark pair: a retry is
      // the same action again, and both halves are idempotent.
      const read = parsed.data.read;
      const written = await resolved.run(async (writer) => {
        if (read) {
          await writer.putReadMark({ chunkId: chunkId.data });
          return;
        }
        await writer.clearReadMark(chunkId.data);
      });
      if (!written.ok) {
        return mapWriteFailure(c, written.error);
      }
      return c.json({ chunkId: chunkId.data, read }, 200, NO_STORE);
    },
  );

  app.action(
    {
      id: PRODUCT_ACTION_ID.RECLASSIFY_GROUP,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "put",
    "/groups/:groupId/classification",
    async (c) => {
      const groupId = briefLocalIdSchema.safeParse(c.req.param("groupId"));
      const parsed = categorySchema.safeParse(await readJsonBody(c));
      if (!groupId.success || !parsed.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const resolved = await resolveWrite(deps, c);
      if (!resolved.ok) {
        return resolved.response;
      }
      // Overrides only — the Brief supplies every default, so an unchanged
      // group never reaches this route.
      const written = await resolved.run((writer) =>
        writer.putReclassification({
          changeGroupId: groupId.data,
          category: parsed.data.category,
        }),
      );
      if (!written.ok) {
        return mapWriteFailure(c, written.error);
      }
      return c.json(
        { changeGroupId: groupId.data, category: parsed.data.category },
        200,
        NO_STORE,
      );
    },
  );

  // The three risk operations. Three, not one carrying a mode: a reason, a
  // per-flag evidence claim and a bare undo are different payloads recording
  // different judgments. Each takes an ARRAY — bulk is one call, which is the
  // operation's shape and not batching.
  app.action(
    {
      id: PRODUCT_ACTION_ID.DISMISS_RISK,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "post",
    "/risks/dismiss",
    async (c) => {
      const parsed = dismissSchema.safeParse(await readJsonBody(c));
      if (!parsed.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      if (!isHuman(c)) {
        return errorJson(c, ApiErrorCode.HUMAN_ONLY);
      }
      const flags = parsed.data.flags;
      const reason = parsed.data.reason;
      return decide(c, deps, (writer) =>
        flags.map((flag) =>
          writer.putDisposition({
            ...flag,
            decision: DispositionDecision.DISMISSED,
            reason,
          }),
        ),
      );
    },
  );

  app.action(
    {
      id: PRODUCT_ACTION_ID.ADDRESS_RISK,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "post",
    "/risks/address",
    async (c) => {
      const parsed = addressSchema.safeParse(await readJsonBody(c));
      if (!parsed.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      if (!isHuman(c)) {
        return errorJson(c, ApiErrorCode.HUMAN_ONLY);
      }
      const flags = parsed.data.flags;
      return decide(c, deps, (writer) =>
        flags.map(({ evidence, ...anchor }) =>
          // Deciding again also settles the evidence question a carry raised:
          // the reviewer just named what this decision stands on.
          writer.putDisposition({
            ...anchor,
            decision: DispositionDecision.ADDRESSED,
            evidence,
          }),
        ),
      );
    },
  );

  app.action(
    {
      id: PRODUCT_ACTION_ID.REOPEN_RISK,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "post",
    "/risks/reopen",
    async (c) => {
      const parsed = reopenSchema.safeParse(await readJsonBody(c));
      if (!parsed.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      if (!isHuman(c)) {
        return errorJson(c, ApiErrorCode.HUMAN_ONLY);
      }
      const flags: DispositionAnchor[] = parsed.data.flags;
      return decide(c, deps, (writer) =>
        flags.map((flag) => writer.deleteDisposition(flag)),
      );
    },
  );

  app.action(
    {
      id: PRODUCT_ACTION_ID.SET_REVIEW_OUTCOME,
      classification: WRITE_CLASSIFICATION.PRIVATE_WRITE,
    },
    "put",
    "/outcome",
    async (c) => {
      const parsed = outcomeSchema.safeParse(await readJsonBody(c));
      if (!parsed.success) {
        return errorJson(c, ApiErrorCode.INVALID_REQUEST);
      }
      const resolved = await resolveWrite(deps, c);
      if (!resolved.ok) {
        return resolved.response;
      }
      const outcome = parsed.data.outcome;
      const written = await resolved.run((writer) =>
        writer.setReviewOutcome(outcome),
      );
      if (!written.ok) {
        return mapWriteFailure(c, written.error);
      }
      // Read back off the row, not the request: the picker is server-
      // authoritative, and a new session starts at `comment` regardless.
      return c.json({ outcome: written.value.reviewOutcome }, 200, NO_STORE);
    },
  );

  return app;
}
