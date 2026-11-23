import {
  ApiErrorCodes,
  buildOperationPath,
  DIFF_MODE_HEADER,
  DiffModes,
  ProductQueryIds,
  type DiffMode,
} from "contract";
import { HttpMethods } from "types";

import { parseFileDiffPatches } from "@web/features/brief/model";
import { revisionNarrativeText, revisionSpanMarksText } from "./briefs";
import { DEMO_BASE_SHA, DEMO_REV1_HEAD, DEMO_REV2_HEAD } from "./briefs/consts";
import {
  AUTH_LOGOUT_PATH,
  AUTH_SESSION_PATH,
  DEMO_HELD_BEHIND_PR_NUMBER,
  DEMO_HELD_PR_NUMBER,
  DEMO_PR,
  VERSION_PATH,
} from "./consts";
import {
  briefContextText,
  briefTextByHead,
  buildSpendAnswer,
  conversationAnswer,
  emptyConversationAnswer,
  heldBehindPullMetaAnswer,
  heldPullMetaAnswer,
  inboxAnswer,
  mentionTargetsAnswer,
  pullMetaAnswer,
  sessionAnswer,
  spanDiffs,
  stackAnswer,
  tokensAnswer,
  versionAnswer,
} from "./fixtures";
import { answerSessionRequest } from "./session/answers";
import type { DemoSessionStore } from "./session";
import type { DemoPull, DemoRead, PullReadId } from "./types";
import {
  answerEmpty,
  answerJson,
  answerRefusal,
  answerStoredJson,
  answerText,
  matchesQuery,
} from "./utils";

const REPO_PARAMS = { repoId: DEMO_PR.repoId };
const PATCH_SEPARATOR = "\n";

/** Every pull request the demo answers for; the held ones reuse the first revision's stored brief. */
const DEMO_PULLS: readonly DemoPull[] = [
  {
    prNumber: DEMO_PR.prNumber,
    meta: pullMetaAnswer,
    conversation: conversationAnswer,
  },
  {
    prNumber: DEMO_HELD_PR_NUMBER,
    meta: heldPullMetaAnswer,
    conversation: emptyConversationAnswer,
  },
  {
    prNumber: DEMO_HELD_BEHIND_PR_NUMBER,
    meta: heldBehindPullMetaAnswer,
    conversation: emptyConversationAnswer,
  },
];

function buildPullPath(id: PullReadId, prNumber: number): string {
  return buildOperationPath(id, { repoId: DEMO_PR.repoId, prNumber });
}

/** The stored brief for an exact `(base, head)` span, as the API looks it up. */
function answerBrief(query: URLSearchParams): Response {
  const head = query.get("head");
  const text = head === null ? undefined : briefTextByHead[head];
  const base = query.get("base");
  const unknownSpan = text === undefined || base !== DEMO_BASE_SHA;
  if (unknownSpan) {
    return answerRefusal(ApiErrorCodes.NOT_FOUND);
  }
  return answerStoredJson(text);
}

/** A diff answer naming the read that served or refused it. */
function nameDiffMode(response: Response, mode: DiffMode): Response {
  response.headers.set(DIFF_MODE_HEADER, mode);
  return response;
}

/** The span diff for an exact `(base, head)` pair, its sidecar's patches joined; an unmarked pair is the server's compare. */
function answerDiff(query: URLSearchParams): Response {
  const span = spanDiffs.find(({ base, head }) =>
    matchesQuery(query, { base, head }),
  );
  if (span === undefined) {
    const refusal = answerRefusal(ApiErrorCodes.NOT_FOUND);
    return nameDiffMode(refusal, DiffModes.COMPARE);
  }

  const patches = parseFileDiffPatches(JSON.parse(span.text));
  if (!patches.ok) {
    const refusal = answerRefusal(ApiErrorCodes.ARTIFACT_UNREADABLE);
    return nameDiffMode(refusal, span.mode);
  }
  const joined = patches.value.map((entry) => entry.patch);
  return nameDiffMode(answerText(joined.join(PATCH_SEPARATOR)), span.mode);
}

function answerMarks(query: URLSearchParams): Response {
  const span = { baseline: DEMO_REV1_HEAD, head: DEMO_REV2_HEAD };
  if (!matchesQuery(query, span)) {
    return answerRefusal(ApiErrorCodes.NOT_FOUND);
  }
  return answerStoredJson(revisionSpanMarksText);
}

function answerNarrative(query: URLSearchParams): Response {
  const span = { prevHead: DEMO_REV1_HEAD, head: DEMO_REV2_HEAD };
  if (!matchesQuery(query, span)) {
    return answerRefusal(ApiErrorCodes.NOT_FOUND);
  }
  return answerStoredJson(revisionNarrativeText);
}

const APP_READS: readonly DemoRead[] = [
  { path: AUTH_SESSION_PATH, answer: () => answerJson(sessionAnswer) },
  { path: VERSION_PATH, answer: () => answerJson(versionAnswer) },
  {
    path: buildOperationPath(ProductQueryIds.LIST_INBOX, {}),
    answer: () => answerJson(inboxAnswer),
  },
  {
    path: buildOperationPath(ProductQueryIds.LIST_TOKENS, {}),
    answer: () => answerJson(tokensAnswer),
  },
  {
    path: buildOperationPath(ProductQueryIds.READ_SPEND, {}),
    answer: () => answerJson(buildSpendAnswer(new Date())),
  },
  {
    path: buildOperationPath(
      ProductQueryIds.RESOLVE_MENTION_TARGETS,
      REPO_PARAMS,
    ),
    answer: () => answerJson(mentionTargetsAnswer),
  },
];

/** One pull request's reads; the stored artifacts answer by span, whichever pull request asks. */
function buildPullReads({
  prNumber,
  meta,
  conversation,
}: DemoPull): DemoRead[] {
  return [
    {
      path: buildPullPath(ProductQueryIds.READ_PULL, prNumber),
      answer: () => answerJson(meta),
    },
    {
      path: buildPullPath(ProductQueryIds.READ_STACK, prNumber),
      answer: () => answerJson(stackAnswer),
    },
    {
      path: buildPullPath(ProductQueryIds.READ_CONVERSATION, prNumber),
      answer: () => answerJson(conversation),
    },
    {
      path: buildPullPath(ProductQueryIds.READ_BRIEF_CONTEXT, prNumber),
      answer: () => answerStoredJson(briefContextText),
    },
    {
      path: buildPullPath(ProductQueryIds.READ_BRIEF, prNumber),
      answer: answerBrief,
    },
    // The fixture stores no counts, so every card sizes from its estimate.
    {
      path: buildPullPath(ProductQueryIds.READ_BRIEF_LAYOUT, prNumber),
      answer: () => answerJson({ layout: null }),
    },
    {
      path: buildPullPath(ProductQueryIds.READ_DIFF, prNumber),
      answer: answerDiff,
    },
    {
      path: buildPullPath(ProductQueryIds.READ_MARKS, prNumber),
      answer: answerMarks,
    },
    {
      path: buildPullPath(ProductQueryIds.READ_NARRATIVE, prNumber),
      answer: answerNarrative,
    },
    // No file contents travel with the fixture: every hunk edge stays folded.
    {
      path: buildPullPath(ProductQueryIds.READ_FILE_RANGE, prNumber),
      answer: () => answerRefusal(ApiErrorCodes.FILE_NOT_FOUND),
    },
  ];
}

const READS: readonly DemoRead[] = [
  ...APP_READS,
  ...DEMO_PULLS.flatMap(buildPullReads),
];

const readsByPath = new Map(READS.map((read) => [read.path, read]));

function answerRead(url: URL): Response {
  const read = readsByPath.get(url.pathname);
  if (read === undefined) {
    console.warn("demo api: no fixture answer for", url.pathname);
    return answerRefusal(ApiErrorCodes.NOT_FOUND);
  }
  return read.answer(url.searchParams);
}

/** Sign out has no session to end and succeeds; every write outside the review session is refused. */
function answerWrite(method: string, url: URL): Response {
  const logout =
    method === HttpMethods.POST && url.pathname === AUTH_LOGOUT_PATH;
  if (logout) {
    return answerEmpty();
  }
  return answerRefusal(ApiErrorCodes.FORBIDDEN);
}

/** What one `/api/*` request carries to the demo. */
export interface DemoRequest {
  readonly method: string;
  readonly url: URL;
  readonly body?: unknown;
}

/** What the demo answers for one `/api/*` request; the review session lives in `store`, the rest is the fixtures. */
export function answerDemoRequest(
  request: DemoRequest,
  store: DemoSessionStore,
): Response {
  const { method, url } = request;
  const session = answerSessionRequest(store, method, url, request.body);
  if (session !== undefined) {
    return session;
  }
  if (method === HttpMethods.GET) {
    return answerRead(url);
  }
  return answerWrite(method, url);
}
