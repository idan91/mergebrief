// Bodies are pinned byte for byte: a live comment is recognised by an exact
// body match, so any drift re-pings every PR thread on the next run.
import { createI18n } from "i18n";
import { describe, expect, it } from "vitest";
import {
  entryCommentBody,
  entryCommentCappedBody,
  entryCommentGeneratingBody,
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
  resetsAt: new Date("2026-10-25T00:00:00.000Z"),
};

describe("entry comment bodies", () => {
  it("builds the ready body with the revision deep link", () => {
    expect(entryCommentBody(t, LINK)).toBe(
      [
        "**[Read the brief for this push](https://mb.example/repos/123/pulls/7?rev=2)** (`abcdef1`)",
        "",
        "<sub>Posted by MergeBrief — replaced on each settled push so it always links the latest revision.</sub>",
      ].join("\n"),
    );
  });

  it("builds the generating body with the revision deep link", () => {
    expect(entryCommentGeneratingBody(t, LINK)).toBe(
      [
        "**[Brief is generating for this push…](https://mb.example/repos/123/pulls/7?rev=2)** (`abcdef1`)",
        "",
        "<sub>Posted by MergeBrief — the link already shows the live diff; this comment is replaced when the brief is ready.</sub>",
      ].join("\n"),
    );
  });

  it("builds the capped body with the spanless PR link and reset time", () => {
    expect(entryCommentCappedBody(t, PR_LINK)).toBe(
      [
        "**Daily generation cap reached — no brief for `abcdef1`.**",
        "",
        "Generation resumes at 2026-10-25T00:00:00Z; the next push after that briefs normally. [Open this PR in MergeBrief](https://mb.example/repos/123/pulls/7)",
        "",
        "<sub>Posted by MergeBrief — this instance's operator sets the daily cap.</sub>",
      ].join("\n"),
    );
  });
});
