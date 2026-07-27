import { describe, expect, it } from "vitest";

import { resolveLegacyDeltaRedirect } from "./legacyRedirect";
import type { LocalBriefSummary } from "../types";

const headBrief: LocalBriefSummary = {
  id: "acme-widgets-1_2_head1234",
  artifactKind: "brief",
  repo: "acme/widgets",
  number: 1,
  title: "Fixture",
  sha: "head1234full",
  index: 2,
  comparisons: {
    lastReview: {
      marksId: "acme-widgets-1_checkpoint_checkpoi-head1234",
      deltaId: "acme-widgets-1-checkpoint..head1234",
      baselineSha: "checkpoint1234",
      baselineIndex: null,
    },
  },
};

const delta: LocalBriefSummary = {
  id: "acme-widgets-1-checkpoint..head1234",
  artifactKind: "delta",
  repo: "acme/widgets",
  number: 1,
  title: "Fixture delta",
  sha: "head1234full",
  baselineSha: "checkpoint1234",
  headSha: "head1234full",
};

const otherPrBrief: LocalBriefSummary = {
  id: "other-repo-9_1_aaaa1111",
  artifactKind: "brief",
  repo: "acme/other",
  number: 9,
  title: "Unrelated",
  sha: "aaaa1111full",
  index: 1,
};

const artifacts = [headBrief, delta, otherPrBrief];

describe("resolveLegacyDeltaRedirect", () => {
  it("redirects a Delta artifact's own id to its head Brief with Changes Only + Your last review", () => {
    expect(resolveLegacyDeltaRedirect(artifacts, delta.id)).toEqual({
      briefId: headBrief.id,
      search: { view: "changes", compare: "last-review" },
    });
  });

  it("returns null for a Brief artifact id — nothing to redirect", () => {
    expect(resolveLegacyDeltaRedirect(artifacts, headBrief.id)).toBeNull();
  });

  it("returns null for an id that matches nothing locally", () => {
    expect(resolveLegacyDeltaRedirect(artifacts, "missing-id")).toBeNull();
  });

  it("returns null when the Delta's head Brief can't be found locally", () => {
    const orphanDelta: LocalBriefSummary = {
      ...delta,
      id: "orphan-delta",
      headSha: "no-such-head",
    };
    expect(
      resolveLegacyDeltaRedirect([orphanDelta], orphanDelta.id),
    ).toBeNull();
  });

  it("returns null when the head Brief has no lastReview availability (pre-branch artifact set)", () => {
    const { comparisons: _comparisons, ...bareHeadBrief } = headBrief;
    expect(
      resolveLegacyDeltaRedirect([bareHeadBrief, delta], delta.id),
    ).toBeNull();
  });

  it("returns null when lastReview availability binds a different delta", () => {
    const otherDeltaHead: LocalBriefSummary = {
      ...headBrief,
      comparisons: {
        lastReview: {
          marksId: "acme-widgets-1_checkpoint_othercpk-head1234",
          deltaId: "acme-widgets-1-othercheckpoint..head1234",
          baselineSha: "othercheckpoint",
          baselineIndex: null,
        },
      },
    };
    expect(
      resolveLegacyDeltaRedirect([otherDeltaHead, delta], delta.id),
    ).toBeNull();
  });
});
