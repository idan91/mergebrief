// The session op handlers, parse, bind through the controller via the
// shared write seam, and map refusals onto the wire as throws. Composition
// stays in `index.ts`.
import type { Context } from "hono";
import {
  DispositionDecisions,
  CommentAnchorKinds,
  DraftCommentStatuses,
  type DispositionAnchor,
  type ReviewDraftCommentRow,
  type SessionWriter,
} from "persistence";
import { ApiErrorCodes } from "contract";
import {
  BadRequest,
  Conflict,
  Forbidden,
  InternalError,
  NotFound,
} from "../../../../shared-errors/api-error";
import { AuthChannels, type AuthRouteDeps } from "../../../auth/session";
import type { AuthzEnv } from "../../../authz";
import { prNumberSchema, rowIdSchema } from "../wire-bounds";
import sessionController from "./controller";
import { MAX_SESSION_DRAFTS } from "./consts";
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
  spanQuerySchema,
} from "./schemas";
import {
  resolveSessionWrite,
  throwSessionWriteFailure,
} from "./logic/write-seam";
import { resolvePrScopeFrom } from "../scope";

const NO_STORE = { "cache-control": "no-store" };

/** The session's own row under `id`, or its copy of the carried row `id`. */
function heldDraft(
  drafts: readonly ReviewDraftCommentRow[],
  id: bigint,
): ReviewDraftCommentRow | undefined {
  return drafts.find((row) => row.id === id || row.carriedFromCommentId === id);
}

/** Unheld draft → the hint-free 404; already on GitHub → 409 (immutable). */
function assertWritableDraft(
  draft: ReviewDraftCommentRow | undefined,
): ReviewDraftCommentRow {
  if (draft === undefined) {
    throw new NotFound();
  }
  if (draft.status === DraftCommentStatuses.SUBMITTED) {
    throw new Conflict(ApiErrorCodes.DRAFT_ALREADY_PUBLISHED);
  }
  return draft;
}

/**
 * THE human-only predicate, one site for every clearing operation: the
 * Receipt attributes a cleared item to the reviewer by name, so a bearer
 * token clearing one would sign under the human's signature.
 */
function assertHuman(c: Context<AuthzEnv>): void {
  if (c.get("session").channel !== AuthChannels.COOKIE) {
    throw new Forbidden(ApiErrorCodes.HUMAN_ONLY);
  }
}

/**
 * Run one risk operation's whole array as ONE session write, the array is
 * the operation, so a half-applied bulk is not a state the reviewer asked
 * for. The writes go out together; the transaction is what makes them
 * atomic. The reply counts the rows that changed, which an undo can
 * undershoot.
 */
async function decide(
  c: Context<AuthzEnv>,
  deps: AuthRouteDeps,
  writes: (writer: SessionWriter) => Promise<unknown>[],
) {
  const resolved = await resolveSessionWrite(deps, c);
  const written = await resolved.run(async (writer) => {
    const applied = await Promise.all(writes(writer));
    // Rows the call actually changed: an upsert always returns one, an undo
    // returns nothing when this session held no such decision.
    return applied.filter(Boolean).length;
  });
  if (!written.ok) {
    throwSessionWriteFailure(written.error);
  }
  return c.json({ flags: written.value }, 200, NO_STORE);
}

/** The request body, or `undefined` when it is not JSON at all. */
async function readJsonBody(c: Context<AuthzEnv>) {
  return c.req.json().catch(() => undefined);
}

export default function createHandlers(deps: AuthRouteDeps) {
  /** GET the session, a query: it reads, it projects, it creates nothing. */
  const readSession = async (c: Context<AuthzEnv>) => {
    const span = spanQuerySchema.safeParse({
      base: c.req.query("base"),
      head: c.req.query("head"),
    });
    const prNumber = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!span.success || !prNumber.success) {
      throw new BadRequest();
    }

    const previewed = await sessionController.previewSession(deps, {
      ctx: await resolvePrScopeFrom(c, deps.handle, prNumber.data),
      repoId: c.get("repoId"),
      prNumber: prNumber.data,
      span: span.data,
      reviewerId: c.get("session").reviewerId,
      log: c.get("logger"),
    });
    if (!previewed.ok) {
      if (previewed.error.kind === "unreadable-brief") {
        throw new InternalError();
      }
      throw new NotFound();
    }

    return c.json(previewed.value, 200, NO_STORE);
  };

  const createDraftComment = async (c: Context<AuthzEnv>) => {
    const parsed = createDraftSchema.safeParse(await readJsonBody(c));
    if (!parsed.success) {
      throw new BadRequest();
    }

    const resolved = await resolveSessionWrite(deps, c);
    const written = await resolved.run(async (writer) => {
      const held = await writer.draftComments();
      const unposted = held.filter(
        (row) => row.status === DraftCommentStatuses.DRAFT,
      );
      if (unposted.length >= MAX_SESSION_DRAFTS) {
        return undefined;
      }
      return await writer.addDraftComment({
        kind: CommentAnchorKinds.LINE,
        filePath: parsed.data.filePath,
        side: parsed.data.side,
        startSide: parsed.data.startSide,
        startLine: parsed.data.startLine,
        endLine: parsed.data.endLine,
        body: parsed.data.body,
      });
    });
    if (!written.ok) {
      throwSessionWriteFailure(written.error);
    }
    if (written.value === undefined) {
      throw new Conflict(ApiErrorCodes.DRAFT_LIMIT_REACHED);
    }

    return c.json({ draftId: String(written.value.id) }, 201, NO_STORE);
  };

  const updateDraftComment = async (c: Context<AuthzEnv>) => {
    const draftId = rowIdSchema.safeParse(c.req.param("draftId"));
    const parsed = draftBodySchema.safeParse(await readJsonBody(c));
    if (!draftId.success || !parsed.success) {
      throw new BadRequest();
    }

    const resolved = await resolveSessionWrite(deps, c);
    const written = await resolved.run(async (writer) => {
      const held = heldDraft(await writer.draftComments(), draftId.data);
      if (
        held === undefined ||
        held.status === DraftCommentStatuses.SUBMITTED
      ) {
        return held;
      }
      return await writer.updateDraftComment(draftId.data, {
        body: parsed.data.body,
      });
    });
    if (!written.ok) {
      throwSessionWriteFailure(written.error);
    }

    const draft = assertWritableDraft(written.value);
    return c.json({ draftId: String(draft.id) }, 200, NO_STORE);
  };

  const reanchorDraftComment = async (c: Context<AuthzEnv>) => {
    const draftId = rowIdSchema.safeParse(c.req.param("draftId"));
    const parsed = anchorSchema.safeParse(await readJsonBody(c));
    if (!draftId.success || !parsed.success) {
      throw new BadRequest();
    }
    assertHuman(c);

    const resolved = await resolveSessionWrite(deps, c);
    const written = await resolved.run(async (writer) => {
      const held = heldDraft(await writer.draftComments(), draftId.data);
      if (
        held === undefined ||
        held.status === DraftCommentStatuses.SUBMITTED
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
      throwSessionWriteFailure(written.error);
    }

    const draft = assertWritableDraft(written.value);
    return c.json({ draftId: String(draft.id) }, 200, NO_STORE);
  };

  const deleteDraftComment = async (c: Context<AuthzEnv>) => {
    const draftId = rowIdSchema.safeParse(c.req.param("draftId"));
    if (!draftId.success) {
      throw new BadRequest();
    }
    assertHuman(c);

    const resolved = await resolveSessionWrite(deps, c);
    const written = await resolved.run(async (writer) => {
      const held = heldDraft(await writer.draftComments(), draftId.data);
      if (
        held === undefined ||
        held.status === DraftCommentStatuses.SUBMITTED
      ) {
        return held;
      }
      await writer.deleteDraftComment(draftId.data);
      return held;
    });
    if (!written.ok) {
      throwSessionWriteFailure(written.error);
    }

    const draft = assertWritableDraft(written.value);
    // The row that went, not the id that named it: a carried id names the
    // previous session's row, which the copy's deletion leaves alive.
    return c.json({ draftId: String(draft.id) }, 200, NO_STORE);
  };

  const setChunkRead = async (c: Context<AuthzEnv>) => {
    const chunkId = briefLocalIdSchema.safeParse(c.req.param("chunkId"));
    const parsed = readSchema.safeParse(await readJsonBody(c));
    if (!chunkId.success || !parsed.success) {
      throw new BadRequest();
    }

    const resolved = await resolveSessionWrite(deps, c);
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
      throwSessionWriteFailure(written.error);
    }

    return c.json({ chunkId: chunkId.data, read }, 200, NO_STORE);
  };

  const reclassifyGroup = async (c: Context<AuthzEnv>) => {
    const groupId = briefLocalIdSchema.safeParse(c.req.param("groupId"));
    const parsed = categorySchema.safeParse(await readJsonBody(c));
    if (!groupId.success || !parsed.success) {
      throw new BadRequest();
    }

    const resolved = await resolveSessionWrite(deps, c);
    // Overrides only, the Brief supplies every default, so an unchanged
    // group never reaches this route.
    const written = await resolved.run((writer) =>
      writer.putReclassification({
        changeGroupId: groupId.data,
        category: parsed.data.category,
      }),
    );
    if (!written.ok) {
      throwSessionWriteFailure(written.error);
    }

    return c.json(
      { changeGroupId: groupId.data, category: parsed.data.category },
      200,
      NO_STORE,
    );
  };

  const dismissRisk = async (c: Context<AuthzEnv>) => {
    const parsed = dismissSchema.safeParse(await readJsonBody(c));
    if (!parsed.success) {
      throw new BadRequest();
    }
    assertHuman(c);
    const flags = parsed.data.flags;
    const reason = parsed.data.reason;
    return decide(c, deps, (writer) =>
      flags.map((flag) =>
        writer.putDisposition({
          ...flag,
          decision: DispositionDecisions.DISMISSED,
          reason,
        }),
      ),
    );
  };

  const addressRisk = async (c: Context<AuthzEnv>) => {
    const parsed = addressSchema.safeParse(await readJsonBody(c));
    if (!parsed.success) {
      throw new BadRequest();
    }
    assertHuman(c);
    const flags = parsed.data.flags;
    return decide(c, deps, (writer) =>
      flags.map(({ evidence, ...anchor }) =>
        // Deciding again also settles the evidence question a carry raised:
        // the reviewer just named what this decision stands on.
        writer.putDisposition({
          ...anchor,
          decision: DispositionDecisions.ADDRESSED,
          evidence,
        }),
      ),
    );
  };

  const reopenRisk = async (c: Context<AuthzEnv>) => {
    const parsed = reopenSchema.safeParse(await readJsonBody(c));
    if (!parsed.success) {
      throw new BadRequest();
    }
    assertHuman(c);
    const flags: DispositionAnchor[] = parsed.data.flags;
    return decide(c, deps, (writer) =>
      flags.map((flag) => writer.deleteDisposition(flag)),
    );
  };

  const setReviewOutcome = async (c: Context<AuthzEnv>) => {
    const parsed = outcomeSchema.safeParse(await readJsonBody(c));
    if (!parsed.success) {
      throw new BadRequest();
    }

    const resolved = await resolveSessionWrite(deps, c);
    const outcome = parsed.data.outcome;
    const written = await resolved.run((writer) =>
      writer.setReviewOutcome(outcome),
    );
    if (!written.ok) {
      throwSessionWriteFailure(written.error);
    }
    // Read back off the row, not the request: the picker is server-
    // authoritative, and a new session starts at `comment` regardless.
    return c.json({ outcome: written.value.reviewOutcome }, 200, NO_STORE);
  };

  return {
    readSession,
    createDraftComment,
    updateDraftComment,
    reanchorDraftComment,
    deleteDraftComment,
    setChunkRead,
    reclassifyGroup,
    dismissRisk,
    addressRisk,
    reopenRisk,
    setReviewOutcome,
  };
}
