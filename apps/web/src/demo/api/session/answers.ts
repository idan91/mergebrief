import {
  ApiErrorCodes,
  ProductActionIds,
  ProductOperations,
  ProductQueryIds,
  type ProductOperationId,
} from "contract";
import { HttpStatuses } from "types";
import type { z } from "zod/v4";

import { answerEmpty, answerJson, answerRefusal } from "../utils";
import type { DemoSessionStore } from ".";
import {
  addressRisksSchema,
  createDraftSchema,
  dismissRisksSchema,
  draftAnchorSchema,
  reclassifySchema,
  reopenRisksSchema,
  setOutcomeSchema,
  updateDraftSchema,
} from "./schemas";
import type { DemoSessionSpan } from "./types";

const PATH_PARAM = /:([A-Za-z]+)/g;

/** What one matched session request hands its answer. */
interface SessionCall {
  readonly store: DemoSessionStore;
  readonly span: DemoSessionSpan;
  readonly params: Readonly<Record<string, string>>;
  readonly body: unknown;
}

interface SessionRoute {
  readonly method: string;
  readonly pattern: RegExp;
  answer(call: SessionCall): Response;
}

function compilePattern(id: ProductOperationId): RegExp {
  const source = ProductOperations[id].path.replace(PATH_PARAM, "(?<$1>[^/]+)");
  return new RegExp(`^${source}$`);
}

function readParam(call: SessionCall, name: string): string {
  return decodeURIComponent(call.params[name] ?? "");
}

function answerCreated(body: unknown): Response {
  const response = answerJson(body);
  return new Response(response.body, {
    status: HttpStatuses.CREATED,
    headers: response.headers,
  });
}

function answerFound(found: boolean): Response {
  if (!found) {
    return answerRefusal(ApiErrorCodes.NOT_FOUND);
  }
  return answerEmpty();
}

/** The body parsed by `schema`, then answered; a body it refuses is `invalid-request`. */
function answerParsed<Schema extends z.ZodType>(
  call: SessionCall,
  schema: Schema,
  answer: (body: z.output<Schema>) => Response,
): Response {
  const parsed = schema.safeParse(call.body);
  if (!parsed.success) {
    return answerRefusal(ApiErrorCodes.INVALID_REQUEST);
  }
  return answer(parsed.data);
}

function defineRoute(
  id: ProductOperationId,
  answer: (call: SessionCall) => Response,
): SessionRoute {
  return {
    method: ProductOperations[id].method,
    pattern: compilePattern(id),
    answer,
  };
}

const SESSION_ROUTES: readonly SessionRoute[] = [
  defineRoute(ProductQueryIds.READ_REVIEW_SESSION, (call) =>
    answerJson(call.store.readSession(call.span)),
  ),
  defineRoute(ProductActionIds.CREATE_DRAFT_COMMENT, (call) =>
    answerParsed(call, createDraftSchema, (draft) => {
      const draftId = call.store.createDraft(call.span, draft);
      return answerCreated({ draftId });
    }),
  ),
  defineRoute(ProductActionIds.UPDATE_DRAFT_COMMENT, (call) =>
    answerParsed(call, updateDraftSchema, ({ body }) => {
      const draftId = readParam(call, "draftId");
      return answerFound(call.store.updateDraft(call.span, draftId, body));
    }),
  ),
  defineRoute(ProductActionIds.REANCHOR_DRAFT_COMMENT, (call) =>
    answerParsed(call, draftAnchorSchema, (anchor) => {
      const draftId = readParam(call, "draftId");
      return answerFound(call.store.reanchorDraft(call.span, draftId, anchor));
    }),
  ),
  defineRoute(ProductActionIds.DELETE_DRAFT_COMMENT, (call) => {
    const draftId = readParam(call, "draftId");
    return answerFound(call.store.deleteDraft(call.span, draftId));
  }),
  defineRoute(ProductActionIds.MARK_CHUNK_READ, (call) => {
    call.store.setChunkRead(call.span, readParam(call, "chunkId"), true);
    return answerEmpty();
  }),
  defineRoute(ProductActionIds.MARK_CHUNK_UNREAD, (call) => {
    call.store.setChunkRead(call.span, readParam(call, "chunkId"), false);
    return answerEmpty();
  }),
  defineRoute(ProductActionIds.RECLASSIFY_GROUP, (call) =>
    answerParsed(call, reclassifySchema, ({ category }) => {
      const groupId = readParam(call, "groupId");
      call.store.reclassifyGroup(call.span, groupId, category);
      return answerEmpty();
    }),
  ),
  defineRoute(ProductActionIds.DISMISS_RISK, (call) =>
    answerParsed(call, dismissRisksSchema, ({ flags, reason }) =>
      answerJson({ count: call.store.dismissRisks(call.span, flags, reason) }),
    ),
  ),
  defineRoute(ProductActionIds.ADDRESS_RISK, (call) =>
    answerParsed(call, addressRisksSchema, ({ flags }) =>
      answerJson({ count: call.store.addressRisks(call.span, flags) }),
    ),
  ),
  defineRoute(ProductActionIds.REOPEN_RISK, (call) =>
    answerParsed(call, reopenRisksSchema, ({ flags }) =>
      answerJson({ count: call.store.reopenRisks(call.span, flags) }),
    ),
  ),
  defineRoute(ProductActionIds.SET_REVIEW_OUTCOME, (call) =>
    answerParsed(call, setOutcomeSchema, ({ outcome }) =>
      answerJson({ outcome: call.store.setOutcome(call.span, outcome) }),
    ),
  ),
];

function readSpan(query: URLSearchParams): DemoSessionSpan | undefined {
  const base = query.get("base");
  const head = query.get("head");
  if (base === null || head === null) {
    return undefined;
  }
  return { base, head };
}

/** The session's answer to this request, or undefined when no session route matches it. */
export function answerSessionRequest(
  store: DemoSessionStore,
  method: string,
  url: URL,
  body: unknown,
): Response | undefined {
  for (const route of SESSION_ROUTES) {
    const match = route.pattern.exec(url.pathname);
    if (route.method !== method || match === null) {
      continue;
    }
    const span = readSpan(url.searchParams);
    if (span === undefined) {
      return answerRefusal(ApiErrorCodes.INVALID_REQUEST);
    }
    return route.answer({ store, span, params: match.groups ?? {}, body });
  }
  return undefined;
}
