import { describe, expect, it } from "vitest";
import { ReviewEvents } from "../../src/operations/review-submit";
import { ReviewSubjectTypes } from "../../src/operations/review-thread";
import { InstallationPresences } from "../../src/operations/installation/types";
import { makeFakeGitHub } from "../../src/testing";
import {
  CredentialKinds,
  FakeFactsHidings,
  FakeFailures,
  type FakeGitHub,
} from "../../src/testing/types";
import {
  REPO,
  makeLogger,
  requireInstallationId,
  requireOperatorToken,
  requireRepoId,
  stubCredential,
} from "../client/helpers";

const PR = { ...REPO, prNumber: 7 };
const HEAD_SHA = "b".repeat(40);

function makeGitHubWithPullRequest(
  draft = false,
  rejectedAnchorPaths: readonly string[] = [],
): FakeGitHub {
  const github = makeFakeGitHub();
  github.addPullRequest(PR, {
    rejectedAnchorPaths,
    info: {
      repoId: requireRepoId(4242n),
      repoFullName: "acme/widgets",
      headSha: HEAD_SHA,
      headRef: "feature",
      baseSha: "a".repeat(40),
      state: "open",
      draft,
      merged: false,
      title: "Add widgets",
      body: "",
      htmlUrl: "https://github.com/acme/widgets/pull/7",
      commitCount: 1,
      changedFiles: 1,
      additions: 8,
      deletions: 2,
      authorLogin: "octocat",
      authorIsBot: false,
      closedAt: null,
      updatedAt: new Date("2026-10-01T10:00:00Z"),
      createdAt: new Date("2026-09-01T08:00:00Z"),
    },
  });
  return github;
}

function bindReviewer(github: FakeGitHub, renewed?: string) {
  return github.bindReviewerGitHub(stubCredential("ghu_old", renewed), {
    log: makeLogger(),
  });
}

describe("makeFakeGitHub reads", () => {
  it("answers an unarranged repo file as absent", async () => {
    const github = makeGitHubWithPullRequest();

    const result = await bindReviewer(github)
      .forRepo(REPO)
      .fetchRepoFile({ path: ".mergebrief.yml", maxBytes: 10 });

    expect(result).toEqual({ ok: true, value: { kind: "absent" } });
  });

  it("answers a file past maxBytes as too large", async () => {
    const github = makeGitHubWithPullRequest();
    github.addRepoFile(
      REPO,
      { path: "big.yml", ref: HEAD_SHA },
      { kind: "file", content: "x".repeat(20), blobSha: "f", size: 20 },
    );

    const result = await bindReviewer(github)
      .forRepo(REPO)
      .fetchRepoFile({ path: "big.yml", ref: HEAD_SHA, maxBytes: 10 });

    expect(result).toEqual({
      ok: true,
      value: { kind: "too-large", blobSha: "f", size: 20 },
    });
  });

  it("answers a failed repo file only at its path", async () => {
    const github = makeGitHubWithPullRequest();
    github.failRepoFile(
      REPO,
      { path: "policy.yml" },
      FakeFailures.SERVER_ERROR,
    );
    const reader = bindReviewer(github).forRepo(REPO);

    const failed = await reader.fetchRepoFile({
      path: "policy.yml",
      maxBytes: 10,
    });
    const sibling = await reader.fetchRepoFile({
      path: "other.yml",
      maxBytes: 10,
    });

    expect(failed).toMatchObject({ ok: false, error: { status: 502 } });
    expect(sibling).toEqual({ ok: true, value: { kind: "absent" } });
  });

  it("refuses a path that holds no blob with no HTTP status", async () => {
    const github = makeGitHubWithPullRequest();
    github.failRepoFile(REPO, { path: "vendor" }, FakeFailures.NOT_A_BLOB);

    const result = await bindReviewer(github)
      .forRepo(REPO)
      .fetchRepoFile({ path: "vendor", maxBytes: 10 });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "not-a-blob",
        message: "failed to read repo file: not-a-blob",
      },
    });
  });

  it("reads an updated pull request with its other facts kept", async () => {
    const github = makeGitHubWithPullRequest();
    github.updatePullRequest(PR, { headSha: "c".repeat(40) });

    const pull = await bindReviewer(github).forRepo(REPO).fetchPullRequest(7);

    expect(pull.ok && pull.value.headSha).toBe("c".repeat(40));
    expect(pull.ok && pull.value.title).toBe("Add widgets");
  });

  it("refuses a checked compare diff short of its expected files", async () => {
    const github = makeGitHubWithPullRequest();
    const span = { base: "a".repeat(40), head: HEAD_SHA };
    github.addCompare(REPO, span, { diff: "diff --git a/x b/x\n" });
    const reader = bindReviewer(github).forRepo(REPO);

    const whole = await reader.fetchCheckedCompareDiff({
      ...span,
      expectedFileCount: 1,
    });
    const short = await reader.fetchCheckedCompareDiff({
      ...span,
      expectedFileCount: 2,
    });

    expect(whole).toEqual({ ok: true, value: "diff --git a/x b/x\n" });
    expect(short).toMatchObject({
      ok: false,
      error: { code: "diff-incomplete" },
    });
  });

  it("answers another pull request as not found", async () => {
    const github = makeGitHubWithPullRequest();

    const result = await bindReviewer(github).forRepo(REPO).fetchDiff(8);

    expect(result).toMatchObject({ ok: false, error: { code: "not-found" } });
  });
});

describe("makeFakeGitHub live read", () => {
  const OTHER = { ...REPO, prNumber: 8 };

  it("hides a pull request from one credential's live read only", async () => {
    const github = makeGitHubWithPullRequest();
    github.hideFacts(PR, CredentialKinds.REVIEWER, FakeFactsHidings.NOT_SHOWN);
    github.hideFacts(
      OTHER,
      CredentialKinds.REVIEWER,
      FakeFactsHidings.WITHHELD,
    );

    const viewer = await bindReviewer(github).readPullRequestFacts([PR, OTHER]);
    const operator = await github
      .bindOperatorGitHub(requireOperatorToken("ghp_operator"))
      .readPullRequestFacts([PR]);

    const viewerPage = viewer.ok ? viewer.value : undefined;
    expect(viewerPage?.get("acme/widgets#7")).toBeNull();
    expect(viewerPage?.has("acme/widgets#8")).toBe(false);
    const operatorPage = operator.ok ? operator.value : undefined;
    expect(operatorPage?.get("acme/widgets#7")).toMatchObject({
      headSha: HEAD_SHA,
    });
  });
});

describe("makeFakeGitHub pending review", () => {
  it("publishes a review through create, thread and submit", async () => {
    const github = makeGitHubWithPullRequest();
    const client = bindReviewer(github).forRepo(REPO);

    const created = await client.createPullRequestReview({
      prNumber: 7,
      commitId: HEAD_SHA,
    });
    if (!created.ok) {
      throw new Error("create failed");
    }
    const { reviewId, reviewNodeId } = created.value;
    await client.addPullRequestReviewThread({
      reviewNodeId,
      subjectType: ReviewSubjectTypes.FILE,
      path: "src/a.ts",
      body: "why",
    });
    const counted = await client.countPendingReviewComments(reviewNodeId);
    await client.submitPullRequestReview({
      reviewNodeId,
      event: ReviewEvents.COMMENT,
      body: "done",
    });

    expect(counted).toEqual({ ok: true, value: 1 });
    expect(
      await client.hasPullRequestReviewPublished({ prNumber: 7, reviewId }),
    ).toEqual({ ok: true, value: true });
  });

  it("refuses a second pending review on the same PR", async () => {
    const github = makeGitHubWithPullRequest();
    const client = bindReviewer(github).forRepo(REPO);
    const review = { prNumber: 7, commitId: HEAD_SHA };

    await client.createPullRequestReview(review);
    const second = await client.createPullRequestReview(review);

    expect(second).toMatchObject({
      ok: false,
      error: { code: "pending-review-exists" },
    });
  });

  it("deletes a pending review so the next create succeeds", async () => {
    const github = makeGitHubWithPullRequest();
    const client = bindReviewer(github).forRepo(REPO);
    const review = { prNumber: 7, commitId: HEAD_SHA };

    const created = await client.createPullRequestReview(review);
    const pending = await client.findPendingPullRequestReview(7);
    if (!pending.ok || pending.value === undefined) {
      throw new Error("no pending review");
    }
    await client.deletePendingPullRequestReview({
      prNumber: 7,
      reviewId: pending.value.reviewId,
    });

    expect(created.ok && created.value).toEqual(pending.value);
    expect(await client.createPullRequestReview(review)).toMatchObject({
      ok: true,
    });
  });

  it("rejects a thread anchored on a path outside the diff", async () => {
    const github = makeGitHubWithPullRequest(false, ["src/gone.ts"]);
    const client = bindReviewer(github).forRepo(REPO);
    const created = await client.createPullRequestReview({
      prNumber: 7,
      commitId: HEAD_SHA,
    });
    if (!created.ok) {
      throw new Error("create failed");
    }
    const { reviewNodeId } = created.value;

    const postThread = (path: string) =>
      client.addPullRequestReviewThread({
        reviewNodeId,
        subjectType: ReviewSubjectTypes.FILE,
        path,
        body: "why",
      });

    expect(await postThread("src/gone.ts")).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "anchor-rejected", status: 422 }),
    });
    expect(await postThread("src/a.ts")).toMatchObject({ ok: true });
    expect(await client.countPendingReviewComments(reviewNodeId)).toEqual({
      ok: true,
      value: 1,
    });
  });
});

describe("makeFakeGitHub writes", () => {
  it("shows a posted Entry comment until it is deleted", async () => {
    const github = makeGitHubWithPullRequest();
    const client = github
      .bindInstallationGitHub(requireInstallationId(99n))
      .forRepo(REPO);

    const posted = await client.postEntryComment({ prNumber: 7, body: "hi" });
    if (!posted.ok) {
      throw new Error("post failed");
    }
    const fetched = await client.fetchComment(posted.value.commentId);
    await client.deleteComment(posted.value.commentId);

    expect(fetched).toEqual({ ok: true, value: { body: "hi" } });
    expect(await client.fetchComment(posted.value.commentId)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("shows a removed comment as gone", async () => {
    const github = makeGitHubWithPullRequest();
    github.addComment(REPO, 1500n, "kept");
    github.addComment(REPO, 1501n, "removed");
    github.removeComment(REPO, 1501n);

    expect([...github.readComments(REPO)]).toEqual([[1500n, "kept"]]);
  });

  it("takes a draft out of draft once", async () => {
    const github = makeGitHubWithPullRequest(true);
    const client = bindReviewer(github).forRepo(REPO);

    const first = await client.markPullRequestReadyForReview(7);
    const second = await client.markPullRequestReadyForReview(7);
    const pull = await client.fetchPullRequest(7);

    const githubUpdatedAt = new Date("2026-10-01T10:00:00Z");
    expect(first).toEqual({
      ok: true,
      value: { alreadyReady: false, githubUpdatedAt },
    });
    expect(second).toEqual({
      ok: true,
      value: { alreadyReady: true, githubUpdatedAt },
    });
    expect(pull.ok && pull.value.draft).toBe(false);
  });
});

describe("makeFakeGitHub installation presence", () => {
  const INSTALLATION = requireInstallationId(99n);

  it("reads an installation present until it is removed", async () => {
    const github = makeFakeGitHub();

    expect(await github.readInstallationPresence(INSTALLATION)).toEqual({
      ok: true,
      value: InstallationPresences.PRESENT,
    });
    github.removeInstallation(INSTALLATION);

    expect(await github.readInstallationPresence(INSTALLATION)).toEqual({
      ok: true,
      value: InstallationPresences.GONE,
    });
    expect(github.listCalls("readInstallationPresence")).toEqual([
      expect.objectContaining({ credential: { kind: CredentialKinds.APP } }),
      expect.objectContaining({ credential: { kind: CredentialKinds.APP } }),
    ]);
  });

  it("answers an unreachable presence read through failOn", async () => {
    const github = makeFakeGitHub();
    github.failOn("readInstallationPresence", FakeFailures.SERVER_ERROR);

    const result = await github.readInstallationPresence(INSTALLATION);

    expect(result.ok || result.error.code).toBe("request-failed");
  });

  it("lists the arranged repo ids on the installation binding", async () => {
    const github = makeFakeGitHub();
    github.setInstallationRepoIds(INSTALLATION, [requireRepoId(4242n)]);

    const result = await github
      .bindInstallationGitHub(INSTALLATION)
      .listInstallationRepoIds();

    expect(result).toEqual({ ok: true, value: new Set([4242n]) });
  });

  it("lists the repos an added installation holds when none were set", async () => {
    const github = makeFakeGitHub();
    github.addInstallation(
      { installationId: INSTALLATION, accountLogin: "acme" },
      new Map([
        [
          requireRepoId(4242n),
          {
            fullName: "acme/widgets",
            viewerIsAdmin: true,
            viewerCanPush: true,
          },
        ],
      ]),
    );

    const result = await github
      .bindInstallationGitHub(INSTALLATION)
      .listInstallationRepoIds();

    expect(result).toEqual({ ok: true, value: new Set([4242n]) });
  });

  it("refuses every call on a removed installation as a refused mint", async () => {
    const github = makeFakeGitHub();
    github.setInstallationRepoIds(INSTALLATION, [requireRepoId(4242n)]);
    github.removeInstallation(INSTALLATION);

    const result = await github
      .bindInstallationGitHub(INSTALLATION)
      .listInstallationRepoIds();

    expect(result).toMatchObject({
      ok: false,
      error: { code: "not-found", status: 404 },
    });
  });
});
