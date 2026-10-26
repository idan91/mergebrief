// The demo's answers, shaped by the contract types so a wire change fails the
// build here before it fails the screen. Artifact bodies ride verbatim from
// the committed fixture files; everything else is the projection the API
// would derive from them.
import {
  type AuthSessionResponse,
  type ConversationResponse,
  type GenerationSummaryView,
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
  GenerationStatuses,
  InboxReviewStates,
  PrStates,
  PullRequestSources,
  ReviewCommentSides,
  ReviewVerdictStates,
  ThreadSubjectTypes,
} from "types";

import {
  FIXTURE_BASE_SHA,
  FIXTURE_BRIEFED_ANCHOR_THREAD_ID,
  FIXTURE_REV1_HEAD,
  FIXTURE_REV2_HEAD,
} from "../../../e2e/fixtures/ids";
import briefRev1Text from "../../../e2e/fixtures/briefs/mergebrief-e2e-fixture-1_1_11111111.brief.json?raw";
import diffsRev1Text from "../../../e2e/fixtures/briefs/mergebrief-e2e-fixture-1_1_11111111.diffs.json?raw";
import briefRev2Text from "../../../e2e/fixtures/briefs/mergebrief-e2e-fixture-1_2_22222222.brief.json?raw";
import diffsRev2Text from "../../../e2e/fixtures/briefs/mergebrief-e2e-fixture-1_2_22222222.diffs.json?raw";
import {
  DEMO_PR,
  DEMO_VERSION,
  DEMO_VIEWER_LOGIN,
  FIXTURE_REVIEWER_LOGIN,
} from "./consts";
import demoAvatarUrl from "./demo-avatar.svg?url";
import previousBriefSpanDiffsText from "./previous-brief-span-diffs.json?raw";
import type { DemoSpanDiff } from "./types";

const REV1_GENERATED_AT = "2026-10-19T09:10:00.000Z";
const REV1_CREATED_AT = "2026-10-19T09:12:00.000Z";
const REV2_GENERATED_AT = "2026-10-20T14:01:00.000Z";
const REV2_CREATED_AT = "2026-10-20T14:03:00.000Z";
const THREAD_OPENED_AT = "2026-10-19T11:40:00.000Z";
const THREAD_REPLIED_AT = "2026-10-20T13:52:00.000Z";
const REVIEW_SUBMITTED_AT = "2026-10-19T11:45:00.000Z";

const PR_URL = `https://github.com/${DEMO_PR.repoSlug}/pull/${String(DEMO_PR.prNumber)}`;
const BRIEF_PAGE_FILE =
  "apps/web/src/features/brief/components/BriefPage/BriefPage.tsx";
const FIXTURE_COMMENT_ID = 1001;
const FIXTURE_COMMENT_LINE = 120;
const OUTDATED_REPLY_ID = 880011;
const FIXTURE_REVIEW_ID = 77001;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  headSha: FIXTURE_REV1_HEAD,
  baseSha: FIXTURE_BASE_SHA,
  headIndex: 1,
  createdAt: REV1_CREATED_AT,
  generatedAt: REV1_GENERATED_AT,
  comparisons: {},
};

const latestRevision: RevisionView = {
  headSha: FIXTURE_REV2_HEAD,
  baseSha: FIXTURE_BASE_SHA,
  headIndex: 2,
  createdAt: REV2_CREATED_AT,
  generatedAt: REV2_GENERATED_AT,
  comparisons: {
    previousBrief: {
      baselineSha: FIXTURE_REV1_HEAD,
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
  title: DEMO_PR.title,
  state: PrStates.OPEN,
  baseSha: FIXTURE_BASE_SHA,
  headSha: FIXTURE_REV2_HEAD,
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
  draftPolicy: { generate: true, debounceSeconds: null },
  revisions: [firstRevision, latestRevision],
};

export const inboxAnswer: InboxResponse = {
  items: [
    {
      repoId: DEMO_PR.repoId,
      repoSlug: DEMO_PR.repoSlug,
      prNumber: DEMO_PR.prNumber,
      title: DEMO_PR.title,
      state: PrStates.OPEN,
      draft: false,
      source: PullRequestSources.INSTALLATION,
      installationId: DEMO_PR.installationId,
      authorLogin: DEMO_PR.authorLogin,
      viewerIsAuthor: false,
      viewerCanDelete: false,
      reviewState: InboxReviewStates.NEW,
      behind: false,
      unreachable: false,
      generation,
      latestBriefAt: REV2_CREATED_AT,
      githubUpdatedAt: REV2_CREATED_AT,
      stack: null,
    },
  ],
  page: 1,
  pageSize: InboxQueryBounds.PAGE_SIZE,
  total: 1,
  archivedTotal: 0,
  counts: { new: 1, inProgress: 0, reviewed: 0, updated: 0 },
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

const fixtureReviewer = { login: FIXTURE_REVIEWER_LOGIN, isBot: false };
const author = { login: DEMO_PR.authorLogin, isBot: false };

/** Mirrors the committed fixture comment plus the outdated thread the stub serves. */
export const conversationAnswer: ConversationResponse = {
  threads: [
    {
      rootCommentId: FIXTURE_COMMENT_ID,
      path: BRIEF_PAGE_FILE,
      line: FIXTURE_COMMENT_LINE,
      side: ReviewCommentSides.RIGHT,
      subjectType: ThreadSubjectTypes.LINE,
      isResolved: false,
      isOutdated: false,
      anchorSha: FIXTURE_REV2_HEAD,
      comments: [
        {
          commentId: FIXTURE_COMMENT_ID,
          author: fixtureReviewer,
          body: "The scroller hook should cancel its pending RAF on unmount.",
          createdAt: THREAD_REPLIED_AT,
          url: `${PR_URL}#discussion_r${String(FIXTURE_COMMENT_ID)}`,
        },
      ],
      hasMoreComments: false,
    },
    {
      rootCommentId: FIXTURE_BRIEFED_ANCHOR_THREAD_ID,
      path: BRIEF_PAGE_FILE,
      side: ReviewCommentSides.RIGHT,
      subjectType: ThreadSubjectTypes.LINE,
      isResolved: true,
      isOutdated: true,
      anchorSha: FIXTURE_REV1_HEAD,
      comments: [
        {
          commentId: FIXTURE_BRIEFED_ANCHOR_THREAD_ID,
          author: fixtureReviewer,
          body: "`useChunkScroller` leaks its RAF when the brief switches mid-scroll.",
          createdAt: THREAD_OPENED_AT,
          url: `${PR_URL}#discussion_r${String(FIXTURE_BRIEFED_ANCHOR_THREAD_ID)}`,
          reviewId: FIXTURE_REVIEW_ID,
        },
        {
          commentId: OUTDATED_REPLY_ID,
          author,
          body: "Fixed in the second push: the hook tracks its handles and cancels them on unmount.",
          createdAt: THREAD_REPLIED_AT,
          url: `${PR_URL}#discussion_r${String(OUTDATED_REPLY_ID)}`,
        },
      ],
      hasMoreComments: false,
    },
  ],
  reviews: [
    {
      reviewId: FIXTURE_REVIEW_ID,
      author: fixtureReviewer,
      state: ReviewVerdictStates.COMMENTED,
      body: "Two notes on the scroller; the accessibility changes read right.",
      submittedAt: REVIEW_SUBMITTED_AT,
      url: `${PR_URL}#pullrequestreview-${String(FIXTURE_REVIEW_ID)}`,
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
  [FIXTURE_REV1_HEAD]: briefRev1Text,
  [FIXTURE_REV2_HEAD]: briefRev2Text,
};

/**
 * Every span the screen compares: each revision's full span, and the
 * previous-brief span, which holds only the files that differ between the
 * two heads.
 */
export const spanDiffs: readonly DemoSpanDiff[] = [
  { base: FIXTURE_BASE_SHA, head: FIXTURE_REV1_HEAD, text: diffsRev1Text },
  { base: FIXTURE_BASE_SHA, head: FIXTURE_REV2_HEAD, text: diffsRev2Text },
  {
    base: FIXTURE_REV1_HEAD,
    head: FIXTURE_REV2_HEAD,
    text: previousBriefSpanDiffsText,
  },
];

/** `{"repoConfig":null}`: the envelope the API composes for a row without one. */
export const briefContextText = JSON.stringify({ repoConfig: null });
