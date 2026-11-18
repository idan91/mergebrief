// Every fixture answer goes through the reader the production screen parses
// it with: a shape the live API would fail is a shape the demo fails too.
import { splitUnifiedDiffByFile } from "brief-core/chunk-layout";
import {
  ApiErrorCodes,
  buildOperationPath,
  DIFF_MODE_HEADER,
  DiffModes,
  parseApiErrorBody,
  ProductActionIds,
  ProductQueryIds,
} from "contract";
import { HttpMethods, HttpStatuses } from "types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseViewer } from "@web/features/account/schemas";
import { ViewerStates } from "@web/features/account/types";
import {
  briefContextSchema,
  parseBrief,
  parseComparisonMarks,
  parseRevisionNarrativeArtifact,
} from "@web/features/brief/model";
import {
  mentionTargetsResponseSchema,
  prConversationSchema,
} from "@web/features/conversation/schemas";
import { inboxResponseSchema } from "@web/features/inbox/schemas";
import { prSummarySchema, pullStackSchema } from "@web/features/pulls/schemas";
import { spendViewSchema } from "@web/features/settings/schemas";
import { tokensViewSchema } from "@web/features/tokens/schemas";
import { parseVersion } from "@web/features/version/schemas";
import { answerDemoRequest } from "./answers";
import { DEMO_BASE_SHA, DEMO_REV1_HEAD, DEMO_REV2_HEAD } from "./briefs/consts";
import { DEMO_PR, DEMO_VIEWER_LOGIN } from "./consts";
import type { PullReadId } from "./types";

const ORIGIN = "http://demo.local";
const REV2_SPAN = `base=${DEMO_BASE_SHA}&head=${DEMO_REV2_HEAD}`;
const REV1_SPAN = `base=${DEMO_BASE_SHA}&head=${DEMO_REV1_HEAD}`;
const PREVIOUS_BRIEF_SPAN = `base=${DEMO_REV1_HEAD}&head=${DEMO_REV2_HEAD}`;
const HANDLER_FILE = "apps/api/src/routes/auth/sessions/handler.ts";
const CONTROLLER_FILE = "apps/api/src/routes/auth/sessions/controller.ts";
const MENU_FILE =
  "apps/web/src/features/account/components/AccountMenu/AccountMenu.tsx";
const ENDPOINT_GROUP_TITLE = "Add DELETE /api/auth/sessions revoke-all action";
const MENU_GROUP_TITLE = "Add Sign out everywhere row to the Account menu";
const REV1_FILE_COUNT = 13;
const REV2_FILE_COUNT = 18;

function readGet(path: string): Response {
  return answerDemoRequest(HttpMethods.GET, new URL(path, ORIGIN));
}

function readPullOperation(id: PullReadId, query = ""): Response {
  const path = buildOperationPath(id, {
    repoId: DEMO_PR.repoId,
    prNumber: DEMO_PR.prNumber,
  });
  return readGet(query === "" ? path : `${path}?${query}`);
}

async function readDiffFiles(
  span: string,
): Promise<ReadonlyMap<string, string>> {
  const response = readPullOperation(ProductQueryIds.READ_DIFF, span);
  expect(response.status).toBe(HttpStatuses.OK);
  return splitUnifiedDiffByFile(await response.text());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("answerDemoRequest reads", () => {
  it("signs the demo viewer in", async () => {
    const response = readGet("/api/auth/session");

    expect(response.status).toBe(HttpStatuses.OK);
    expect(parseViewer(await response.json())).toMatchObject({
      kind: ViewerStates.SIGNED_IN,
      login: DEMO_VIEWER_LOGIN,
      operator: false,
    });
  });

  it("reports a version with nothing newer to notice", async () => {
    const parsed = parseVersion(await readGet("/api/version").json());

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.latest).toBeUndefined();
  });

  it("lists the demo pull request as the one inbox row", async () => {
    const response = readGet("/api/inbox?state=open&page=1");
    const inbox = inboxResponseSchema.parse(await response.json());

    expect(inbox.items.map((item) => item.prNumber)).toEqual([
      DEMO_PR.prNumber,
    ]);
    expect(inbox.viewer.login).toBe(DEMO_VIEWER_LOGIN);
  });

  it("describes two revisions with a previous-brief comparison", async () => {
    const body: unknown = await readPullOperation(
      ProductQueryIds.READ_PULL,
    ).json();
    const meta = prSummarySchema.parse(body);

    expect(meta.revisions?.map((revision) => revision.headSha)).toEqual([
      DEMO_REV1_HEAD,
      DEMO_REV2_HEAD,
    ]);
    expect(meta.headSha).toBe(DEMO_REV2_HEAD);
    expect(meta.comparisons?.previousBrief).toMatchObject({
      kind: "available",
      narrativeAvailable: true,
    });
    expect(meta.viewerCanPush).toBe(false);
    expect(meta.viewerCanResolve).toBe(false);
  });

  it("serves each revision's brief for its exact span", async () => {
    const latest = readPullOperation(ProductQueryIds.READ_BRIEF, REV2_SPAN);
    const earlier = readPullOperation(ProductQueryIds.READ_BRIEF, REV1_SPAN);
    const unknown = readPullOperation(
      ProductQueryIds.READ_BRIEF,
      `base=${DEMO_BASE_SHA}&head=deadbeef`,
    );

    const parsedLatest = parseBrief(await latest.text());
    const parsedEarlier = parseBrief(await earlier.text());
    expect(parsedLatest.ok).toBe(true);
    expect(
      parsedLatest.ok &&
        parsedLatest.value.changeGroups.map((group) => group.title),
    ).toEqual([ENDPOINT_GROUP_TITLE, MENU_GROUP_TITLE]);
    expect(
      parsedEarlier.ok &&
        parsedEarlier.value.changeGroups.map((group) => group.title),
    ).toEqual([ENDPOINT_GROUP_TITLE]);
    expect(unknown.status).toBe(HttpStatuses.NOT_FOUND);
  });

  it("serves each revision's full span with every file it touches", async () => {
    const earlier = await readDiffFiles(REV1_SPAN);
    const latest = await readDiffFiles(REV2_SPAN);

    expect(earlier.size).toBe(REV1_FILE_COUNT);
    expect(latest.size).toBe(REV2_FILE_COUNT);
    expect(earlier.has(MENU_FILE)).toBe(false);
    expect(latest.has(MENU_FILE)).toBe(true);
  });

  it("serves the previous-brief span without the files it left alone", async () => {
    const earlier = await readDiffFiles(REV1_SPAN);
    const latest = await readDiffFiles(REV2_SPAN);
    const previousBrief = await readDiffFiles(PREVIOUS_BRIEF_SPAN);

    expect(previousBrief.has(CONTROLLER_FILE)).toBe(false);
    expect(previousBrief.get(HANDLER_FILE)).not.toBe(latest.get(HANDLER_FILE));
    expect(previousBrief.get(MENU_FILE)).toBe(latest.get(MENU_FILE));
    expect(earlier.get(CONTROLLER_FILE)).toBe(latest.get(CONTROLLER_FILE));
  });

  it.each([
    { span: REV2_SPAN, mode: DiffModes.COMPARE },
    { span: PREVIOUS_BRIEF_SPAN, mode: DiffModes.REVISION_SPAN },
  ])("names the $mode read it served", ({ span, mode }) => {
    const response = readPullOperation(ProductQueryIds.READ_DIFF, span);

    expect(response.headers.get(DIFF_MODE_HEADER)).toBe(mode);
  });

  it.each([
    {
      name: "reversed",
      span: `base=${DEMO_REV2_HEAD}&head=${DEMO_REV1_HEAD}`,
    },
    { name: "unknown head", span: `base=${DEMO_BASE_SHA}&head=deadbeef` },
    { name: "baseless", span: `head=${DEMO_REV2_HEAD}` },
  ])("refuses the $name diff span as not found", async ({ span }) => {
    const response = readPullOperation(ProductQueryIds.READ_DIFF, span);

    expect(response.status).toBe(HttpStatuses.NOT_FOUND);
    expect(parseApiErrorBody(await response.json())?.code).toBe(
      ApiErrorCodes.NOT_FOUND,
    );
    expect(response.headers.get(DIFF_MODE_HEADER)).toBe(DiffModes.COMPARE);
  });

  it("serves the previous-brief marks and the revision narrative", async () => {
    const marks = readPullOperation(
      ProductQueryIds.READ_MARKS,
      `baseline=${DEMO_REV1_HEAD}&head=${DEMO_REV2_HEAD}`,
    );
    const narrative = readPullOperation(
      ProductQueryIds.READ_NARRATIVE,
      `prevHead=${DEMO_REV1_HEAD}&head=${DEMO_REV2_HEAD}`,
    );

    expect(parseComparisonMarks(await marks.json()).ok).toBe(true);
    expect(parseRevisionNarrativeArtifact(await narrative.text()).ok).toBe(
      true,
    );
  });

  it("answers the layout read with no stored counts", async () => {
    const layout = readPullOperation(ProductQueryIds.READ_BRIEF_LAYOUT);

    expect(layout.status).toBe(HttpStatuses.OK);
    expect(await layout.json()).toEqual({ layout: null });
  });

  it("carries no repo config, no live stack and no mention targets", async () => {
    const context = readPullOperation(ProductQueryIds.READ_BRIEF_CONTEXT);
    const stack = readPullOperation(ProductQueryIds.READ_STACK);
    const targets = readGet(
      `${buildOperationPath(ProductQueryIds.RESOLVE_MENTION_TARGETS, { repoId: DEMO_PR.repoId })}?targets=octocat`,
    );

    expect(briefContextSchema.parse(await context.json())).toBeNull();
    expect(pullStackSchema.parse(await stack.json()).stack).toBeUndefined();
    expect(mentionTargetsResponseSchema.parse(await targets.json())).toEqual({
      users: [],
      teams: [],
    });
  });

  it("serves a conversation with an outdated thread on the first push", async () => {
    const conversation = prConversationSchema.parse(
      await readPullOperation(ProductQueryIds.READ_CONVERSATION).json(),
    );

    expect(conversation.threads.length).toBeGreaterThanOrEqual(2);
    expect(
      conversation.threads.some(
        (thread) => thread.isOutdated && thread.anchorSha === DEMO_REV1_HEAD,
      ),
    ).toBe(true);
    expect(conversation.reviews).toHaveLength(2);
  });

  it("serves a bot reviewer's threads, some open and some resolved", async () => {
    const conversation = prConversationSchema.parse(
      await readPullOperation(ProductQueryIds.READ_CONVERSATION).json(),
    );

    const botThreads = conversation.threads.filter(
      (thread) => thread.comments[0]?.author.isBot === true,
    );
    expect(botThreads.filter((thread) => thread.isResolved)).toHaveLength(2);
    expect(botThreads.filter((thread) => !thread.isResolved)).toHaveLength(2);
    expect(conversation.reviews.some((review) => review.author.isBot)).toBe(
      true,
    );
  });

  it("serves settings reads the demo viewer can open", async () => {
    const tokens = readGet(buildOperationPath(ProductQueryIds.LIST_TOKENS, {}));
    const spend = readGet(buildOperationPath(ProductQueryIds.READ_SPEND, {}));

    expect(tokensViewSchema.parse(await tokens.json()).tokens).toEqual([]);
    expect(spendViewSchema.parse(await spend.json()).startedRuns).toBe(0);
  });

  it("has no review session and no file ranges", async () => {
    const session = readPullOperation(
      ProductQueryIds.READ_REVIEW_SESSION,
      REV2_SPAN,
    );
    const range = readPullOperation(
      ProductQueryIds.READ_FILE_RANGE,
      `ref=${DEMO_REV2_HEAD}&path=README.md&from=1&to=10`,
    );

    expect(session.status).toBe(HttpStatuses.NOT_FOUND);
    expect(parseApiErrorBody(await range.json())?.code).toBe(
      ApiErrorCodes.FILE_NOT_FOUND,
    );
  });

  it("answers an unknown read with not-found and a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = readGet("/api/nothing-here");

    expect(response.status).toBe(HttpStatuses.NOT_FOUND);
    expect(parseApiErrorBody(await response.json())?.code).toBe(
      ApiErrorCodes.NOT_FOUND,
    );
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("answerDemoRequest writes", () => {
  it("refuses every write as forbidden", async () => {
    const draft = answerDemoRequest(
      HttpMethods.POST,
      new URL(
        buildOperationPath(ProductActionIds.CREATE_DRAFT_COMMENT, {
          repoId: DEMO_PR.repoId,
          prNumber: DEMO_PR.prNumber,
        }),
        ORIGIN,
      ),
    );
    const generate = answerDemoRequest(
      HttpMethods.POST,
      new URL(buildOperationPath(ProductActionIds.GENERATE_BRIEF, {}), ORIGIN),
    );

    expect(draft.status).toBe(HttpStatuses.FORBIDDEN);
    expect(parseApiErrorBody(await draft.json())?.code).toBe(
      ApiErrorCodes.FORBIDDEN,
    );
    expect(generate.status).toBe(HttpStatuses.FORBIDDEN);
  });

  it("lets sign out succeed without a session to end", () => {
    const response = answerDemoRequest(
      HttpMethods.POST,
      new URL("/api/auth/logout", ORIGIN),
    );

    expect(response.status).toBe(HttpStatuses.NO_CONTENT);
  });
});
