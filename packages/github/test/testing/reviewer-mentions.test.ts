// The fake answers mention reads the way GitHub does where the contract's
// canned octokit answers cannot show it: what a team search matches, and
// the lookup's cap.
import { describe, expect, it } from "vitest";
import { MentionTargetKinds } from "../../src/operations/mentions/types";
import { createFakeAdapter } from "../client/contract/fake-adapter";
import { ContractOutcomes } from "../client/contract/types";
import { REPO } from "../client/helpers";

function bindFakeReviewerRepo() {
  const adapter = createFakeAdapter({
    operation: "searchMentionableTeams",
    outcome: ContractOutcomes.OK,
  });
  return adapter.reviewer.forRepo(REPO);
}

describe("the fake's mention reads", () => {
  it("matches a team search on the slug and name, not the org login", async () => {
    const client = bindFakeReviewerRepo();

    const byOrg = await client.searchMentionableTeams("acme");
    const bySlug = await client.searchMentionableTeams("front");

    expect(byOrg).toEqual({ ok: true, value: [] });
    expect(bySlug).toEqual({
      ok: true,
      value: [{ combinedSlug: "acme/frontend", name: "Frontend" }],
    });
  });

  it("rejects more targets than one lookup takes, as the real client does", async () => {
    const client = bindFakeReviewerRepo();
    const targets = Array.from({ length: 51 }, (_, index) => ({
      kind: MentionTargetKinds.USER,
      login: `user${index}`,
    }));

    await expect(client.resolveMentionTargets(targets)).rejects.toThrow(
      "mention lookup takes at most 50 targets",
    );
  });
});
