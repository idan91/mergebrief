// The demo's answers, shaped by the contract types so a wire change fails the
// build here before it fails the screen. Artifact bodies ride verbatim from
// the committed fixture files; everything else is the projection the API
// would derive from them.
import {
  type AuthSessionResponse,
  type ConversationResponse,
  DiffModes,
  type GenerationSummaryView,
  type InboxItem,
  InboxQueryBounds,
  type InboxResponse,
  type ListTokensResponse,
  type MentionTargetsResponse,
  type PullMetaView,
  type PullStackView,
  type RevisionView,
  type SpendView,
  type VersionResponse,
} from "contract";
import {
  BotStates,
  BotVerdicts,
  GenerationStatuses,
  InboxReviewStates,
  PrStates,
  PullRequestSources,
  ReviewBots,
  ReviewCommentSides,
  ReviewVerdictStates,
  SizeBoundSides,
  SizeMeasures,
  ThreadSubjectTypes,
  TriggerConditionKinds,
  TriggerConditionSetters,
  UnmetConditionKinds,
} from "types";

import { parseBrief } from "@web/features/brief/model";
import {
  briefRev1Text,
  briefRev2Text,
  diffsRev1Text,
  diffsRev2Text,
  revisionSpanDiffsText,
} from "./briefs";
import { DEMO_BASE_SHA, DEMO_REV1_HEAD, DEMO_REV2_HEAD } from "./briefs/consts";
import {
  DEMO_HELD_BEHIND_PR_NUMBER,
  DEMO_HELD_PR_NUMBER,
  DEMO_PR,
  DEMO_REVIEWER_LOGIN,
  DEMO_VERSION,
  DEMO_VIEWER_LOGIN,
} from "./consts";
import demoAvatarUrl from "./demo-avatar.svg?url";
import type { DemoSpanDiff } from "./types";

const REV1_GENERATED_AT = "2026-10-19T09:10:00.000Z";
const REV1_CREATED_AT = "2026-10-19T09:12:00.000Z";
const REV2_GENERATED_AT = "2026-10-20T14:01:00.000Z";
const REV2_CREATED_AT = "2026-10-20T14:03:00.000Z";
const THREAD_OPENED_AT = "2026-10-19T11:40:00.000Z";
const THREAD_REPLIED_AT = "2026-10-20T13:52:00.000Z";
const REVIEW_SUBMITTED_AT = "2026-10-19T11:45:00.000Z";

const PR_URL = `https://github.com/${DEMO_PR.repoSlug}/pull/${String(DEMO_PR.prNumber)}`;
const SESSIONS_DIR = "apps/api/src/routes/auth/sessions";
const HANDLER_FILE = `${SESSIONS_DIR}/handler.ts`;
const SESSIONS_TEST_FILE = "apps/api/test/sessions.test.ts";
const ACCOUNT_MENU_DIR = "apps/web/src/features/account/components/AccountMenu";
const MENU_FILE = `${ACCOUNT_MENU_DIR}/AccountMenu.tsx`;
const FACADE_FILE = `${ACCOUNT_MENU_DIR}/useAccountMenuFacade.ts`;
const REVIEWER_REVIEW_ID = 77001;
const DOUBLE_CLICK_THREAD_ID = 1001;
const DOUBLE_CLICK_THREAD_LINE = 52;
const DOUBLE_CLICK_REPLY_ID = 1002;
const COMMENT_THREAD_ID = 880001;
const COMMENT_REPLY_ID = 880011;
const BOT_REVIEW_ID = 77002;
const BOT_AUDIT_THREAD_ID = 1101;
const BOT_AUDIT_THREAD_LINE = 23;
const BOT_GLYPH_THREAD_ID = 1102;
const BOT_GLYPH_THREAD_LINE = 149;
const BOT_HELPER_THREAD_ID = 1103;
const BOT_HELPER_THREAD_LINE = 35;
const BOT_HELPER_REPLY_ID = 1203;
const BOT_TOKEN_THREAD_ID = 1104;
const BOT_TOKEN_THREAD_LINE = 151;
const BOT_TOKEN_REPLY_ID = 1204;
const BOT_REVIEWED_AT = "2026-10-20T14:20:00.000Z";
const BOT_REPLIED_AT = "2026-10-20T15:05:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;
const HELD_PUSHED_AT = "2026-10-21T08:30:00.000Z";
const HELD_HEAD = "3f9c2ab7e41d0c58b6a9f2e7d3c1b0a4958e6f21";
const HELD_BEHIND_HEAD = "77d1c0e5a2b94f3e8d6c1a0b9f7e2d4c3b5a6e81";
const HELD_SIZE_LIMIT = 500;
const HELD_SIZE_ACTUAL = 1284;

/** The title as the brief records it, so the page header and the brief never part. */
function readPullTitle(briefText: string): string {
  const brief = parseBrief(briefText);
  if (!brief.ok) {
    throw new Error(brief.error);
  }
  return brief.value.pr.title;
}

const pullTitle = readPullTitle(briefRev2Text);

const viewer: AuthSessionResponse["viewer"] = {
  login: DEMO_VIEWER_LOGIN,
  avatarUrl: demoAvatarUrl,
};

export const sessionAnswer: AuthSessionResponse = { viewer, operator: false };

export const versionAnswer: VersionResponse = { version: DEMO_VERSION };

const generation: GenerationSummaryView = {
  status: GenerationStatuses.SUCCEEDED,
  phase: null,
  attempts: 1,
  errorCode: null,
  errorParams: null,
  updatedAt: REV2_CREATED_AT,
};

const firstRevision: RevisionView = {
  headSha: DEMO_REV1_HEAD,
  baseSha: DEMO_BASE_SHA,
  headIndex: 1,
  createdAt: REV1_CREATED_AT,
  generatedAt: REV1_GENERATED_AT,
  comparisons: {},
};

const latestRevision: RevisionView = {
  headSha: DEMO_REV2_HEAD,
  baseSha: DEMO_BASE_SHA,
  headIndex: 2,
  createdAt: REV2_CREATED_AT,
  generatedAt: REV2_GENERATED_AT,
  comparisons: {
    previousBrief: {
      baselineSha: DEMO_REV1_HEAD,
      baselineIndex: 1,
      narrativeAvailable: true,
    },
  },
};

/** The viewer can push nothing and resolve nothing: the affordances stay off. */
export const pullMetaAnswer: PullMetaView = {
  repoId: DEMO_PR.repoId,
  repoSlug: DEMO_PR.repoSlug,
  prNumber: DEMO_PR.prNumber,
  title: pullTitle,
  state: PrStates.OPEN,
  baseSha: DEMO_BASE_SHA,
  headSha: DEMO_REV2_HEAD,
  briefAvailable: true,
  headBriefStored: true,
  draft: false,
  authorLogin: DEMO_PR.authorLogin,
  viewerIsAuthor: false,
  viewerCanResolve: false,
  viewerCanPush: false,
  generation,
  updatedAt: REV2_CREATED_AT,
  behind: false,
  comparisons: latestRevision.comparisons,
  appInstalled: true,
  draftPolicy: { debounceSeconds: null },
  revisions: [firstRevision, latestRevision],
};

/** Held behind a draft flag, running CI, and an `any` group none of whose members passed. */
const heldGeneration: GenerationSummaryView = {
  status: GenerationStatuses.HELD,
  phase: null,
  attempts: 0,
  errorCode: null,
  errorParams: null,
  updatedAt: HELD_PUSHED_AT,
  unmetConditions: [
    {
      kind: TriggerConditionKinds.READY_FOR_REVIEW,
      setBy: TriggerConditionSetters.INSTANCE,
    },
    {
      kind: TriggerConditionKinds.CI,
      setBy: TriggerConditionSetters.REPO,
      failed: [],
      running: ["typecheck", "unit"],
      missing: [],
      permissionMissing: false,
    },
    {
      kind: UnmetConditionKinds.ANY,
      conditions: [
        {
          kind: TriggerConditionKinds.BOTS,
          setBy: TriggerConditionSetters.REPO,
          bot: ReviewBots.CODERABBIT,
          verdict: BotVerdicts.APPROVED,
          state: BotStates.NOT_APPROVED,
        },
        {
          kind: TriggerConditionKinds.SIZE,
          setBy: TriggerConditionSetters.REPO,
          measure: SizeMeasures.CHANGED_LINES,
          side: SizeBoundSides.MAX,
          limit: HELD_SIZE_LIMIT,
          actual: HELD_SIZE_ACTUAL,
        },
      ],
    },
  ],
};

const HELD_TITLE = "Read trigger conditions from the instance config";

/** A draft whose newest push trigger conditions hold; no brief is stored for it. */
export const heldPullMetaAnswer: PullMetaView = {
  repoId: DEMO_PR.repoId,
  repoSlug: DEMO_PR.repoSlug,
  prNumber: DEMO_HELD_PR_NUMBER,
  title: HELD_TITLE,
  state: PrStates.OPEN,
  baseSha: DEMO_BASE_SHA,
  headSha: HELD_HEAD,
  briefAvailable: false,
  headBriefStored: false,
  draft: true,
  authorLogin: DEMO_PR.authorLogin,
  viewerIsAuthor: false,
  viewerCanResolve: false,
  viewerCanPush: false,
  generation: heldGeneration,
  updatedAt: HELD_PUSHED_AT,
  behind: false,
  comparisons: {},
  appInstalled: true,
  draftPolicy: { debounceSeconds: null },
};

/** The newest push waits for a review bot; the first push's brief stays on screen. */
const heldBehindGeneration: GenerationSummaryView = {
  status: GenerationStatuses.HELD,
  phase: null,
  attempts: 0,
  errorCode: null,
  errorParams: null,
  updatedAt: HELD_PUSHED_AT,
  unmetConditions: [
    {
      kind: TriggerConditionKinds.BOTS,
      setBy: TriggerConditionSetters.REPO,
      bot: ReviewBots.CODERABBIT,
      verdict: BotVerdicts.FINISHED,
      state: BotStates.RUNNING,
    },
    {
      kind: TriggerConditionKinds.LABELS,
      setBy: TriggerConditionSetters.INSTANCE,
      labels: ["needs-brief"],
    },
  ],
};

/** The first revision's brief is the one stored; the push after it is held. */
export const heldBehindPullMetaAnswer: PullMetaView = {
  repoId: DEMO_PR.repoId,
  repoSlug: DEMO_PR.repoSlug,
  prNumber: DEMO_HELD_BEHIND_PR_NUMBER,
  title: readPullTitle(briefRev1Text),
  state: PrStates.OPEN,
  baseSha: DEMO_BASE_SHA,
  headSha: HELD_BEHIND_HEAD,
  briefAvailable: false,
  headBriefStored: false,
  draft: false,
  authorLogin: DEMO_PR.authorLogin,
  viewerIsAuthor: false,
  viewerCanResolve: false,
  viewerCanPush: false,
  generation: heldBehindGeneration,
  updatedAt: HELD_PUSHED_AT,
  behind: false,
  comparisons: firstRevision.comparisons,
  appInstalled: true,
  draftPolicy: { debounceSeconds: null },
  revisions: [firstRevision],
};

/** The held pull requests drew no review threads. */
export const emptyConversationAnswer: ConversationResponse = {
  threads: [],
  reviews: [],
  prComments: [],
  hasMoreThreads: false,
  hasMoreReviews: false,
  hasMorePrComments: false,
};

const inboxItems: readonly InboxItem[] = [
  {
    repoId: DEMO_PR.repoId,
    repoSlug: DEMO_PR.repoSlug,
    prNumber: DEMO_PR.prNumber,
    title: pullTitle,
    state: PrStates.OPEN,
    draft: false,
    source: PullRequestSources.INSTALLATION,
    installationId: DEMO_PR.installationId,
    authorLogin: DEMO_PR.authorLogin,
    viewerIsAuthor: false,
    viewerCanDelete: false,
    viewerCanPush: false,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
    generation,
    latestBriefAt: REV2_CREATED_AT,
    githubUpdatedAt: REV2_CREATED_AT,
    githubCreatedAt: REV1_CREATED_AT,
    stack: null,
  },
  {
    repoId: DEMO_PR.repoId,
    repoSlug: DEMO_PR.repoSlug,
    prNumber: DEMO_HELD_PR_NUMBER,
    title: HELD_TITLE,
    state: PrStates.OPEN,
    draft: true,
    source: PullRequestSources.INSTALLATION,
    installationId: DEMO_PR.installationId,
    authorLogin: DEMO_PR.authorLogin,
    viewerIsAuthor: false,
    viewerCanDelete: false,
    viewerCanPush: false,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
    generation: heldGeneration,
    latestBriefAt: null,
    githubUpdatedAt: HELD_PUSHED_AT,
    githubCreatedAt: HELD_PUSHED_AT,
    stack: null,
  },
];

/** The held view: the inbox narrowed to the rows whose newest head is held. */
const heldItems = inboxItems.filter(
  (item) => item.generation?.status === GenerationStatuses.HELD,
);

export const inboxAnswer: InboxResponse = {
  items: inboxItems,
  page: 1,
  pageSize: InboxQueryBounds.PAGE_SIZE,
  total: 2,
  archivedTotal: 0,
  searchMatchTotal: 0,
  archivedSearchMatchTotal: 0,
  heldTotal: heldItems.length,
  counts: { new: 2, inProgress: 0, reviewed: 0, updated: 0 },
  viewer,
  reachableInstallations: [
    {
      installationId: DEMO_PR.installationId,
      accountLogin: DEMO_PR.installationAccount,
    },
  ],
  repositories: [{ repoId: DEMO_PR.repoId, repoSlug: DEMO_PR.repoSlug }],
  installUrl: null,
};

export const heldInboxAnswer: InboxResponse = {
  ...inboxAnswer,
  items: heldItems,
  total: heldItems.length,
};

const reviewer = { login: DEMO_REVIEWER_LOGIN, isBot: false };
const author = { login: DEMO_PR.authorLogin, isBot: false };
/** A made-up reviewer bot: the demo shows the shape of an automated review, never a real product's words. */
const botReviewer = { login: "review-bot[bot]", isBot: true };

const botThreads: ConversationResponse["threads"] = [
  {
    rootCommentId: BOT_AUDIT_THREAD_ID,
    path: HANDLER_FILE,
    line: BOT_AUDIT_THREAD_LINE,
    side: ReviewCommentSides.RIGHT,
    subjectType: ThreadSubjectTypes.LINE,
    isResolved: false,
    isOutdated: false,
    anchorSha: DEMO_REV2_HEAD,
    comments: [
      {
        commentId: BOT_AUDIT_THREAD_ID,
        author: botReviewer,
        body: "**Potential issue:** the audit target is stamped after `revokeAll` resolves. If the delete throws, the handler leaves before this line, and the audit row for the attempt names no reviewer.\n\n**Why this matters here:** a failed revoke is the attempt an operator most wants to trace back to an account.",
        createdAt: BOT_REVIEWED_AT,
        url: `${PR_URL}#discussion_r${String(BOT_AUDIT_THREAD_ID)}`,
        reviewId: BOT_REVIEW_ID,
      },
    ],
    hasMoreComments: false,
  },
  {
    rootCommentId: BOT_GLYPH_THREAD_ID,
    path: MENU_FILE,
    line: BOT_GLYPH_THREAD_LINE,
    side: ReviewCommentSides.RIGHT,
    subjectType: ThreadSubjectTypes.LINE,
    isResolved: false,
    isOutdated: false,
    anchorSha: DEMO_REV2_HEAD,
    comments: [
      {
        commentId: BOT_GLYPH_THREAD_ID,
        author: botReviewer,
        body: "**Nitpick:** this row reuses `IconNames.SIGN_OUT`, the glyph of the Sign out row above it. Two rows with one icon are told apart by their text alone.",
        createdAt: BOT_REVIEWED_AT,
        url: `${PR_URL}#discussion_r${String(BOT_GLYPH_THREAD_ID)}`,
        reviewId: BOT_REVIEW_ID,
      },
    ],
    hasMoreComments: false,
  },
  {
    rootCommentId: BOT_HELPER_THREAD_ID,
    path: FACADE_FILE,
    line: BOT_HELPER_THREAD_LINE,
    side: ReviewCommentSides.RIGHT,
    subjectType: ThreadSubjectTypes.LINE,
    isResolved: true,
    isOutdated: false,
    anchorSha: DEMO_REV2_HEAD,
    comments: [
      {
        commentId: BOT_HELPER_THREAD_ID,
        author: botReviewer,
        body: "**Refactor suggestion:** `deleteSessions` and `postLogout` differ only in path and method. One helper taking both would remove the repeat.",
        createdAt: BOT_REVIEWED_AT,
        url: `${PR_URL}#discussion_r${String(BOT_HELPER_THREAD_ID)}`,
        reviewId: BOT_REVIEW_ID,
      },
      {
        commentId: BOT_HELPER_REPLY_ID,
        author: author,
        body: "They stay two: each reads as one named operation, and `runSignOut` already holds what they share.",
        createdAt: BOT_REPLIED_AT,
        url: `${PR_URL}#discussion_r${String(BOT_HELPER_REPLY_ID)}`,
      },
    ],
    hasMoreComments: false,
  },
  {
    rootCommentId: BOT_TOKEN_THREAD_ID,
    path: SESSIONS_TEST_FILE,
    line: BOT_TOKEN_THREAD_LINE,
    side: ReviewCommentSides.RIGHT,
    subjectType: ThreadSubjectTypes.LINE,
    isResolved: true,
    isOutdated: false,
    anchorSha: DEMO_REV2_HEAD,
    comments: [
      {
        commentId: BOT_TOKEN_THREAD_ID,
        author: botReviewer,
        body: "**Test coverage:** check that a revoke leaves an API token minted from one of the sessions working, since the changelog promises it.",
        createdAt: BOT_REVIEWED_AT,
        url: `${PR_URL}#discussion_r${String(BOT_TOKEN_THREAD_ID)}`,
        reviewId: BOT_REVIEW_ID,
      },
      {
        commentId: BOT_TOKEN_REPLY_ID,
        author: author,
        body: "Covered here: this test reads with the Bearer token after the revoke.",
        createdAt: BOT_REPLIED_AT,
        url: `${PR_URL}#discussion_r${String(BOT_TOKEN_REPLY_ID)}`,
      },
    ],
    hasMoreComments: false,
  },
];

/** Written for the demo: the pull request itself drew no review threads. */
export const conversationAnswer: ConversationResponse = {
  threads: [
    {
      rootCommentId: DOUBLE_CLICK_THREAD_ID,
      path: FACADE_FILE,
      line: DOUBLE_CLICK_THREAD_LINE,
      side: ReviewCommentSides.RIGHT,
      subjectType: ThreadSubjectTypes.LINE,
      isResolved: false,
      isOutdated: false,
      anchorSha: DEMO_REV2_HEAD,
      comments: [
        {
          commentId: DOUBLE_CLICK_THREAD_ID,
          author: reviewer,
          body: "Two fast clicks can send two requests before the row disables. Is the second one harmless?",
          createdAt: BOT_REVIEWED_AT,
          url: `${PR_URL}#discussion_r${String(DOUBLE_CLICK_THREAD_ID)}`,
        },
        {
          commentId: DOUBLE_CLICK_REPLY_ID,
          author: author,
          body: "Yes. Each ends only the caller's own sessions, so the second has none left to end, and by then the first has left for Home.",
          createdAt: BOT_REPLIED_AT,
          url: `${PR_URL}#discussion_r${String(DOUBLE_CLICK_REPLY_ID)}`,
        },
      ],
      hasMoreComments: false,
    },
    {
      rootCommentId: COMMENT_THREAD_ID,
      path: HANDLER_FILE,
      side: ReviewCommentSides.RIGHT,
      subjectType: ThreadSubjectTypes.LINE,
      isResolved: true,
      isOutdated: true,
      anchorSha: DEMO_REV1_HEAD,
      comments: [
        {
          commentId: COMMENT_THREAD_ID,
          author: reviewer,
          body: "This comment restates the `deleteCookie` call under it.",
          createdAt: THREAD_OPENED_AT,
          url: `${PR_URL}#discussion_r${String(COMMENT_THREAD_ID)}`,
          reviewId: REVIEWER_REVIEW_ID,
        },
        {
          commentId: COMMENT_REPLY_ID,
          author: author,
          body: "Dropped in the second push.",
          createdAt: THREAD_REPLIED_AT,
          url: `${PR_URL}#discussion_r${String(COMMENT_REPLY_ID)}`,
        },
      ],
      hasMoreComments: false,
    },
    ...botThreads,
  ],
  reviews: [
    {
      reviewId: REVIEWER_REVIEW_ID,
      author: reviewer,
      state: ReviewVerdictStates.COMMENTED,
      body: "One note on a comment in the handler; the endpoint reads right.",
      submittedAt: REVIEW_SUBMITTED_AT,
      url: `${PR_URL}#pullrequestreview-${String(REVIEWER_REVIEW_ID)}`,
    },
    {
      reviewId: BOT_REVIEW_ID,
      author: botReviewer,
      state: ReviewVerdictStates.COMMENTED,
      body: 'Walkthrough: this pull request adds `DELETE /api/auth/sessions`, which ends every session of the signed-in reviewer, and a "Sign out everywhere" row in the Account menu that calls it. 4 comments: 1 potential issue, 1 nitpick, 1 refactor suggestion, 1 test coverage check.',
      submittedAt: BOT_REVIEWED_AT,
      url: `${PR_URL}#pullrequestreview-${String(BOT_REVIEW_ID)}`,
    },
  ],
  prComments: [],
  hasMoreThreads: false,
  hasMoreReviews: false,
  hasMorePrComments: false,
};

export const stackAnswer: PullStackView = { stack: null };

export const mentionTargetsAnswer: MentionTargetsResponse = {
  users: [],
  teams: [],
};

export const tokensAnswer: ListTokensResponse = { tokens: [] };

/** Nothing started today; the day boundaries are the real UTC ones. */
export function buildSpendAnswer(now: Date): SpendView {
  const dayStartedAt = new Date(now);
  dayStartedAt.setUTCHours(0, 0, 0, 0);
  const resetsAt = new Date(dayStartedAt.getTime() + DAY_MS);
  return {
    startedRuns: 0,
    dayStartedAt: dayStartedAt.toISOString(),
    resetsAt: resetsAt.toISOString(),
  };
}

/** The stored brief body per span, keyed by the head it was generated for. */
export const briefTextByHead: Readonly<Record<string, string>> = {
  [DEMO_REV1_HEAD]: briefRev1Text,
  [DEMO_REV2_HEAD]: briefRev2Text,
};

/**
 * Every span the screen compares: each revision's full span as a compare,
 * and the previous-brief revision span, which holds only the files that
 * differ between the two heads. The second head fast-forwards the first on
 * one merge base, so that span is GitHub's compare between the heads.
 */
export const spanDiffs: readonly DemoSpanDiff[] = [
  {
    base: DEMO_BASE_SHA,
    head: DEMO_REV1_HEAD,
    mode: DiffModes.COMPARE,
    text: diffsRev1Text,
  },
  {
    base: DEMO_BASE_SHA,
    head: DEMO_REV2_HEAD,
    mode: DiffModes.COMPARE,
    text: diffsRev2Text,
  },
  {
    base: DEMO_REV1_HEAD,
    head: DEMO_REV2_HEAD,
    mode: DiffModes.REVISION_SPAN,
    text: revisionSpanDiffsText,
  },
];

/** `{"repoConfig":null}`: the envelope the API composes for a row without one. */
export const briefContextText = JSON.stringify({ repoConfig: null });
