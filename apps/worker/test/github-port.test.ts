// The port over github/testing's fake: which binding each job kind reads
// through, and the url-box probe that may switch a job to the operator token.
// The grant and crypto legs run real against PGlite.
import type { IssueInfo } from "github";
import { isGrantRowId, parseTenantContext, type GrantRowId } from "persistence";
import {
  CredentialKinds,
  FakeFailures,
  stubOwnedOperatorToken,
  stubPendingOperatorToken,
  type FakeCredential,
  type FakeGitHub,
} from "github/testing";
import { GenerationFailureCodes } from "types/generations";
import { describe, expect, it } from "vitest";
import { PermanentJobError, TransientJobError } from "../src/task/failure";
import { createGitHubPort } from "../src/task/github-port";
import {
  makeGitHub,
  makeReviewerId,
  openTestPort,
  PR_REF,
  REPO,
  seedViewerGrant,
  setUpFileHarness,
  HEAD_1,
  VIEWER_TOKEN,
} from "./generate/helpers";
import { createNoopLogger } from "../src/task/generate/utils";

setUpFileHarness();

const OWNER = makeReviewerId(555n);
const OPERATOR_TOKEN = "ghp_operator";
const OWNED_OPERATOR = stubOwnedOperatorToken(OPERATOR_TOKEN, OWNER);
const PENDING_OPERATOR = stubPendingOperatorToken(OPERATOR_TOKEN);
const { installationId } = parseTenantContext({ installationId: 42 });

const AS_VIEWER: FakeCredential = {
  kind: CredentialKinds.REVIEWER,
  token: VIEWER_TOKEN,
};
const AS_OPERATOR: FakeCredential = {
  kind: CredentialKinds.OPERATOR,
  token: OPERATOR_TOKEN,
};

const TICKET: IssueInfo = {
  title: "Ship widgets",
  state: "open",
  stateReason: null,
  labels: [],
  milestone: null,
  body: "",
  isPullRequest: false,
};

function missingGrantId(): GrantRowId {
  const value = 999_999n;
  if (!isGrantRowId(value)) {
    throw new Error("unbrandable fixture id");
  }
  return value;
}

function makeUrlBoxRequest(grantId: GrantRowId, ownerUserId = OWNER) {
  return {
    grantId,
    repoSlug: "acme/widget",
    prNumber: PR_REF.prNumber,
    ownerUserId,
    log: createNoopLogger(),
  };
}

function listCredentials(github: FakeGitHub): FakeCredential[] {
  return github.calls.map((call) => call.credential);
}

describe("createGitHubPort openPullRequestSource", () => {
  it("reads and writes through the installation binding", async () => {
    const github = makeGitHub(HEAD_1);
    const source = await openTestPort(github).openPullRequestSource(
      installationId,
      "acme/widget",
      7,
    );

    const read = await source.fetchPullRequest();
    const posted = await source.entryComments?.postEntryComment({
      prNumber: 7,
      body: "Brief is generating",
    });

    expect(read.ok).toBe(true);
    expect(posted?.ok).toBe(true);
    expect([...github.readComments(REPO).values()]).toEqual([
      "Brief is generating",
    ]);
    expect(listCredentials(github)).toEqual([
      { kind: CredentialKinds.INSTALLATION, installationId },
      { kind: CredentialKinds.INSTALLATION, installationId },
    ]);
  });

  it("lists the repository's open pull requests", async () => {
    const github = makeGitHub(HEAD_1);
    const source = await openTestPort(github).openPullRequestSource(
      installationId,
      "acme/widget",
      7,
    );

    const open = await source.listOpenPullRequests();

    expect(open.ok && open.value.map((pull) => pull.number)).toEqual([7]);
  });
});

describe("createGitHubPort openUrlBoxPullRequestSource", () => {
  it("binds the viewer's decrypted token when the probe succeeds", async () => {
    const github = makeGitHub(HEAD_1);
    const grantId = await seedViewerGrant();
    const source = await openTestPort(
      github,
      OWNED_OPERATOR,
    ).openUrlBoxPullRequestSource(makeUrlBoxRequest(grantId));

    // The probe result is served once: the task's first read costs nothing.
    const first = await source.fetchPullRequest();
    expect(first.ok).toBe(true);
    expect(github.listCalls("fetchPullRequest")).toHaveLength(1);
    // Later reads (the supersession watch) go live again.
    await source.fetchPullRequest();
    expect(github.listCalls("fetchPullRequest")).toHaveLength(2);
    expect(listCredentials(github)).toEqual([AS_VIEWER, AS_VIEWER]);
    expect(source.entryComments).toBeUndefined();
  });

  it("reads an issue in any repo with the same bound token", async () => {
    const github = makeGitHub(HEAD_1);
    const grantId = await seedViewerGrant();
    const source = await openTestPort(github).openUrlBoxPullRequestSource(
      makeUrlBoxRequest(grantId),
    );

    const result = await source.fetchIssue("acme", "tracker", 42);

    expect(result.ok).toBe(false);
    expect(github.calls.at(-1)).toEqual({
      operation: "fetchIssue",
      credential: AS_VIEWER,
      input: { owner: "acme", repo: "tracker", number: 42 },
    });
  });

  it("switches the whole job to the operator after a NOT_FOUND probe", async () => {
    const github = makeGitHub(HEAD_1);
    github.failOn(
      "fetchPullRequest",
      FakeFailures.NOT_FOUND,
      CredentialKinds.REVIEWER,
    );
    const grantId = await seedViewerGrant();
    const source = await openTestPort(
      github,
      OWNED_OPERATOR,
    ).openUrlBoxPullRequestSource(makeUrlBoxRequest(grantId));

    const read = await source.fetchPullRequest();
    await source.fetchDiff();
    await source.fetchRepoFile(".mergebrief/settings.yaml", 1024);

    expect(read.ok).toBe(true);
    expect(listCredentials(github)).toEqual([
      AS_VIEWER,
      AS_OPERATOR,
      AS_OPERATOR,
      AS_OPERATOR,
    ]);
    // The repo-config read stays on the default branch on the operator token.
    expect(github.calls.at(-1)?.input).toEqual({
      path: ".mergebrief/settings.yaml",
      maxBytes: 1024,
      ...REPO,
    });
    expect(source.entryComments).toBeUndefined();
  });

  it("switches to the operator after a FORBIDDEN probe", async () => {
    const github = makeGitHub(HEAD_1);
    github.failOn(
      "fetchPullRequest",
      FakeFailures.FORBIDDEN,
      CredentialKinds.REVIEWER,
    );
    const grantId = await seedViewerGrant();
    const source = await openTestPort(
      github,
      OWNED_OPERATOR,
    ).openUrlBoxPullRequestSource(makeUrlBoxRequest(grantId));

    const read = await source.fetchPullRequest();

    expect(read.ok).toBe(true);
    expect(github.calls.at(-1)?.credential).toEqual(AS_OPERATOR);
  });

  it("lists no open PRs on the operator token, so no stack resolves", async () => {
    const github = makeGitHub(HEAD_1);
    github.failOn(
      "fetchPullRequest",
      FakeFailures.NOT_FOUND,
      CredentialKinds.REVIEWER,
    );
    const grantId = await seedViewerGrant();
    const source = await openTestPort(
      github,
      OWNED_OPERATOR,
    ).openUrlBoxPullRequestSource(makeUrlBoxRequest(grantId));

    const open = await source.listOpenPullRequests();

    expect(open).toEqual({ ok: true, value: [] });
    expect(github.listCalls("listOpenPullRequests")).toEqual([]);
  });

  it("reads no issue outside the job's repository on the operator token", async () => {
    const github = makeGitHub(HEAD_1);
    github.failOn(
      "fetchPullRequest",
      FakeFailures.NOT_FOUND,
      CredentialKinds.REVIEWER,
    );
    github.addIssue({ owner: "acme", repo: "widget", number: 3 }, TICKET);
    github.addIssue(
      { owner: "other-org", repo: "secrets", number: 12 },
      TICKET,
    );
    const grantId = await seedViewerGrant();
    const source = await openTestPort(
      github,
      OWNED_OPERATOR,
    ).openUrlBoxPullRequestSource(makeUrlBoxRequest(grantId));

    const own = await source.fetchIssue("acme", "widget", 3);
    const foreign = await source.fetchIssue("other-org", "secrets", 12);

    expect(own.ok).toBe(true);
    expect(foreign.ok || foreign.error.code).toBe("not-found");
    expect(github.listCalls("fetchIssue")).toHaveLength(1);
  });

  it("an UNAUTHORIZED probe keeps the viewer binding, never the operator", async () => {
    const github = makeGitHub(HEAD_1);
    github.rejectToken(VIEWER_TOKEN);
    const grantId = await seedViewerGrant();
    const source = await openTestPort(
      github,
      OWNED_OPERATOR,
    ).openUrlBoxPullRequestSource(makeUrlBoxRequest(grantId));

    const result = await source.fetchPullRequest();
    await source.fetchPullRequest();

    expect(result.ok).toBe(false);
    expect(listCredentials(github)).toEqual([AS_VIEWER, AS_VIEWER]);
  });

  it("keeps the viewer binding on a denial when no operator token is set", async () => {
    const github = makeGitHub(HEAD_1);
    github.failOn("fetchPullRequest", FakeFailures.NOT_FOUND);
    const grantId = await seedViewerGrant();
    const source = await openTestPort(github).openUrlBoxPullRequestSource(
      makeUrlBoxRequest(grantId),
    );

    // No probe happened (nothing to decide); the task's own read surfaces it.
    expect(github.calls).toEqual([]);
    const result = await source.fetchPullRequest();
    expect(result.ok).toBe(false);
    expect(listCredentials(github)).toEqual([AS_VIEWER]);
  });

  it("keeps the viewer binding for a reviewer who does not own the token", async () => {
    const github = makeGitHub(HEAD_1);
    github.failOn("fetchPullRequest", FakeFailures.NOT_FOUND);
    const grantId = await seedViewerGrant();
    const source = await openTestPort(
      github,
      OWNED_OPERATOR,
    ).openUrlBoxPullRequestSource(
      makeUrlBoxRequest(grantId, makeReviewerId(556n)),
    );

    // The same branch as no token at all: no probe, the task's read surfaces it.
    expect(github.calls).toEqual([]);
    const result = await source.fetchPullRequest();

    expect(result.ok).toBe(false);
    expect(listCredentials(github)).toEqual([AS_VIEWER]);
  });

  it("retries the job when a denied probe meets a pending owner lookup", async () => {
    const github = makeGitHub(HEAD_1);
    github.failOn(
      "fetchPullRequest",
      FakeFailures.NOT_FOUND,
      CredentialKinds.REVIEWER,
    );
    const grantId = await seedViewerGrant();

    const opened = openTestPort(
      github,
      PENDING_OPERATOR,
    ).openUrlBoxPullRequestSource(makeUrlBoxRequest(grantId));

    await expect(opened).rejects.toThrow(TransientJobError);
    await expect(opened).rejects.toMatchObject({
      failure: { code: GenerationFailureCodes.GITHUB_UNAVAILABLE },
    });
    expect(listCredentials(github)).toEqual([AS_VIEWER]);
  });

  it("keeps the viewer when its probe passes during a pending lookup", async () => {
    const github = makeGitHub(HEAD_1);
    const grantId = await seedViewerGrant();
    const source = await openTestPort(
      github,
      PENDING_OPERATOR,
    ).openUrlBoxPullRequestSource(makeUrlBoxRequest(grantId));

    const read = await source.fetchPullRequest();

    expect(read.ok).toBe(true);
    expect(listCredentials(github)).toEqual([AS_VIEWER]);
  });

  it("a vanished grant is a permanent github-access failure", async () => {
    await expect(
      openTestPort(makeGitHub(HEAD_1)).openUrlBoxPullRequestSource(
        makeUrlBoxRequest(missingGrantId()),
      ),
    ).rejects.toThrow(PermanentJobError);
  });

  it("an unreadable token is a permanent github-access failure", async () => {
    const grantId = await seedViewerGrant(VIEWER_TOKEN, "MISSING_KEY_REF");
    await expect(
      openTestPort(makeGitHub(HEAD_1)).openUrlBoxPullRequestSource(
        makeUrlBoxRequest(grantId),
      ),
    ).rejects.toThrow(PermanentJobError);
  });

  it("refuses url-box jobs when no credential path is wired", async () => {
    const port = createGitHubPort(makeGitHub(HEAD_1));
    await expect(
      port.openUrlBoxPullRequestSource(makeUrlBoxRequest(missingGrantId())),
    ).rejects.toThrow(PermanentJobError);
  });
});
