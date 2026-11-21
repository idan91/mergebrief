// Bodies are pinned byte for byte: a live comment is recognised by an exact
// body match, so any drift re-pings every PR thread on the next run.
import { MAX_BRIEFED_CHANGED_FILES } from "brief-core/types";
import { createI18n } from "i18n";
import { GenerationFailureCodes } from "types/generations";
import { describe, expect, it } from "vitest";
import {
  buildEntryCommentBody,
  buildEntryCommentCappedBody,
  buildEntryCommentClosedBody,
  buildEntryCommentFailedBody,
  buildEntryCommentGeneratingBody,
  buildEntryCommentHeldBody,
  buildEntryCommentOnDemandBody,
  formatEntryBodyToken,
  isEntryCommentBody,
  isHeadClosedEntryBody,
  isHeadEntryBody,
  isHeadOrOnDemandEntryBody,
  isHeadReadyEntryBody,
  isOpenHeadEntryBody,
  isUnsettledEntryBody,
} from "../src/task/entry-comment";
import { formatInlineCode } from "../src/task/entry-comment/held-conditions";
import {
  EntryBodyKinds,
  type EntryBodyKind,
  type EntryCommentCappedLink,
  type EntryCommentLink,
} from "../src/task/entry-comment/types";

const { t } = createI18n();
const ENTRY_MARKER = "<!-- mergebrief-entry -->";

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
  it("builds the closed body naming the head and linking nothing", () => {
    expect(buildEntryCommentClosedBody(t, LINK.headSha)).toBe(
      [
        "**No brief for `abcdef1`: this pull request is no longer open.**",
        "",
        "<sub>Posted by MergeBrief. Replaced when MergeBrief runs on this pull request again.</sub>",
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.CLOSED, LINK.headSha),
      ].join("\n"),
    );
  });

  it("tells an Entry body from any other comment by its marker", () => {
    const ready = buildEntryCommentBody(t, LINK);
    expect(isEntryCommentBody(ready)).toBe(true);
    expect(isEntryCommentBody("Posted by MergeBrief, quoted by a human")).toBe(
      false,
    );
  });

  it("builds the ready body with the revision deep link", () => {
    expect(buildEntryCommentBody(t, LINK)).toBe(
      [
        "**[Read the brief for this push](https://mb.example/repos/123/pulls/7?rev=2)** (`abcdef1`)",
        "",
        "<sub>Posted by MergeBrief. Replaced when MergeBrief runs on a later push.</sub>",
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.READY, LINK.headSha),
      ].join("\n"),
    );
  });

  it("builds the generating body with the revision deep link", () => {
    expect(buildEntryCommentGeneratingBody(t, LINK)).toBe(
      [
        "**[Brief is generating for this push…](https://mb.example/repos/123/pulls/7?rev=2)** (`abcdef1`)",
        "",
        "<sub>Posted by MergeBrief. The link shows the live diff now, and this comment is replaced when the brief is ready.</sub>",
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.GENERATING, LINK.headSha),
      ].join("\n"),
    );
  });

  it("names the parts and the estimate on a multi-call run's generating body", () => {
    const body = buildEntryCommentGeneratingBody(t, LINK, {
      parts: 57,
      estimateMinutes: 25,
    });

    expect(body).toBe(
      [
        "**[Brief is generating for this push…](https://mb.example/repos/123/pulls/7?rev=2)** (`abcdef1`)",
        "",
        "A large pull request: this brief is generated in 57 parts. Expect it in about 25 minutes.",
        "",
        "<sub>Posted by MergeBrief. The link shows the live diff now, and this comment is replaced when the brief is ready.</sub>",
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.GENERATING, LINK.headSha),
      ].join("\n"),
    );
    expect(isHeadEntryBody(body, LINK.headSha)).toBe(true);
    expect(
      buildEntryCommentGeneratingBody(t, LINK, {
        parts: 1,
        estimateMinutes: 5,
      }),
    ).toContain("generated in 1 part. Expect it in about 5 minutes.");
  });

  it("builds the capped body with the spanless PR link and reset time", () => {
    expect(buildEntryCommentCappedBody(t, CAPPED_LINK)).toBe(
      [
        "**No brief for `abcdef1`: this instance reached its daily generation cap.**",
        "",
        "Generation resumes at 2026-10-25 00:00 UTC. The next push after that is briefed as usual. [Open this PR in MergeBrief](https://mb.example/repos/123/pulls/7)",
        "",
        "<sub>Posted by MergeBrief. The instance operator sets the daily cap.</sub>",
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.CAPPED, CAPPED_LINK.headSha),
      ].join("\n"),
    );
  });

  it("names the runs a large pull request needed in the capped body", () => {
    const body = buildEntryCommentCappedBody(t, {
      ...CAPPED_LINK,
      units: { needed: 9, left: 4, cap: 20 },
    });

    expect(body).toBe(
      [
        "**No brief for `abcdef1`: this pull request needs 9 more runs to be briefed in parts, and this instance had 4 left today.**",
        "",
        "Generation resumes at 2026-10-25 00:00 UTC. The next push after that is briefed as usual. [Open this PR in MergeBrief](https://mb.example/repos/123/pulls/7)",
        "",
        "<sub>Posted by MergeBrief. The instance operator sets the daily cap.</sub>",
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.CAPPED, CAPPED_LINK.headSha),
      ].join("\n"),
    );
    expect(isHeadEntryBody(body, CAPPED_LINK.headSha)).toBe(true);
  });

  it("names the cap, not the next push, when no day fits the run", () => {
    const body = buildEntryCommentCappedBody(t, {
      ...CAPPED_LINK,
      units: { needed: 9, left: 4, cap: 9 },
    });

    expect(body).toBe(
      [
        "**No brief for `abcdef1`: this pull request needs 9 more runs to be briefed in parts, and this instance's daily cap of 9 cannot fit that in one day.**",
        "",
        "No push is briefed until the instance operator raises the daily cap. [Open this PR in MergeBrief](https://mb.example/repos/123/pulls/7)",
        "",
        "<sub>Posted by MergeBrief. The instance operator sets the daily cap.</sub>",
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.CAPPED, CAPPED_LINK.headSha),
      ].join("\n"),
    );
    expect(isHeadEntryBody(body, CAPPED_LINK.headSha)).toBe(true);
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
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.FAILED, LINK.headSha),
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
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.FAILED, LINK.headSha),
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
        "MergeBrief briefs a pull request only when it changes up to 3,000 files and GitHub serves its whole diff. [Open this push in MergeBrief](https://mb.example/repos/123/pulls/7?rev=2)",
        "",
        "<sub>Posted by MergeBrief. Replaced when MergeBrief runs on this pull request again, or when it closes.</sub>",
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.FAILED, LINK.headSha),
      ].join("\n"),
    );
  });

  it("spells out the briefed-file cap in the diff-too-large reason", () => {
    const reason = t("entryComment.failed.reason.diff-too-large");

    expect(reason).toContain(MAX_BRIEFED_CHANGED_FILES.toLocaleString("en"));
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
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.ON_DEMAND),
      ].join("\n"),
    );
  });
});

describe("entry body readers", () => {
  const OTHER_HEAD = "fedcba9876543210";
  const capped = buildEntryCommentCappedBody(t, CAPPED_LINK);

  it.each([
    ["generating", buildEntryCommentGeneratingBody(t, LINK)],
    ["capped", capped],
    [
      "failed",
      buildEntryCommentFailedBody(t, LINK, GenerationFailureCodes.UNKNOWN),
    ],
  ])("reads the head's %s body as its own", (_kind, body) => {
    expect(isHeadEntryBody(body, LINK.headSha)).toBe(true);
    expect(isHeadEntryBody(body, OTHER_HEAD)).toBe(false);
  });

  it("keeps the ready body and an unmarked body apart from the head's", () => {
    const ready = buildEntryCommentBody(t, LINK);
    const unmarked = capped.replace(ENTRY_MARKER, "");

    expect(isHeadEntryBody(ready, LINK.headSha)).toBe(false);
    expect(isHeadReadyEntryBody(ready, LINK.headSha)).toBe(true);
    expect(isHeadEntryBody(unmarked, LINK.headSha)).toBe(false);
  });

  it("replaces the closed body only on a PR read open", () => {
    const closed = buildEntryCommentClosedBody(t, LINK.headSha);

    expect(isHeadClosedEntryBody(closed, LINK.headSha)).toBe(true);
    expect(isHeadEntryBody(closed, LINK.headSha)).toBe(false);
    expect(isHeadOrOnDemandEntryBody(closed, LINK.headSha)).toBe(false);
    expect(isOpenHeadEntryBody(closed, LINK.headSha)).toBe(true);
  });

  it("reads the on-demand body as every head's", () => {
    const onDemand = buildEntryCommentOnDemandBody(t, LINK);

    expect(isHeadOrOnDemandEntryBody(onDemand, OTHER_HEAD)).toBe(true);
    expect(isHeadEntryBody(onDemand, LINK.headSha)).toBe(false);
  });

  it("reads any head's unsettled body as unsettled, never ready or closed", () => {
    const generating = buildEntryCommentGeneratingBody(t, LINK);
    const failed = buildEntryCommentFailedBody(
      t,
      LINK,
      GenerationFailureCodes.UNKNOWN,
    );
    const onDemand = buildEntryCommentOnDemandBody(t, LINK);
    const unsettled = [generating, failed, capped, onDemand];
    const ready = buildEntryCommentBody(t, LINK);
    const closed = buildEntryCommentClosedBody(t, OTHER_HEAD);
    const unmarked = generating.replace(ENTRY_MARKER, "");

    expect(unsettled.map((body) => isUnsettledEntryBody(body))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(isUnsettledEntryBody(ready)).toBe(false);
    expect(isUnsettledEntryBody(closed)).toBe(false);
    expect(isUnsettledEntryBody(unmarked)).toBe(false);
  });
});

describe("entry body kind token", () => {
  const ready = buildEntryCommentBody(t, LINK);
  const readyToken = formatEntryBodyToken(EntryBodyKinds.READY, LINK.headSha);
  const closed = buildEntryCommentClosedBody(t, LINK.headSha);
  const failed = buildEntryCommentFailedBody(
    t,
    LINK,
    GenerationFailureCodes.UNKNOWN,
  );

  it("writes the kind and the full head after the marker", () => {
    expect(readyToken).toBe(
      "<!-- mergebrief-entry-kind: ready head: abcdef1234567890 -->",
    );
    expect(formatEntryBodyToken(EntryBodyKinds.ON_DEMAND)).toBe(
      "<!-- mergebrief-entry-kind: on-demand -->",
    );
    expect(ready.endsWith(`${ENTRY_MARKER}\n${readyToken}`)).toBe(true);
  });

  it("reads a ready body by its token whatever its heading says", () => {
    const reworded = ready.replace("Read the brief for this push", "Open it");

    expect(isHeadReadyEntryBody(reworded, LINK.headSha)).toBe(true);
    expect(isHeadEntryBody(reworded, LINK.headSha)).toBe(false);
    expect(isUnsettledEntryBody(reworded)).toBe(false);
  });

  it("reads a ready heading under a generating token as the head's body", () => {
    const generatingToken = formatEntryBodyToken(
      EntryBodyKinds.GENERATING,
      LINK.headSha,
    );
    const body = ready.replace(readyToken, generatingToken);

    expect(isHeadEntryBody(body, LINK.headSha)).toBe(true);
    expect(isHeadReadyEntryBody(body, LINK.headSha)).toBe(false);
  });

  it("reads the head from the token, not the visible short sha", () => {
    const withoutShortSha = failed.replace(" for `abcdef1`", "");

    expect(withoutShortSha).not.toContain("`abcdef1`");
    expect(isHeadEntryBody(withoutShortSha, LINK.headSha)).toBe(true);
  });

  it("reads a reworded closed body as that head's closed body", () => {
    const reworded = closed.replace("is no longer open", "has closed");

    expect(isHeadClosedEntryBody(reworded, LINK.headSha)).toBe(true);
    expect(isHeadClosedEntryBody(reworded, "fedcba9876543210")).toBe(false);
    expect(isUnsettledEntryBody(reworded)).toBe(false);
  });

  it("reads a reworded on-demand body as every head's", () => {
    const onDemand = buildEntryCommentOnDemandBody(t, LINK);
    const reworded = onDemand.replace("available on demand", "on request");

    expect(isHeadOrOnDemandEntryBody(reworded, "fedcba9876543210")).toBe(true);
  });

  it.each([
    ["no token", ready.replace(`\n${readyToken}`, "")],
    [
      "an unknown kind",
      ready.replace(
        readyToken,
        formatEntryBodyToken("nope" as EntryBodyKind, LINK.headSha),
      ),
    ],
  ])("reads a marked body with %s as unsettled and headless", (_case, body) => {
    expect(isEntryCommentBody(body)).toBe(true);
    expect(isUnsettledEntryBody(body)).toBe(true);
    expect(isHeadEntryBody(body, LINK.headSha)).toBe(false);
    expect(isHeadReadyEntryBody(body, LINK.headSha)).toBe(false);
    expect(isHeadClosedEntryBody(body, LINK.headSha)).toBe(false);
    expect(isHeadOrOnDemandEntryBody(body, LINK.headSha)).toBe(false);
    expect(isOpenHeadEntryBody(body, LINK.headSha)).toBe(false);
  });
});

const PREVIOUS_LINK: EntryCommentLink = {
  ...LINK,
  headIndex: 1,
  headSha: "0123456789abcdef",
};

describe("held entry body", () => {
  it("lists each unmet condition with its owner, the group last", () => {
    const body = buildEntryCommentHeldBody(t, {
      next: LINK,
      previous: PREVIOUS_LINK,
      unmet: [
        {
          kind: "any",
          conditions: [
            { kind: "labels", setBy: "repo", labels: ["needs-brief"] },
            {
              kind: "size",
              setBy: "repo",
              measure: "changed-lines",
              side: "max",
              limit: 500,
              actual: 1284,
            },
          ],
        },
        { kind: "ready-for-review", setBy: "instance" },
        {
          kind: "ci",
          setBy: "repo",
          failed: [],
          running: ["build", "lint", "test", "e2e"],
          missing: [],
          permissionMissing: false,
        },
      ],
    });

    expect(body).toBe(
      [
        "**No brief for `abcdef1`.**",
        "",
        "- Waiting for CI: `build`, `lint`, `test` and 1 more check still running (this repository's setting)",
        "- Needs this pull request marked ready for review (this MergeBrief instance's setting)",
        "- Needs one of these:",
        "  - Needs the label `needs-brief` (this repository's setting)",
        "  - 1284 changed lines, over the 500 maximum (this repository's setting)",
        "",
        "[Generate now](https://mb.example/repos/123/pulls/7?rev=2) · [Brief for `0123456`](https://mb.example/repos/123/pulls/7?rev=1)",
        "",
        "<sub>Posted by MergeBrief. Edited in place while this push waits, and replaced when its brief generates.</sub>",
        ENTRY_MARKER,
        formatEntryBodyToken(EntryBodyKinds.HELD, LINK.headSha),
      ].join("\n"),
    );
  });

  it("links only Generate when the pull request has no brief yet", () => {
    const body = buildEntryCommentHeldBody(t, {
      next: LINK,
      previous: undefined,
      unmet: [{ kind: "never", setBy: "repo" }],
    });

    expect(body).toContain(
      "- Generates only when someone presses Generate (this repository's setting)",
    );
    expect(body).toContain(
      "[Generate now](https://mb.example/repos/123/pulls/7?rev=2)\n",
    );
    expect(body).not.toContain("Brief for");
  });

  it("reads the held body as this head's and unsettled", () => {
    const body = buildEntryCommentHeldBody(t, {
      next: LINK,
      previous: undefined,
      unmet: [{ kind: "never", setBy: "instance" }],
    });

    expect(isHeadEntryBody(body, LINK.headSha)).toBe(true);
    expect(isUnsettledEntryBody(body)).toBe(true);
    expect(isHeadReadyEntryBody(body, LINK.headSha)).toBe(false);
  });

  it("reads its own token, not one a label carries", () => {
    const otherHead = "f".repeat(40);
    const fakeToken = formatEntryBodyToken(EntryBodyKinds.READY, otherHead);
    const body = buildEntryCommentHeldBody(t, {
      next: LINK,
      previous: undefined,
      unmet: [{ kind: "labels", setBy: "repo", labels: [fakeToken] }],
    });

    expect(body).toContain(fakeToken);
    expect(isHeadReadyEntryBody(body, otherHead)).toBe(false);
    expect(isHeadEntryBody(body, LINK.headSha)).toBe(true);
    expect(isUnsettledEntryBody(body)).toBe(true);
  });
});

describe("formatInlineCode", () => {
  it.each([
    ["plain text", "needs-brief", "`needs-brief`"],
    ["a backtick", "a`b", "`` a`b ``"],
    ["a backtick run", "x``y", "``` x``y ```"],
    ["a line break", "one\ntwo", "`one two`"],
  ])("fences %s so nothing inside closes it", (_case, text, expected) => {
    expect(formatInlineCode(text)).toBe(expected);
  });
});
