import { describe, expect, it } from "vitest";

import { MentionCandidateKinds } from "@web/components/MarkdownTextarea/types";
import { MentionVariants } from "./types";
import { buildMentionHref, readMentionVariant } from "./utils";

describe("buildMentionHref", () => {
  it("opens a user's profile", () => {
    expect(buildMentionHref("cara", MentionCandidateKinds.USER)).toBe(
      "https://github.com/cara",
    );
  });

  it("opens a team's page under its org", () => {
    expect(buildMentionHref("acme/web.app", MentionCandidateKinds.TEAM)).toBe(
      "https://github.com/orgs/acme/teams/web.app",
    );
  });
});

describe("readMentionVariant", () => {
  it("marks the viewer whatever case either side used", () => {
    expect(
      readMentionVariant("OCTOCAT", MentionCandidateKinds.USER, "octoCat"),
    ).toBe(MentionVariants.VIEWER);
  });

  it("marks nothing without a known viewer", () => {
    expect(
      readMentionVariant("octocat", MentionCandidateKinds.USER, undefined),
    ).toBeUndefined();
  });
});
