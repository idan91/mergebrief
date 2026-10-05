import { describe, expect, it } from "vitest";
import {
  canonicalizeTicketUrl,
  collectTicketReferences,
  resolvePrimaryTicket,
} from "../../src/context/references";
import type { TicketReferenceInput } from "../../src/context/trackers/types";

const REPO = { owner: "acme", repo: "widget" };
const NOTION = {
  kind: "notion",
  keyPrefix: "BRIEF",
  databaseId: "a".repeat(32),
} as const;
const GITHUB = { kind: "github", issuesRepo: "acme/tracker" } as const;

function makeInput(
  overrides: Partial<TicketReferenceInput>,
): TicketReferenceInput {
  return {
    title: "",
    body: "",
    branch: "",
    repo: REPO,
    trackers: [],
    readable: ["github"],
    ...overrides,
  };
}

describe("collectTicketReferences: shapes", () => {
  it.each([
    ["BRIEF-12 in the body", ["BRIEF-12"]],
    ["brief-12 lowercase", ["BRIEF-12"]],
    ["prefix mismatch DS-12", []],
    ["word-bounded xBRIEF-12", []],
    ["word-bounded BRIEF-12x", []],
    ["hyphen-bounded pre-BRIEF-12", []],
    ["slug-tailed BRIEF-12-fix-the-loop", ["BRIEF-12"]],
    ["digit-tailed BRIEF-12x", []],
  ])("key: %s", (body, keys) => {
    const refs = collectTicketReferences(
      makeInput({ body, trackers: [NOTION] }),
    );
    expect(refs.map((r) => r.key)).toEqual(keys);
  });

  it("keys never match without a tracker block", () => {
    expect(collectTicketReferences(makeInput({ body: "BRIEF-12" }))).toEqual(
      [],
    );
  });

  it("keys never match when the tracker is github", () => {
    expect(
      collectTicketReferences(
        makeInput({ body: "BRIEF-12", trackers: [GITHUB] }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["fixes #12", ["https://github.com/acme/widget/issues/12"]],
    ["see (#12)", ["https://github.com/acme/widget/issues/12"]],
    ["word#12", []],
    ["path/#12", []],
    ["# 12 heading", []],
    ["#12abc", []],
  ])("#N: %s", (body, urls) => {
    const refs = collectTicketReferences(makeInput({ body }));
    expect(refs.map((r) => r.url)).toEqual(urls);
  });

  it("#N resolves against tracker.issuesRepo when set", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "#7", trackers: [GITHUB] }),
    );
    expect(refs[0]?.url).toBe("https://github.com/acme/tracker/issues/7");
  });

  it("owner/repo#N always resolves to that repo", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "see other/thing#3" }),
    );
    expect(refs[0]).toMatchObject({
      number: 3,
      url: "https://github.com/other/thing/issues/3",
    });
  });

  it("GitHub issue URLs always match; pull URLs never do", () => {
    const refs = collectTicketReferences(
      makeInput({
        body: "https://github.com/o/r/issues/9 and https://github.com/o/r/pull/10",
      }),
    );
    expect(refs.map((r) => r.url)).toEqual(["https://github.com/o/r/issues/9"]);
  });

  it("branch: a path segment starting N- resolves as #N", () => {
    const refs = collectTicketReferences(
      makeInput({ branch: "feature/12-fix-thing" }),
    );
    expect(refs[0]).toMatchObject({ number: 12, foundIn: "branch" });
  });

  it("branch: a segment not starting with N- is not a reference", () => {
    expect(
      collectTicketReferences(makeInput({ branch: "feature/fix-12" })),
    ).toEqual([]);
    expect(collectTicketReferences(makeInput({ branch: "12fix" }))).toEqual([]);
  });

  it("branch: a numeric segment under two prefixes is a stack position", () => {
    expect(
      collectTicketReferences(
        makeInput({ branch: "feature/BRIEF-269/1-instance-cap" }),
      ),
    ).toEqual([]);
    expect(
      collectTicketReferences(makeInput({ branch: "a/b/12-fix" })),
    ).toEqual([]);
  });

  it("branch: a key under the tracker prefix wins over a stack position", () => {
    const refs = collectTicketReferences(
      makeInput({
        branch: "feature/BRIEF-269/1-instance-cap",
        trackers: [NOTION],
        readable: ["github", "notion"],
      }),
    );
    expect(refs.map((r) => r.key)).toEqual(["BRIEF-269"]);
  });

  it("branch: a key under the tracker prefix wins over a stack position", () => {
    const refs = collectTicketReferences(
      makeInput({
        branch: "feature/BRIEF-269/1-instance-cap",
        trackers: [NOTION],
        readable: ["github", "notion"],
      }),
    );
    expect(refs.map((r) => r.key)).toEqual(["BRIEF-269"]);
  });

  it("branch: the whole name may start with N-", () => {
    const refs = collectTicketReferences(makeInput({ branch: "12-fix-thing" }));
    expect(refs[0]).toMatchObject({ number: 12, foundIn: "branch" });
  });

  it("GitHub references stay text where GitHub is unreadable", () => {
    const refs = collectTicketReferences(
      makeInput({
        title: "#5",
        body: "fixes #12, other/thing#3, https://github.com/o/r/issues/9",
        branch: "12-fix",
        readable: [],
      }),
    );
    expect(refs).toEqual([]);
  });

  it("keys still match where only notion is readable", () => {
    const refs = collectTicketReferences(
      makeInput({
        body: "BRIEF-12 and #4",
        trackers: [NOTION],
        readable: ["notion"],
      }),
    );
    expect(refs.map((r) => r.key)).toEqual(["BRIEF-12"]);
  });

  it("branch: a Jira-style segment carries the key", () => {
    const refs = collectTicketReferences(
      makeInput({
        branch: "feature/BRIEF-239-ticket-references",
        trackers: [NOTION],
      }),
    );
    expect(refs[0]).toMatchObject({ key: "BRIEF-239", foundIn: "branch" });
  });

  it("branch: a key matches in the branch name", () => {
    const refs = collectTicketReferences(
      makeInput({ branch: "feature/BRIEF-239/card", trackers: [NOTION] }),
    );
    expect(refs[0]).toMatchObject({ key: "BRIEF-239", foundIn: "branch" });
  });

  it.each([
    [
      "https://www.notion.so/Title-3cf5e9400eeb81f9bed9e1474c2cb4d4?v=abc",
      "3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
    [
      "https://notion.so/3cf5e9400eeb81f9bed9e1474c2cb4d4#block",
      "3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
    [
      "https://app.notion.com/p/3cf5e9400eeb81f9bed9e1474c2cb4d4",
      "3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
    [
      "https://acme.notion.site/Page-3cf5e9400eeb81f9bed9e1474c2cb4d4",
      "3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
    [
      "https://www.notion.so/acme/Board-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?p=3cf5e9400eeb81f9bed9e1474c2cb4d4&pm=s",
      "3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
  ])("notion URL %s → page id", (body, pageId) => {
    const refs = collectTicketReferences(
      makeInput({ body, readable: ["github", "notion"] }),
    );
    expect(refs[0]).toMatchObject({
      tracker: "notion",
      pageId,
      url: `https://www.notion.so/${pageId}`,
    });
  });

  it("notion URLs never match without a token", () => {
    expect(
      collectTicketReferences(
        makeInput({
          body: "https://www.notion.so/3cf5e9400eeb81f9bed9e1474c2cb4d4",
        }),
      ),
    ).toEqual([]);
  });

  it("a notion URL without a 32-hex id is not a reference", () => {
    expect(
      collectTicketReferences(
        makeInput({
          body: "https://www.notion.so/product",
          readable: ["github", "notion"],
        }),
      ),
    ).toEqual([]);
  });

  it("keeps the closing flag when a plain mention of the ticket comes first", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "Part of #7. Relates to #8. Closes #8." }),
    );
    expect(refs.map((r) => [r.number, r.closing])).toEqual([
      [7, false],
      [8, true],
    ]);
    expect(resolvePrimaryTicket(refs)?.number).toBe(8);
  });

  it("dedupes by identity, keeping the first location", () => {
    const refs = collectTicketReferences(
      makeInput({ title: "#5", body: "closes #5 and #5", branch: "5-x" }),
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.foundIn).toBe("description");
  });
});

describe("collectTicketReferences: several boards", () => {
  const DS = {
    kind: "notion",
    keyPrefix: "DS",
    databaseId: "b".repeat(32),
  } as const;

  it("matches every configured prefix, each key on its own board", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "BRIEF-12 pairs with DS-7", trackers: [NOTION, DS] }),
    );
    expect(refs.map((r) => [r.key, r.databaseId])).toEqual([
      ["BRIEF-12", "a".repeat(32)],
      ["DS-7", "b".repeat(32)],
    ]);
  });

  it("keeps reading order across boards when picking the primary", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "DS-7 then BRIEF-12", trackers: [NOTION, DS] }),
    );
    expect(resolvePrimaryTicket(refs, ["notion"])?.key).toBe("DS-7");
  });

  it("a bare #N resolves against a listed github entry's issuesRepo", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "#7", trackers: [NOTION, GITHUB] }),
    );
    expect(refs[0]?.url).toBe("https://github.com/acme/tracker/issues/7");
  });
});

describe("resolvePrimaryTicket", () => {
  it("returns undefined with no references", () => {
    expect(resolvePrimaryTicket([])).toBeUndefined();
  });

  it("prefers the description over the title over the branch", () => {
    const refs = collectTicketReferences(
      makeInput({ title: "#1", body: "see #2", branch: "3-x" }),
    );
    expect(resolvePrimaryTicket(refs)?.number).toBe(2);
    const noBody = collectTicketReferences(
      makeInput({ title: "#1", branch: "3-x" }),
    );
    expect(resolvePrimaryTicket(noBody)?.number).toBe(1);
    const branchOnly = collectTicketReferences(makeInput({ branch: "3-x" }));
    expect(resolvePrimaryTicket(branchOnly)?.number).toBe(3);
  });

  it("a closing keyword in the description beats reading order", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "Related: #1.\n\nFixes #2" }),
    );
    expect(resolvePrimaryTicket(refs)?.number).toBe(2);
  });

  it.each([
    "close",
    "closes",
    "closed",
    "fix",
    "fixes",
    "fixed",
    "resolve",
    "resolves",
    "resolved",
    "Resolves:",
  ])("recognizes the closing keyword %s", (keyword) => {
    const refs = collectTicketReferences(
      makeInput({ body: `#1 then ${keyword} #2` }),
    );
    expect(resolvePrimaryTicket(refs)?.number).toBe(2);
  });

  it("a closing keyword in the title does not outrank the description", () => {
    const refs = collectTicketReferences(
      makeInput({ title: "fixes #9", body: "see #4" }),
    );
    expect(resolvePrimaryTicket(refs)?.number).toBe(4);
  });

  it("with a notion tracker, a title key outranks a description #N", () => {
    const refs = collectTicketReferences(
      makeInput({
        title: "[BRIEF-239] x",
        body: "on #467",
        trackers: [NOTION],
      }),
    );
    expect(resolvePrimaryTicket(refs, [NOTION.kind])?.key).toBe("BRIEF-239");
  });

  it("with a notion tracker, a closing #N still loses to a key", () => {
    const refs = collectTicketReferences(
      makeInput({
        title: "[BRIEF-239] x",
        body: "Fixes #12",
        trackers: [NOTION],
      }),
    );
    expect(resolvePrimaryTicket(refs, [NOTION.kind])?.key).toBe("BRIEF-239");
  });

  it("with a notion tracker and no github entry, short GitHub forms are text", () => {
    const refs = collectTicketReferences(
      makeInput({
        title: "#5",
        body: "see #4 and other/thing#3 and https://github.com/o/r/issues/9",
        branch: "12-fix",
        trackers: [NOTION],
      }),
    );
    expect(refs.map((r) => r.url)).toEqual(["https://github.com/o/r/issues/9"]);
  });

  it("with a github entry beside notion, a bare #N resolves again", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "see #4", trackers: [NOTION, GITHUB] }),
    );
    expect(refs[0]?.url).toBe("https://github.com/acme/tracker/issues/4");
  });

  it("with no keyword the first reference in reading order wins", () => {
    const refs = collectTicketReferences(
      makeInput({ body: "BRIEF-7 then #3", trackers: [NOTION] }),
    );
    expect(resolvePrimaryTicket(refs)?.key).toBe("BRIEF-7");
  });
});

describe("canonicalizeTicketUrl", () => {
  it.each([
    ["https://github.com/o/r/issues/9/", "https://github.com/o/r/issues/9"],
    ["https://github.com/o/r/issues/9?x=1", "https://github.com/o/r/issues/9"],
    [
      "https://github.com/o/r/issues/9#issuecomment-1",
      "https://github.com/o/r/issues/9",
    ],
    [
      "https://www.notion.so/Title-3cf5e9400eeb81f9bed9e1474c2cb4d4?v=abc",
      "https://www.notion.so/3cf5e9400eeb81f9bed9e1474c2cb4d4",
    ],
    ["https://docs.example/a.md", "https://docs.example/a.md"],
    ["https://github.com/o/r/pull/9", "https://github.com/o/r/pull/9"],
  ])("%s → %s", (raw, canonical) => {
    expect(canonicalizeTicketUrl(raw)).toBe(canonical);
  });
});
