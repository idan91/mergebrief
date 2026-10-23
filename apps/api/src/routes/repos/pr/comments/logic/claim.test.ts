import { RenewalFailureCodes } from "github";
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import type { Logger } from "logging";
import { PUBLISH_CLAIM_LEASE_MS } from "persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PR_NUMBER,
  REPO_SLUG,
  makeDraftCommentRow,
} from "../../../../../../test/fixtures";
import { arrangeFakePullRequest } from "../../../../../../test/reviewer-github";
import { WRITE_DEADLINE_MARGIN_MS } from "../../publish/consts";
import type { ClaimLedger } from "../../publish/types";
import { postClaimedDraft } from "./claim";

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

const REPO_ID = 424242;
const [OWNER = "", REPO = ""] = REPO_SLUG.split("/");
const PIN = { prNumber: PR_NUMBER, commitId: "a".repeat(40) };
const MARGIN_SLACK_MS = 1000;

function bindRepoClient(fake: FakeGitHub) {
  const credential = {
    readToken: async () => ({ ok: true, value: "viewer-token" }) as const,
    renewToken: async () =>
      ({ ok: false, error: { code: RenewalFailureCodes.REFUSED } }) as const,
  };
  return fake
    .bindReviewerGitHub(credential, { log })
    .forRepo({ owner: OWNER, repo: REPO });
}

function stubLedger(): ClaimLedger {
  return {
    settle: vi.fn(),
    release: vi.fn().mockResolvedValue({ ok: true, value: 1 }),
  };
}

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

describe("postClaimedDraft", () => {
  let fake: FakeGitHub;

  beforeEach(() => {
    fake = makeFakeGitHub();
    arrangeFakePullRequest(fake, { repoId: REPO_ID });
  });

  it("posts nothing within 30 seconds of the lease running out", async () => {
    const ledger = stubLedger();
    const leaseEnd = Date.now() - PUBLISH_CLAIM_LEASE_MS;
    const claimedAt = new Date(
      leaseEnd + WRITE_DEADLINE_MARGIN_MS - MARGIN_SLACK_MS,
    );

    const posted = await postClaimedDraft(
      log,
      ledger,
      bindRepoClient(fake),
      PIN,
      makeClaim(claimedAt),
    );

    expect(posted).toEqual({ ok: false, error: { kind: "publish-expired" } });
    expect(fake.listCalls("createInlineReviewComment")).toEqual([]);
    expect(ledger.release).toHaveBeenCalledWith({ claim: "claim-1" });
  });

  it("posts while more than 30 seconds of the lease remain", async () => {
    const ledger = stubLedger();
    const leaseEnd = Date.now() - PUBLISH_CLAIM_LEASE_MS;
    const claimedAt = new Date(
      leaseEnd + WRITE_DEADLINE_MARGIN_MS + MARGIN_SLACK_MS,
    );

    const posted = await postClaimedDraft(
      log,
      ledger,
      bindRepoClient(fake),
      PIN,
      makeClaim(claimedAt),
    );

    expect(posted.ok).toBe(true);
    expect(fake.listCalls("createInlineReviewComment")).toHaveLength(1);
    expect(ledger.release).not.toHaveBeenCalled();
  });
});
