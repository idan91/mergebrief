import { createInlineReviewComment } from "github";
import type * as githubModule from "github";
import type { Logger } from "logging";
import { PUBLISH_CLAIM_LEASE_MS } from "persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDraftCommentRow } from "../../../../../../test/fixtures";
import { BadGateway } from "../../../../../shared-errors/api-error";
import type {
  ReviewerGitHubClient,
  UserOctokit,
} from "../../../../auth/reviewer-github-client";
import { WRITE_DEADLINE_MARGIN_MS } from "../../publish/consts";
import type { ClaimLedger } from "../../publish/types";
import { postClaimedDraft } from "./post-now";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  createInlineReviewComment: vi.fn(),
}));

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

const TARGET = {
  owner: "acme",
  repo: "app",
  prNumber: 7,
  commitId: "a".repeat(40),
};

function stubGitHubClient(): ReviewerGitHubClient {
  return {
    run: (call) => call("viewer-token"),
    runRead: (call) => call("viewer-token"),
    createOctokit: () => ({}) as UserOctokit,
    createMutationOctokit: () => ({}) as UserOctokit,
    session: () => {
      throw new Error("stub: no session");
    },
  };
}

function stubLedger(): ClaimLedger {
  return {
    settle: vi.fn(),
    release: vi.fn().mockResolvedValue({ ok: true, value: 1 }),
  };
}

const MARGIN_SLACK_MS = 1000;

function makeClaim(claimedAt: Date) {
  return {
    claim: "claim-1",
    drafts: [
      makeDraftCommentRow({
        publishClaim: "claim-1",
        publishClaimedAt: claimedAt,
      }),
    ],
  };
}

beforeEach(() => {
  vi.mocked(createInlineReviewComment).mockReset();
  vi.mocked(createInlineReviewComment).mockResolvedValue({
    ok: true,
    value: { commentId: 1n },
  });
});

describe("postClaimedDraft", () => {
  it("posts nothing within 30 seconds of the lease running out", async () => {
    const ledger = stubLedger();
    const leaseEnd = Date.now() - PUBLISH_CLAIM_LEASE_MS;
    const claimedAt = new Date(
      leaseEnd + WRITE_DEADLINE_MARGIN_MS - MARGIN_SLACK_MS,
    );

    const posted = postClaimedDraft(
      { github: stubGitHubClient(), log },
      ledger,
      TARGET,
      makeClaim(claimedAt),
    );

    await expect(posted).rejects.toBeInstanceOf(BadGateway);
    expect(createInlineReviewComment).not.toHaveBeenCalled();
    expect(ledger.release).toHaveBeenCalledWith({ claim: "claim-1" });
  });

  it("posts while more than 30 seconds of the lease remain", async () => {
    const ledger = stubLedger();
    const leaseEnd = Date.now() - PUBLISH_CLAIM_LEASE_MS;
    const claimedAt = new Date(
      leaseEnd + WRITE_DEADLINE_MARGIN_MS + MARGIN_SLACK_MS,
    );

    const posted = await postClaimedDraft(
      { github: stubGitHubClient(), log },
      ledger,
      TARGET,
      makeClaim(claimedAt),
    );

    expect(posted).toEqual({ commentId: 1n });
    expect(createInlineReviewComment).toHaveBeenCalledTimes(1);
    expect(ledger.release).not.toHaveBeenCalled();
  });
});
