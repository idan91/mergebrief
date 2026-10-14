// The Review Session routes, the reviewer's private work on one Brief.
//
// Three rules shape every write. Each NAMES its Brief, since resolving "the
// newest Brief" would redirect a stale tab into a session it has never seen.
// Each binds through the session write seam, so whichever write lands first
// creates the session and copies the carried work in one transaction. And a
// frozen session refuses every write with `pr-changed-since-read`.
import {
  ProductActionIds,
  ProductQueryIds,
  type CreateDraftCommentResponse,
  type RiskWriteResponse,
  type SetReviewOutcomeResponse,
} from "contract";
import type { Context, Handler } from "hono";
import { HttpStatuses } from "types/http";
import type { PullRequestEnv } from "../../../../access/types";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import { BadRequest } from "../../../../shared-errors/api-error";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { rowIdSchema } from "../../../wire-bounds";
import { addressRisk } from "./address-risk";
import { createDraftComment } from "./create-draft-comment";
import { deleteDraftComment } from "./delete-draft-comment";
import { dismissRisk } from "./dismiss-risk";
import { shapeDraftAnchor, shapeNewDraft } from "./logic/draft-write";
import { throwSessionFailure } from "./logic/wire-failures";
import { parseSpanQuery } from "./logic/write-seam";
import { readReviewSession } from "./read-review-session";
import { reanchorDraftComment } from "./reanchor-draft-comment";
import { reclassifyGroup } from "./reclassify-group";
import { reopenRisk } from "./reopen-risk";
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
} from "./schemas";
import { setChunkRead } from "./set-chunk-read";
import { setReviewOutcome } from "./set-review-outcome";
import type { SessionStoreDeps } from "./types";
import { updateDraftComment } from "./update-draft-comment";

const NO_STORE = { "cache-control": "no-store" } as const;

/** The request body, or `undefined` when it is not JSON at all. */
async function readJsonBody(c: Context<PullRequestEnv>) {
  return c.req.json().catch(() => undefined);
}

function buildStoreDeps(
  deps: AuthRouteDeps,
  c: Context<PullRequestEnv>,
): SessionStoreDeps {
  return { handle: deps.handle, log: c.get("logger") };
}

function createReadSessionHandler(
  deps: AuthRouteDeps,
): Handler<PullRequestEnv> {
  return async (c) => {
    const span = parseSpanQuery(c);
    if (span === undefined) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const read = await readReviewSession(buildStoreDeps(deps, c), access, {
      span,
    });
    if (!read.ok) {
      throwSessionFailure(read.error);
    }

    return c.json(read.value, HttpStatuses.OK, NO_STORE);
  };
}

function createDraftCommentHandler(
  deps: AuthRouteDeps,
): Handler<PullRequestEnv> {
  return async (c) => {
    const parsed = createDraftSchema.safeParse(await readJsonBody(c));
    const span = parseSpanQuery(c);
    if (!parsed.success || span === undefined) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const added = await createDraftComment(buildStoreDeps(deps, c), access, {
      span,
      draft: shapeNewDraft(parsed.data),
    });
    if (!added.ok) {
      throwSessionFailure(added.error);
    }

    const body: CreateDraftCommentResponse = {
      draftId: String(added.value.id),
    };
    return c.json(body, HttpStatuses.CREATED, NO_STORE);
  };
}

function createUpdateDraftHandler(
  deps: AuthRouteDeps,
): Handler<PullRequestEnv> {
  return async (c) => {
    const draftId = rowIdSchema.safeParse(c.req.param("draftId"));
    const parsed = draftBodySchema.safeParse(await readJsonBody(c));
    const span = parseSpanQuery(c);
    if (!draftId.success || !parsed.success || span === undefined) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const edited = await updateDraftComment(buildStoreDeps(deps, c), access, {
      span,
      draftId: draftId.data,
      body: parsed.data.body,
    });
    if (!edited.ok) {
      throwSessionFailure(edited.error);
    }

    return c.body(null, HttpStatuses.NO_CONTENT, NO_STORE);
  };
}

function createReanchorDraftHandler(
  deps: AuthRouteDeps,
): Handler<PullRequestEnv> {
  return async (c) => {
    const draftId = rowIdSchema.safeParse(c.req.param("draftId"));
    const parsed = anchorSchema.safeParse(await readJsonBody(c));
    const span = parseSpanQuery(c);
    if (!draftId.success || !parsed.success || span === undefined) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const moved = await reanchorDraftComment(buildStoreDeps(deps, c), access, {
      span,
      draftId: draftId.data,
      anchor: shapeDraftAnchor(parsed.data),
    });
    if (!moved.ok) {
      throwSessionFailure(moved.error);
    }

    return c.body(null, HttpStatuses.NO_CONTENT, NO_STORE);
  };
}

function createDeleteDraftHandler(
  deps: AuthRouteDeps,
): Handler<PullRequestEnv> {
  return async (c) => {
    const draftId = rowIdSchema.safeParse(c.req.param("draftId"));
    const span = parseSpanQuery(c);
    if (!draftId.success || span === undefined) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const deleted = await deleteDraftComment(buildStoreDeps(deps, c), access, {
      span,
      draftId: draftId.data,
    });
    if (!deleted.ok) {
      throwSessionFailure(deleted.error);
    }

    return c.body(null, HttpStatuses.NO_CONTENT, NO_STORE);
  };
}

function createSetChunkReadHandler(
  deps: AuthRouteDeps,
): Handler<PullRequestEnv> {
  return async (c) => {
    const chunkId = briefLocalIdSchema.safeParse(c.req.param("chunkId"));
    const parsed = readSchema.safeParse(await readJsonBody(c));
    const span = parseSpanQuery(c);
    if (!chunkId.success || !parsed.success || span === undefined) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const written = await setChunkRead(buildStoreDeps(deps, c), access, {
      span,
      chunkRead: { chunkId: chunkId.data, read: parsed.data.read },
    });
    if (!written.ok) {
      throwSessionFailure(written.error);
    }

    return c.json(written.value, HttpStatuses.OK, NO_STORE);
  };
}

function createReclassifyGroupHandler(
  deps: AuthRouteDeps,
): Handler<PullRequestEnv> {
  return async (c) => {
    const groupId = briefLocalIdSchema.safeParse(c.req.param("groupId"));
    const parsed = categorySchema.safeParse(await readJsonBody(c));
    const span = parseSpanQuery(c);
    if (!groupId.success || !parsed.success || span === undefined) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const reclassification = {
      changeGroupId: groupId.data,
      category: parsed.data.category,
    };
    const written = await reclassifyGroup(buildStoreDeps(deps, c), access, {
      span,
      reclassification,
    });
    if (!written.ok) {
      throwSessionFailure(written.error);
    }

    return c.body(null, HttpStatuses.NO_CONTENT, NO_STORE);
  };
}

function createDismissRiskHandler(
  deps: AuthRouteDeps,
): Handler<PullRequestEnv> {
  return async (c) => {
    const parsed = dismissSchema.safeParse(await readJsonBody(c));
    const span = parseSpanQuery(c);
    if (!parsed.success || span === undefined) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const dismissed = await dismissRisk(buildStoreDeps(deps, c), access, {
      span,
      flags: parsed.data.flags,
      reason: parsed.data.reason,
    });
    if (!dismissed.ok) {
      throwSessionFailure(dismissed.error);
    }

    const body: RiskWriteResponse = { count: dismissed.value };
    return c.json(body, HttpStatuses.OK, NO_STORE);
  };
}

function createAddressRiskHandler(
  deps: AuthRouteDeps,
): Handler<PullRequestEnv> {
  return async (c) => {
    const parsed = addressSchema.safeParse(await readJsonBody(c));
    const span = parseSpanQuery(c);
    if (!parsed.success || span === undefined) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const addressed = await addressRisk(buildStoreDeps(deps, c), access, {
      span,
      flags: parsed.data.flags,
    });
    if (!addressed.ok) {
      throwSessionFailure(addressed.error);
    }

    const body: RiskWriteResponse = { count: addressed.value };
    return c.json(body, HttpStatuses.OK, NO_STORE);
  };
}

function createReopenRiskHandler(deps: AuthRouteDeps): Handler<PullRequestEnv> {
  return async (c) => {
    const parsed = reopenSchema.safeParse(await readJsonBody(c));
    const span = parseSpanQuery(c);
    if (!parsed.success || span === undefined) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const reopened = await reopenRisk(buildStoreDeps(deps, c), access, {
      span,
      flags: parsed.data.flags,
    });
    if (!reopened.ok) {
      throwSessionFailure(reopened.error);
    }

    const body: RiskWriteResponse = { count: reopened.value };
    return c.json(body, HttpStatuses.OK, NO_STORE);
  };
}

function createSetOutcomeHandler(deps: AuthRouteDeps): Handler<PullRequestEnv> {
  return async (c) => {
    const parsed = outcomeSchema.safeParse(await readJsonBody(c));
    const span = parseSpanQuery(c);
    if (!parsed.success || span === undefined) {
      throw new BadRequest();
    }

    const access = c.get("pullRequestAccess");
    const written = await setReviewOutcome(buildStoreDeps(deps, c), access, {
      span,
      outcome: parsed.data.outcome,
    });
    if (!written.ok) {
      throwSessionFailure(written.error);
    }

    // Read back off the row, not the request: the picker is server-
    // authoritative, and a new session starts at `comment` regardless.
    const body: SetReviewOutcomeResponse = {
      outcome: written.value.reviewOutcome,
    };
    return c.json(body, HttpStatuses.OK, NO_STORE);
  };
}

export function sessionRoutes(
  deps: AuthRouteDeps,
): ProductRouter<PullRequestEnv> {
  const app = productRouter<PullRequestEnv>();

  app.query(
    {
      id: ProductQueryIds.READ_REVIEW_SESSION,
      browserSessionOnly: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/",
    createReadSessionHandler(deps),
  );
  app.action(
    {
      id: ProductActionIds.CREATE_DRAFT_COMMENT,
      browserSessionOnly: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/comments",
    createDraftCommentHandler(deps),
  );
  app.action(
    {
      id: ProductActionIds.UPDATE_DRAFT_COMMENT,
      browserSessionOnly: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/comments/:draftId",
    createUpdateDraftHandler(deps),
  );
  app.action(
    {
      id: ProductActionIds.REANCHOR_DRAFT_COMMENT,
      browserSessionOnly: true,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/comments/:draftId/anchor",
    createReanchorDraftHandler(deps),
  );
  app.action(
    {
      id: ProductActionIds.DELETE_DRAFT_COMMENT,
      browserSessionOnly: true,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/comments/:draftId",
    createDeleteDraftHandler(deps),
  );
  app.action(
    {
      id: ProductActionIds.SET_CHUNK_READ,
      browserSessionOnly: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/chunks/:chunkId/read",
    createSetChunkReadHandler(deps),
  );
  app.action(
    {
      id: ProductActionIds.RECLASSIFY_GROUP,
      browserSessionOnly: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/groups/:groupId/classification",
    createReclassifyGroupHandler(deps),
  );
  // The three risk operations. Three, not one carrying a mode: a reason, a
  // per-flag evidence claim and a bare undo are different payloads recording
  // different judgments. Each takes an ARRAY, bulk is one call, which is
  // the operation's shape and not batching.
  app.action(
    {
      id: ProductActionIds.DISMISS_RISK,
      browserSessionOnly: true,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/risks/dismiss",
    createDismissRiskHandler(deps),
  );
  app.action(
    {
      id: ProductActionIds.ADDRESS_RISK,
      browserSessionOnly: true,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/risks/address",
    createAddressRiskHandler(deps),
  );
  app.action(
    {
      id: ProductActionIds.REOPEN_RISK,
      browserSessionOnly: true,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/risks/reopen",
    createReopenRiskHandler(deps),
  );
  app.action(
    {
      id: ProductActionIds.SET_REVIEW_OUTCOME,
      browserSessionOnly: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: true,
    },
    "/outcome",
    createSetOutcomeHandler(deps),
  );

  return app;
}
