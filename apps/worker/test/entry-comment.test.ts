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
  type EntryCommentCappedLink,
  type EntryCommentLink,
  type EntryCommentPrLink,
} from "../src/task/entry-comment";

const { t } = createI18n();

const LINK: EntryCommentLink = {
  publicBaseUrl: "https://mb.example/",
  repoId: 123n,
  prNumber: 7,
  headIndex: 2,
  headSha: "abcdef1234567890",
};

const PR_LINK: EntryCommentPrLink = {
  publicBaseUrl: "https://mb.example",
  repoId: 123n,
  prNumber: 7,
  headSha: "abcdef1234567890",
};

/** The setup and secret codes whose public reason is one generic line. */
const PUBLICLY_COLLAPSED_CODES = [
  GenerationFailureCodes.PROVIDER_AUTH,
  GenerationFailureCodes.PROVIDER_REFUSAL,
  GenerationFailureCodes.OUTPUT_SECRET,
  GenerationFailureCodes.GENERATION_CONFIG,
  GenerationFailureCodes.GITHUB_ACCESS,
];

const CAPPED_LINK: EntryCommentCappedLink = {
  ...PR_LINK,
  resetsAt: new Date("2026-10-25T00:00:00.000Z"),
};

describe("entry comment bodies", () => {
  it("builds the ready body with the revision deep link", () => {
    expect(buildEntryCommentBody(t, LINK)).toBe(
      [
        "**[Read the brief for this push](https://mb.example/repos/123/pulls/7?rev=2)** (`abcdef1`)",
        "",
        "<sub>Posted by MergeBrief — replaced on each settled push so it always links the latest revision.</sub>",
      ].join("\n"),
    );
  });

  it("builds the generating body with the revision deep link", () => {
    expect(buildEntryCommentGeneratingBody(t, LINK)).toBe(
      [
        "**[Brief is generating for this push…](https://mb.example/repos/123/pulls/7?rev=2)** (`abcdef1`)",
        "",
        "<sub>Posted by MergeBrief — the link already shows the live diff; this comment is replaced when the brief is ready.</sub>",
      ].join("\n"),
    );
  });

  it("builds the capped body with the spanless PR link and reset time", () => {
    expect(buildEntryCommentCappedBody(t, CAPPED_LINK)).toBe(
      [
        "**Daily generation cap reached — no brief for `abcdef1`.**",
        "",
        "Generation resumes at 2026-10-25T00:00:00Z; the next push after that briefs normally. [Open this PR in MergeBrief](https://mb.example/repos/123/pulls/7)",
        "",
        "<sub>Posted by MergeBrief — this instance's operator sets the daily cap.</sub>",
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
        "**Brief generation failed — no brief for `abcdef1`.**",
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
        "**Brief generation failed — no brief for `abcdef1`.**",
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
        "**Brief generation failed — no brief for `abcdef1`.**",
        "",
        "GitHub will not serve a diff this large. [Open this push in MergeBrief](https://mb.example/repos/123/pulls/7?rev=2)",
        "",
        "<sub>Posted by MergeBrief. Replaced when MergeBrief runs on this pull request again, or when it closes.</sub>",
      ].join("\n"),
    );
  });
});
