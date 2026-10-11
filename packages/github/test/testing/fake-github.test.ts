import { describe, expect, it } from "vitest";
import { ReviewEvents } from "../../src/operations/review-submit";
import { ReviewSubjectTypes } from "../../src/operations/review-thread";
import { makeFakeGitHub } from "../../src/testing";
import { CredentialKinds, type FakeGitHub } from "../../src/testing/types";
import {
  REPO,
  makeLogger,
  requireInstallationId,
  requireRepoId,
  stubCredential,
} from "../client/helpers";

const PR = { ...REPO, prNumber: 7 };
const HEAD_SHA = "b".repeat(40);

function makeGitHubWithPullRequest(draft = false): FakeGitHub {
  const github = makeFakeGitHub();
  github.addPullRequest(PR, {
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
      authorLogin: "octocat",
      closedAt: null,
      updatedAt: new Date("2026-10-01T10:00:00Z"),
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

  it("answers another pull request as not found", async () => {
    const github = makeGitHubWithPullRequest();

    const result = await bindReviewer(github).forRepo(REPO).fetchDiff(8);

    expect(result).toMatchObject({ ok: false, error: { code: "not-found" } });
  });
});

describe("makeFakeGitHub reviewer token", () => {
  it("renews a rejected token once and records both", async () => {
    const github = makeGitHubWithPullRequest();
    github.rejectToken("ghu_old");

    const result = await bindReviewer(github, "ghu_new")
      .forRepo(REPO)
      .fetchPullRequest(7);

    expect(result.ok).toBe(true);
    expect(github.listCalls("fetchPullRequest")).toMatchObject([
      { credential: { kind: CredentialKinds.REVIEWER, token: "ghu_old" } },
      { credential: { kind: CredentialKinds.REVIEWER, token: "ghu_new" } },
    ]);
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

  it("takes a draft out of draft once", async () => {
    const github = makeGitHubWithPullRequest(true);
    const client = bindReviewer(github).forRepo(REPO);

    const first = await client.markPullRequestReadyForReview(7);
    const second = await client.markPullRequestReadyForReview(7);
    const pull = await client.fetchPullRequest(7);

    expect(first).toEqual({ ok: true, value: { alreadyReady: false } });
    expect(second).toEqual({ ok: true, value: { alreadyReady: true } });
    expect(pull.ok && pull.value.draft).toBe(false);
  });
});
