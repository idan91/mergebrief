// Bodies are pinned byte for byte: a live comment is recognised by an exact
// body match, so any drift re-pings every PR thread on the next run.
import { createI18n } from "i18n";
import { GenerationFailureCodes } from "types/generations";
import { describe, expect, it } from "vitest";
import {
  buildEntryCommentBody,
  buildEntryCommentCappedBody,
  buildEntryCommentFailedBody,
  buildEntryCommentGeneratingBody,
  buildEntryCommentOnDemandBody,
  type EntryCommentCappedLink,
  type EntryCommentLink,
} from "../src/task/entry-comment";

const { t } = createI18n();

const LINK: EntryCommentLink = {
  publicBaseUrl: "https://mb.example/",
  repoId: 123n,
  prNumber: 7,
  headIndex: 2,
  headSha: "abcdef1234567890",
};

const CAPPED_LINK: EntryCommentCappedLink = {
  publicBaseUrl: "https://mb.example",
  repoId: 123n,
  prNumber: 7,
  headSha: "abcdef1234567890",
  resetsAt: new Date("2026-10-25T00:00:00.000Z"),
};

/** The setup and secret codes whose public reason is one generic line. */
const PUBLICLY_COLLAPSED_CODES = [
  GenerationFailureCodes.PROVIDER_AUTH,
  GenerationFailureCodes.PROVIDER_REFUSAL,
  GenerationFailureCodes.OUTPUT_SECRET,
  GenerationFailureCodes.GENERATION_CONFIG,
  GenerationFailureCodes.GITHUB_ACCESS,
];

describe("entry comment bodies", () => {
  it("builds the ready body with the revision deep link", () => {
    expect(buildEntryCommentBody(t, LINK)).toBe(
      [
        "**[Read the brief for this push](https://mb.example/repos/123/pulls/7?rev=2)** (`abcdef1`)",
        "",
        "<sub>Posted by MergeBrief. Replaced when MergeBrief runs on a later push.</sub>",
      ].join("\n"),
    );
  });

  it("builds the generating body with the revision deep link", () => {
    expect(buildEntryCommentGeneratingBody(t, LINK)).toBe(
      [
        "**[Brief is generating for this push…](https://mb.example/repos/123/pulls/7?rev=2)** (`abcdef1`)",
        "",
        "<sub>Posted by MergeBrief. The link shows the live diff now, and this comment is replaced when the brief is ready.</sub>",
      ].join("\n"),
    );
  });

  it("builds the capped body with the spanless PR link and reset time", () => {
    expect(buildEntryCommentCappedBody(t, CAPPED_LINK)).toBe(
      [
        "**No brief for `abcdef1`: this instance reached its daily generation cap.**",
        "",
        "Generation resumes at 2026-10-25 00:00 UTC. The next push after that is briefed as usual. [Open this PR in MergeBrief](https://mb.example/repos/123/pulls/7)",
        "",
        "<sub>Posted by MergeBrief. The instance operator sets the daily cap.</sub>",
      ].join("\n"),
    );
  });

  it("links a transient failure's Regenerate to the head's revision", () => {
    const body = buildEntryCommentFailedBody(
      t,
      LINK,
      GenerationFailureCodes.PROVIDER_TIMEOUT,
    );

    expect(body).toBe(
      [
        "**No brief for `abcdef1`: generation failed.**",
        "",
        "The model provider timed out before finishing. [Regenerate from MergeBrief](https://mb.example/repos/123/pulls/7?rev=2)",
        "",
        "<sub>Posted by MergeBrief. Replaced when MergeBrief runs on this pull request again, or when it closes.</sub>",
      ].join("\n"),
    );
  });

  it("renders the five codes the public reason collapses as one body", () => {
    const bodies = new Set(
      PUBLICLY_COLLAPSED_CODES.map((code) =>
        buildEntryCommentFailedBody(t, LINK, code),
      ),
    );

    expect([...bodies]).toEqual([
      [
        "**No brief for `abcdef1`: generation failed.**",
        "",
        "MergeBrief couldn't brief this push. A collaborator can see why in MergeBrief. [Open this push in MergeBrief](https://mb.example/repos/123/pulls/7?rev=2)",
        "",
        "<sub>Posted by MergeBrief. Replaced when MergeBrief runs on this pull request again, or when it closes.</sub>",
      ].join("\n"),
    ]);
  });

  it("links a cannot-help code's revision without a Regenerate link", () => {
    const body = buildEntryCommentFailedBody(
      t,
      LINK,
      GenerationFailureCodes.DIFF_TOO_LARGE,
    );

    expect(body).toBe(
      [
        "**No brief for `abcdef1`: generation failed.**",
        "",
        "GitHub will not serve a diff this large. [Open this push in MergeBrief](https://mb.example/repos/123/pulls/7?rev=2)",
        "",
        "<sub>Posted by MergeBrief. Replaced when MergeBrief runs on this pull request again, or when it closes.</sub>",
      ].join("\n"),
    );
  });

  it("links the on-demand body to the next brief's rev and names no head", () => {
    const body = buildEntryCommentOnDemandBody(t, {
      publicBaseUrl: "https://mb.example/",
      repoId: 123n,
      prNumber: 7,
      headIndex: 2,
    });

    expect(body).toBe(
      [
        "**A brief for this pull request is available on demand.**",
        "",
        "[Generate it in MergeBrief](https://mb.example/repos/123/pulls/7?rev=2)",
        "",
        "<sub>Posted by MergeBrief. Replaced once a brief is generating.</sub>",
      ].join("\n"),
    );
  });
});
