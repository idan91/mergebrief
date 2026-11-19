// Every session answer is read back through the parser the review screen
// uses, so a payload the screen would refuse fails here first.
import {
  ApiErrorCodes,
  buildOperationPath,
  parseApiErrorBody,
  ProductActionIds,
  ProductQueryIds,
  type ProductOperationId,
} from "contract";
import {
  ChangeGroupCategories,
  CommentAnchorKinds,
  DiffSides,
  DispositionDecisions,
  DispositionEvidenceKinds,
  HttpMethods,
  HttpStatuses,
  ReviewOutcomes,
} from "types";
import { describe, expect, it } from "vitest";

import {
  parseReviewSessionPayload,
  type ReviewSessionPayload,
} from "@web/features/review/session";
import { DEMO_PR } from "../consts";
import { createDemoSessionStore, type DemoSessionStore } from ".";
import { answerSessionRequest } from "./answers";

const ORIGIN = "http://demo.local";
const REV1 = { base: "base-sha", head: "head-1" };
const REV2 = { base: "base-sha", head: "head-2" };
const FILE = "apps/api/src/routes/auth/sessions/handler.ts";
const LINE_ANCHOR = {
  filePath: FILE,
  side: DiffSides.NEW,
  startLine: 3,
  endLine: 5,
};
const FLAG = {
  filePath: FILE,
  attribute: "auth",
  regionStart: 1,
  regionEnd: 9,
};

interface SendInput {
  readonly method: string;
  readonly id: ProductOperationId;
  readonly params?: Readonly<Record<string, string>>;
  readonly span?: { readonly base: string; readonly head: string };
  readonly body?: unknown;
}

function send(store: DemoSessionStore, input: SendInput): Response {
  const params: Record<string, string | number> = {
    repoId: DEMO_PR.repoId,
    prNumber: DEMO_PR.prNumber,
    ...input.params,
  };
  const path = buildOperationPath(input.id, params as never);
  const span = input.span ?? REV2;
  const url = new URL(`${path}?base=${span.base}&head=${span.head}`, ORIGIN);
  const response = answerSessionRequest(store, input.method, url, input.body);
  if (response === undefined) {
    throw new Error(`no session route for ${input.id}`);
  }
  return response;
}

async function readSession(
  store: DemoSessionStore,
  span = REV2,
): Promise<ReviewSessionPayload> {
  const response = send(store, {
    method: HttpMethods.GET,
    id: ProductQueryIds.READ_REVIEW_SESSION,
    span,
  });
  const parsed = parseReviewSessionPayload(await response.json());
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
}

async function createDraft(
  store: DemoSessionStore,
  body: unknown,
): Promise<string> {
  const response = send(store, {
    method: HttpMethods.POST,
    id: ProductActionIds.CREATE_DRAFT_COMMENT,
    body,
  });
  expect(response.status).toBe(HttpStatuses.CREATED);
  const created: { draftId: string } = await response.json();
  return created.draftId;
}

describe("answerSessionRequest drafts", () => {
  it("saves, edits, reanchors and deletes a draft", async () => {
    const store = createDemoSessionStore();

    const draftId = await createDraft(store, {
      ...LINE_ANCHOR,
      body: "Check the token",
    });
    const saved = await readSession(store);

    expect(saved.materialized).toBe(true);
    expect(saved.draftComments).toMatchObject([
      { id: draftId, body: "Check the token", startLine: 3, endLine: 5 },
    ]);

    const update = send(store, {
      method: HttpMethods.PATCH,
      id: ProductActionIds.UPDATE_DRAFT_COMMENT,
      params: { draftId },
      body: { body: "Revoke the token" },
    });
    const reanchor = send(store, {
      method: HttpMethods.PUT,
      id: ProductActionIds.REANCHOR_DRAFT_COMMENT,
      params: { draftId },
      body: { kind: CommentAnchorKinds.FILE, filePath: FILE },
    });

    expect(update.status).toBe(HttpStatuses.NO_CONTENT);
    expect(reanchor.status).toBe(HttpStatuses.NO_CONTENT);
    expect((await readSession(store)).draftComments).toMatchObject([
      { id: draftId, body: "Revoke the token", kind: CommentAnchorKinds.FILE },
    ]);

    const remove = send(store, {
      method: HttpMethods.DELETE,
      id: ProductActionIds.DELETE_DRAFT_COMMENT,
      params: { draftId },
    });

    expect(remove.status).toBe(HttpStatuses.NO_CONTENT);
    expect((await readSession(store)).draftComments).toEqual([]);
  });

  it("keeps each span's drafts apart", async () => {
    const store = createDemoSessionStore();

    await createDraft(store, { ...LINE_ANCHOR, body: "On the newest push" });

    expect((await readSession(store, REV1)).draftComments).toEqual([]);
    expect((await readSession(store, REV2)).draftComments).toHaveLength(1);
  });

  it("answers not-found for a draft the session does not hold", async () => {
    const response = send(createDemoSessionStore(), {
      method: HttpMethods.PATCH,
      id: ProductActionIds.UPDATE_DRAFT_COMMENT,
      params: { draftId: "demo-draft-404" },
      body: { body: "Nothing here" },
    });

    expect(parseApiErrorBody(await response.json())?.code).toBe(
      ApiErrorCodes.NOT_FOUND,
    );
  });

  it("refuses a draft with no body as an invalid request", async () => {
    const response = send(createDemoSessionStore(), {
      method: HttpMethods.POST,
      id: ProductActionIds.CREATE_DRAFT_COMMENT,
      body: LINE_ANCHOR,
    });

    expect(parseApiErrorBody(await response.json())?.code).toBe(
      ApiErrorCodes.INVALID_REQUEST,
    );
  });

  it("refuses a session write that names no span", async () => {
    const path = buildOperationPath(ProductActionIds.CREATE_DRAFT_COMMENT, {
      repoId: DEMO_PR.repoId,
      prNumber: DEMO_PR.prNumber,
    });
    const response = answerSessionRequest(
      createDemoSessionStore(),
      HttpMethods.POST,
      new URL(path, ORIGIN),
      { ...LINE_ANCHOR, body: "No span" },
    );

    expect(response?.status).toBe(HttpStatuses.BAD_REQUEST);
  });
});

describe("answerSessionRequest marks and verdicts", () => {
  it("marks a chunk read, then unread", async () => {
    const store = createDemoSessionStore();
    const params = { chunkId: "chunk-1" };

    send(store, {
      method: HttpMethods.POST,
      id: ProductActionIds.MARK_CHUNK_READ,
      params,
    });
    expect((await readSession(store)).readMarks).toEqual(["chunk-1"]);

    send(store, {
      method: HttpMethods.POST,
      id: ProductActionIds.MARK_CHUNK_UNREAD,
      params,
    });
    expect((await readSession(store)).readMarks).toEqual([]);
  });

  it("reclassifies a group and sets the outcome", async () => {
    const store = createDemoSessionStore();

    send(store, {
      method: HttpMethods.PUT,
      id: ProductActionIds.RECLASSIFY_GROUP,
      params: { groupId: "group-1" },
      body: { category: ChangeGroupCategories.BUGFIX },
    });
    const outcome = send(store, {
      method: HttpMethods.PUT,
      id: ProductActionIds.SET_REVIEW_OUTCOME,
      body: { outcome: ReviewOutcomes.APPROVE },
    });
    const session = await readSession(store);

    expect(await outcome.json()).toEqual({ outcome: ReviewOutcomes.APPROVE });
    expect(session.reviewOutcome).toBe(ReviewOutcomes.APPROVE);
    expect(session.reclassifications).toEqual([
      { changeGroupId: "group-1", category: ChangeGroupCategories.BUGFIX },
    ]);
  });

  it("dismisses, addresses and reopens a flag", async () => {
    const store = createDemoSessionStore();

    const dismiss = send(store, {
      method: HttpMethods.POST,
      id: ProductActionIds.DISMISS_RISK,
      body: { flags: [FLAG], reason: "Covered by the middleware" },
    });

    expect(await dismiss.json()).toEqual({ count: 1 });
    expect((await readSession(store)).dispositions).toMatchObject([
      { decision: DispositionDecisions.DISMISSED },
    ]);

    send(store, {
      method: HttpMethods.POST,
      id: ProductActionIds.ADDRESS_RISK,
      body: {
        flags: [
          {
            ...FLAG,
            evidence: { kind: DispositionEvidenceKinds.MANUAL_NOTE, ref: "ok" },
          },
        ],
      },
    });

    expect((await readSession(store)).dispositions).toMatchObject([
      { decision: DispositionDecisions.ADDRESSED },
    ]);

    const reopen = send(store, {
      method: HttpMethods.POST,
      id: ProductActionIds.REOPEN_RISK,
      body: { flags: [FLAG] },
    });

    expect(await reopen.json()).toEqual({ count: 1 });
    expect((await readSession(store)).dispositions).toEqual([]);
  });

  it("leaves a request outside the session to the fixtures", () => {
    const url = new URL(
      buildOperationPath(ProductActionIds.GENERATE_BRIEF, {}),
      ORIGIN,
    );

    expect(
      answerSessionRequest(createDemoSessionStore(), HttpMethods.POST, url, {}),
    ).toBeUndefined();
  });
});
