import { describe, expect, it } from "vitest";

import type { LocalBriefSummary } from "../../../../model/types";
import { describeLocalBriefRevision } from "./utils";

function makeBrief(
  overrides: Partial<LocalBriefSummary> = {},
): LocalBriefSummary {
  return {
    id: "example-repo_1_abcdef01",
    artifactKind: "brief",
    repo: "example/repo",
    number: 1,
    title: "Example",
    sha: "abcdef0123456789abcdef0123456789abcdef01",
    ...overrides,
  };
}

describe("describeLocalBriefRevision", () => {
  it("names a brief by its short sha", () => {
    expect(describeLocalBriefRevision(makeBrief())).toBe("abcdef0");
  });

  it("names a delta by the pair it spans, and by one sha without the pair", () => {
    const delta = makeBrief({
      artifactKind: "delta",
      baselineSha: "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      headSha: "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(describeLocalBriefRevision(delta)).toBe("1111111 \u2192 2222222");
    expect(
      describeLocalBriefRevision(makeBrief({ artifactKind: "delta" })),
    ).toBe("abcdef0");
  });
});
