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
import { forTenant } from "persistence";
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
import type { AuthRouteDeps } from "../../../auth/session";
import {
  loadCarryFacts,
  prNumberSchema,
  resolveSessionTarget,
  spanQuerySchema,
} from "./brief-target";
import { UnreadableBriefError } from "./carry-facts";
import { buildSessionPayload } from "./payload";
import {
  anchorSchema,
  briefLocalIdSchema,
  categorySchema,
  createDraftSchema,
  draftBodySchema,
  readSchema,
  rowIdSchema,
} from "./write-input";
import { mapWriteFailure, resolveWrite } from "./write-resolve";

const NO_STORE = { "cache-control": "no-store" };

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
        view = await forTenant(deps.handle, ctx).reviewSessions.preview({
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
      const written = await resolved.run((writer) =>
        writer.addDraftComment(parsed.data),
      );
      if (!written.ok) {
        return mapWriteFailure(c, written.error);
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
      const written = await resolved.run((writer) =>
        writer.updateDraftComment(draftId.data, {
          body: parsed.data.body,
        }),
      );
      if (!written.ok) {
        return mapWriteFailure(c, written.error);
      }
      // A draft this session does not hold is indistinguishable from one that
      // never existed — the same 404 either way.
      if (written.value === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      return c.json({ draftId: String(written.value.id) }, 200, NO_STORE);
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
      const resolved = await resolveWrite(deps, c);
      if (!resolved.ok) {
        return resolved.response;
      }
      const written = await resolved.run((writer) =>
        // The human placed it, so the carry-over's verdict is settled.
        writer.updateDraftComment(draftId.data, {
          ...parsed.data,
          anchorStatus: null,
        }),
      );
      if (!written.ok) {
        return mapWriteFailure(c, written.error);
      }
      if (written.value === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      return c.json({ draftId: String(written.value.id) }, 200, NO_STORE);
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
      const resolved = await resolveWrite(deps, c);
      if (!resolved.ok) {
        return resolved.response;
      }
      const written = await resolved.run((writer) =>
        writer.deleteDraftComment(draftId.data),
      );
      if (!written.ok) {
        return mapWriteFailure(c, written.error);
      }
      if (written.value === undefined) {
        return errorJson(c, ApiErrorCode.NOT_FOUND);
      }
      // The row that went, not the id that named it: a carried id names the
      // previous session's row, which the copy's deletion leaves alive.
      return c.json({ draftId: String(written.value) }, 200, NO_STORE);
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

  return app;
}
